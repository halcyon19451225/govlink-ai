import "server-only";
import { query, queryOne } from "@/lib/db";
import { getTaskRouting } from "@/lib/ai/gateway";
import { resolveEffectiveMode, type AiTaskType } from "@/lib/ai/taskTypes";
import {
  bigrams,
  rank,
  scoreEvidence,
  scoreContext,
  rankMeasuresSmart,
  estimateBudget,
  fiscalRateStats,
  formatMeasureBlock,
  formatEvidenceBlock,
  formatContextBlock,
  formatCostBlock,
  formatBudgetEstimateBlock,
  formatFiscalRateBlock,
  type CorpusMeasureForMatch,
  type CorpusEvidenceForMatch,
  type CorpusContextForMatch,
  type ContextMatchOpts,
} from "@/lib/corpus/match";

/**
 * コーパス接地（独自AI v0）の取得・記録 — X4
 *
 * ── 動作モード（ai_task_routing のダイヤル）─────────────────
 *  claude … 何もしない（従来どおり）
 *  shadow … 裏で検索・記録だけ行う（利用者には出さない）。
 *           ヒット状況を ai_grounding_logs / ai_usage_logs(provider='ordo')
 *           に残し、ダイヤルを上げる判断材料にする
 *  assist … 検索結果をプロンプト注入ブロックとして返す（primary も当面 assist）
 *
 * 検索対象は **status='approved'（Ordo検収済み）のコーパス行のみ**。
 * 検索・整形は match.ts（純粋）が担い、ここはDB取得と記録だけを持つ。
 * 失敗しても本処理（対話）を壊さない — 例外はすべて握って null を返す。
 */

export interface GroundingResult {
  /** 実効モード。'claude' なら接地なし */
  mode: "claude" | "shadow" | "assist" | "primary";
  /** assist のときだけ注入ブロックが入る（shadow は記録のみで null） */
  measureBlock: string | null;
  evidenceBlock: string | null;
  costBlock: string | null;
  hits: { measures: number; evidence: number };
}

const NO_GROUNDING: GroundingResult = {
  mode: "claude",
  measureBlock: null,
  evidenceBlock: null,
  costBlock: null,
  hits: { measures: 0, evidence: 0 },
};

export async function retrieveGrounding(opts: {
  taskType: AiTaskType;
  projectId: string | null;
  /** 対話ID（採択の粗い判定に使う） */
  contextId?: string | null;
  /** 検索クエリ（真因・分野・アプローチ等の断片。個人情報を入れない） */
  queryText: string;
  /** 自治体規模帯（分かる場合のみ。同帯の実績に加点） */
  band?: string | null;
  /** 対象規模（人数。分かる場合のみ。積算推定の概算総額に使う） */
  targetSize?: number | null;
}): Promise<GroundingResult> {
  try {
    const routing = await getTaskRouting(opts.taskType);
    const mode = resolveEffectiveMode(routing.mode);
    if (mode === "claude") return NO_GROUNDING;

    const t0 = Date.now();
    const q = bigrams(opts.queryText);
    if (q.size === 0) return NO_GROUNDING;

    // 検収済み行のみ・上限つきで取得し、JS側でスコアリングする
    // （コーパスが育って重くなったら埋め込み検索に置き換える。match.ts 参照）
    // 採択実績（X6・推薦ランキング用）: どのコーパス行を接地した対話が
    // 書き出しまで到達したか（粗い採択・X4定義）を行別に数える
    let adoptionByRowId = new Map<string, number>();
    try {
      const adoptions = await query<{ id: string; n: number }>(
        `SELECT unnest(corpus_measure_ids) AS id, count(*)::int AS n
         FROM ai_grounding_logs
         WHERE adopted IS TRUE
         GROUP BY 1`,
      );
      adoptionByRowId = new Map(adoptions.map((a) => [a.id, a.n]));
    } catch {
      adoptionByRowId = new Map();
    }

    const [measures, evidence] = await Promise.all([
      query<CorpusMeasureForMatch & { outcome_notes: unknown }>(
        `SELECT id, title, field_category, population_band, approach,
                target_population, intervention, outcome_notes, effect_note,
                evidence_status, total_budget::float AS total_budget,
                unit_cost::float AS unit_cost, cost_per_outcome_note, funding
         FROM corpus_measures WHERE status = 'approved'
         ORDER BY updated_at DESC LIMIT 300`,
      ),
      query<CorpusEvidenceForMatch>(
        `SELECT id, title, field_category, source, year, design,
                evidence_level, population, effect_summary, transferability,
                fiscal_effect_rate::float AS fiscal_effect_rate
         FROM corpus_evidence WHERE status = 'approved'
         ORDER BY updated_at DESC LIMIT 300`,
      ),
    ]);

    const measureRows: CorpusMeasureForMatch[] = measures.map((m) => ({
      ...m,
      outcome_notes: Array.isArray(m.outcome_notes)
        ? (m.outcome_notes as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
    }));

    // X6: 適合度×品質×採択実績の推薦ランキング（透明な規則。match.ts 参照）
    const rankedMeasures = rankMeasuresSmart(q, measureRows, {
      limit: 5,
      minScore: 3,
      band: opts.band ?? null,
      adoptionByRowId,
    });
    const rankedEvidence = rank(evidence, (r) => scoreEvidence(q, r), {
      limit: 5,
      minScore: 3,
    });

    const latency = Date.now() - t0;
    const injected = mode !== "shadow";

    // 接地ログ（失敗しても対話を壊さない）
    try {
      await queryOne(
        `INSERT INTO ai_grounding_logs
           (task_type, mode, project_id, context_id, query_summary,
            corpus_measure_ids, corpus_evidence_ids, injected, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], $8, $9)
         RETURNING id`,
        [
          opts.taskType,
          mode,
          opts.projectId,
          opts.contextId ?? null,
          opts.queryText.slice(0, 300),
          rankedMeasures.map((r) => r.row.id),
          rankedEvidence.map((r) => r.row.id),
          injected,
          latency,
        ],
      );
      // 独自AI（ordo）側の利用として計上 → /ordo-admin/ai の品質モニタに出る
      await queryOne(
        `INSERT INTO ai_usage_logs
           (task_type, provider, model, latency_ms, status, project_id)
         VALUES ($1, 'ordo', $2, $3, 'ok', $4) RETURNING id`,
        [
          opts.taskType,
          `corpus-grounding-v0(${mode})`,
          latency,
          opts.projectId,
        ],
      );
    } catch (e) {
      console.warn("接地ログの記録に失敗:", e);
    }

    if (!injected) {
      return {
        mode,
        measureBlock: null,
        evidenceBlock: null,
        costBlock: null,
        hits: { measures: rankedMeasures.length, evidence: rankedEvidence.length },
      };
    }

    // X6: 単価分布からの積算推定（2件未満なら出さない — 1件を相場に見せない）
    const estimateBlock = formatBudgetEstimateBlock(
      estimateBudget(rankedMeasures, opts.targetSize ?? null),
    );
    const costBlockBase = formatCostBlock(rankedMeasures);
    // X7e: 適合したエビデンスの財政効果率分布（2件未満は出さない）
    const fiscalBlock = formatFiscalRateBlock(
      fiscalRateStats(rankedEvidence.map(({ row }) => row.fiscal_effect_rate)),
    );
    const costBlock =
      [costBlockBase, estimateBlock, fiscalBlock].filter(Boolean).join("\n\n") || null;

    return {
      mode,
      measureBlock: formatMeasureBlock(rankedMeasures),
      evidenceBlock: formatEvidenceBlock(rankedEvidence),
      costBlock,
      hits: { measures: rankedMeasures.length, evidence: rankedEvidence.length },
    };
  } catch (e) {
    console.warn("コーパス接地に失敗（接地なしで続行）:", e);
    return NO_GROUNDING;
  }
}

// ─── corpus_context の接地（X7e — As-Is対話への環境情報注入）──

export interface ContextGroundingResult {
  mode: "claude" | "shadow" | "assist" | "primary";
  contextBlock: string | null;
  hits: number;
}

const NO_CONTEXT: ContextGroundingResult = { mode: "claude", contextBlock: null, hits: 0 };

/**
 * SWOT素材（policy_package/legal_system/subsidy_program/regional_stat/trend）の接地。
 * - 対象は approved かつ **期限内**（effective_until 超過は自動除外 — 制度改廃で嘘をつかない）
 * - フェーズで種別を絞る: external(O/T)=政策・制度・公募・トレンド / internal(S/W)=地域統計
 * - 地域の加点は match.ts scoreContext（region_code一致 > 都道府県 > 規模帯 > 全国）
 * - 適合度しきい値未満は出さない（接地の大原則）
 */
export async function retrieveContextGrounding(opts: {
  taskType: AiTaskType;
  projectId: string | null;
  contextId?: string | null;
  queryText: string;
  /** As-Isのフェーズ。external=外部環境(O/T) / internal=内部環境(S/W) / null=両方 */
  phase?: "external" | "internal" | null;
  region?: ContextMatchOpts;
}): Promise<ContextGroundingResult> {
  try {
    const routing = await getTaskRouting(opts.taskType);
    const mode = resolveEffectiveMode(routing.mode);
    if (mode === "claude") return NO_CONTEXT;

    const q = bigrams(opts.queryText);
    if (q.size === 0) return NO_CONTEXT;

    const kinds =
      opts.phase === "external"
        ? ["policy_package", "legal_system", "subsidy_program", "trend"]
        : opts.phase === "internal"
          ? ["regional_stat"]
          : ["policy_package", "legal_system", "subsidy_program", "trend", "regional_stat"];

    const t0 = Date.now();
    const rows = await query<CorpusContextForMatch>(
      `SELECT id, kind, title, body, pestle_tag, seven_s_tag, swot_hint,
              region_scope, region_code, population_band, field_category,
              source_org, source_url, published_at::text AS published_at,
              effective_until::text AS effective_until
       FROM corpus_context
       WHERE status = 'approved'
         AND kind = ANY($1::text[])
         AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
       ORDER BY updated_at DESC LIMIT 300`,
      [kinds],
    );

    const ranked = rank(rows, (r) => scoreContext(q, r, opts.region), {
      limit: 5,
      minScore: 3,
    });
    const latency = Date.now() - t0;
    const injected = mode !== "shadow";

    try {
      await queryOne(
        `INSERT INTO ai_grounding_logs
           (task_type, mode, project_id, context_id, query_summary,
            corpus_context_ids, injected, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8) RETURNING id`,
        [
          opts.taskType,
          mode,
          opts.projectId,
          opts.contextId ?? null,
          opts.queryText.slice(0, 300),
          ranked.map((r) => r.row.id),
          injected,
          latency,
        ],
      );
    } catch (e) {
      console.warn("context接地ログの記録に失敗:", e);
    }

    return {
      mode,
      contextBlock: injected ? formatContextBlock(ranked) : null,
      hits: ranked.length,
    };
  } catch (e) {
    console.warn("context接地に失敗（接地なしで続行）:", e);
    return NO_CONTEXT;
  }
}

/**
 * 粗い採択記録: 接地した対話が commit（書き出し）まで到達したら
 * その対話の接地ログを adopted=true にする。
 * ※ v0 の定義（個別提案単位の採択ではない）。gateway 側 ai_usage_logs の
 *   adopted 集計もこの定義で読むこと。
 */
export async function markGroundingAdopted(contextId: string): Promise<void> {
  try {
    await query(
      `UPDATE ai_grounding_logs
       SET adopted = true, adopted_at = now()
       WHERE context_id = $1 AND adopted IS DISTINCT FROM true`,
      [contextId],
    );
  } catch (e) {
    console.warn("採択記録に失敗:", e);
  }
}
