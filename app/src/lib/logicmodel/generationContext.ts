/**
 * ロジックモデルAI生成の入力コンテキスト（L4）
 *
 * ── なぜ必要か ─────────────────────────────────────────────
 * これまでAI生成に渡していたのは政策名・概要・KPIラベルだけだった。
 * その結果、生成されるロジックモデルは
 *   「どの自治体でも通用する一般論」
 * にしかならず、上流工程（ギャップ分析・現状整理・課題仮説）で
 * 積み上げた事実がまったく反映されていなかった。
 *
 * QCストーリーの筋は
 *   現状把握 → 目標設定 → 要因解析（真因）→ 対策立案
 * であり、ロジックモデルは「対策立案」にあたる。
 * 真因を渡さずに対策を書かせるのは、この筋を飛ばすことになる。
 *
 * ここで上流の成果物を集約し、
 * 「この差（ギャップ）を、この真因に対して、こう埋める」
 * という形で生成させる。
 *
 * ── 妥当性について ─────────────────────────────────────────
 * 生成物が「なぜその活動なのか」を問われたとき、
 * 根拠として示せるのは上流の分析結果である。
 * どの分析を使ったかは戻り値の sourceIds に残し、
 * 成果物レジストリ（module_artifacts）へリネージとして記録する。
 */

import { query, queryOne } from "@/lib/db";

export interface GapRow {
  id: string;
  indicator_name: string;
  indicator_unit: string | null;
  current_value: number | null;
  target_value: number | null;
  gap_value: number | null;
  current_year: number | null;
  trend: string | null;
  affected_population: number | null;
  notes: string | null;
}

export interface HypothesisRow {
  id: string;
  title: string;
  description: string | null;
  root_cause: string | null;
  proposed_measures: string[] | null;
  evidence_sources: string[] | null;
}

export interface GenerationContext {
  /** プロンプトに差し込む本文（空文字なら渡すものが無い） */
  text: string;
  /** リネージに残す出所 */
  sourceIds: {
    gapAnalysisIds: string[];
    issueHypothesisIds: string[];
    issueDialogueIds: string[];
    /** 施策構築（EBPM）の確定済みデータセット — E4 */
    measureDesignIds: string[];
  };
  /** 画面に「何を根拠にしたか」を出すための要約 */
  summary: string[];
}

const TREND_LABEL: Record<string, string> = {
  improving: "改善傾向",
  worsening: "悪化傾向",
  stable: "横ばい",
  unknown: "傾向不明",
};

function fmt(v: number | null | undefined, unit: string | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v) >= 1000 ? v.toLocaleString("ja-JP") : String(v);
  return `${s}${unit ?? ""}`;
}

/**
 * 上流工程の成果物を集めてプロンプト用のテキストにする。
 *
 * @param projectId 対象プロジェクト
 * @param issueHypothesisId 明示的に選ばれた課題仮説。無ければプロジェクトの採用済み仮説を使う
 */
export async function buildGenerationContext(
  projectId: string,
  issueHypothesisId?: string | null,
): Promise<GenerationContext> {
  const sourceIds = {
    gapAnalysisIds: [] as string[],
    issueHypothesisIds: [] as string[],
    issueDialogueIds: [] as string[],
    measureDesignIds: [] as string[],
  };
  const summary: string[] = [];
  const blocks: string[] = [];

  // ── 1. ギャップ分析（現状と目標の差）──────────────────
  const gaps = await query<GapRow>(
    `SELECT id, indicator_name, indicator_unit,
            current_value::float AS current_value,
            target_value::float  AS target_value,
            gap_value::float     AS gap_value,
            current_year, trend,
            affected_population::float AS affected_population,
            notes
     FROM gap_analyses
     WHERE project_id = $1
     ORDER BY priority_score DESC NULLS LAST, created_at
     LIMIT 12`,
    [projectId],
  ).catch(() => [] as GapRow[]);

  if (gaps.length > 0) {
    const lines = gaps.map((g) => {
      const parts = [
        `- ${g.indicator_name}: 現状 ${fmt(g.current_value, g.indicator_unit)}` +
          (g.current_year ? `（${g.current_year}年）` : "") +
          ` → 目標 ${fmt(g.target_value, g.indicator_unit)}` +
          `（差 ${fmt(g.gap_value, g.indicator_unit)}）`,
      ];
      if (g.trend) parts.push(`  傾向: ${TREND_LABEL[g.trend] ?? g.trend}`);
      if (g.affected_population != null)
        parts.push(`  影響人口: ${fmt(g.affected_population, "人")}`);
      if (g.notes) parts.push(`  備考: ${g.notes}`);
      return parts.join("\n");
    });
    blocks.push(`【現状と目標の差（ギャップ分析）】\n${lines.join("\n")}`);
    sourceIds.gapAnalysisIds = gaps.map((g) => g.id);
    summary.push(`ギャップ分析 ${gaps.length}件`);
  }

  // ── 2. 課題仮説と真因 ────────────────────────────────
  // 明示指定があればそれを最優先。無ければ採用済み → 優先順位順。
  const hyps = issueHypothesisId
    ? await query<HypothesisRow>(
        `SELECT id, title, description, root_cause, proposed_measures, evidence_sources
         FROM issue_hypotheses WHERE id = $1`,
        [issueHypothesisId],
      ).catch(() => [] as HypothesisRow[])
    : await query<HypothesisRow>(
        `SELECT id, title, description, root_cause, proposed_measures, evidence_sources
         FROM issue_hypotheses
         WHERE project_id = $1 AND status IN ('adopted', 'verified', 'confirmed')
         ORDER BY priority_rank NULLS LAST, created_at
         LIMIT 5`,
        [projectId],
      ).catch(() => [] as HypothesisRow[]);

  if (hyps.length > 0) {
    const lines = hyps.map((h) => {
      const parts = [`- 課題: ${h.title}`];
      if (h.description) parts.push(`  内容: ${h.description}`);
      if (h.root_cause) parts.push(`  真因: ${h.root_cause}`);
      if (h.proposed_measures && h.proposed_measures.length > 0)
        parts.push(`  想定される対策: ${h.proposed_measures.join("、")}`);
      if (h.evidence_sources && h.evidence_sources.length > 0)
        parts.push(`  根拠資料: ${h.evidence_sources.join("、")}`);
      return parts.join("\n");
    });
    blocks.push(`【解決すべき課題と真因（課題仮説設定）】\n${lines.join("\n")}`);
    sourceIds.issueHypothesisIds = hyps.map((h) => h.id);
    summary.push(`課題仮説 ${hyps.length}件`);
  }

  // ── 3. 対話で到達した真因（issue_dialogues）───────────
  // 課題仮説へ書き出す前でも、対話で真因まで到達していれば使う。
  const dialogue = await queryOne<{ id: string; root_causes: unknown }>(
    `SELECT id, root_causes FROM issue_dialogues
     WHERE project_id = $1 AND jsonb_array_length(root_causes) > 0
     ORDER BY updated_at DESC LIMIT 1`,
    [projectId],
  ).catch(() => null);

  if (dialogue && Array.isArray(dialogue.root_causes) && dialogue.root_causes.length > 0) {
    const causes = dialogue.root_causes
      .map((r) => {
        if (typeof r !== "object" || r === null) return "";
        const o = r as Record<string, unknown>;
        const rc = typeof o["root_cause"] === "string" ? o["root_cause"] : "";
        return rc.trim();
      })
      .filter((s) => s !== "");

    if (causes.length > 0 && sourceIds.issueHypothesisIds.length === 0) {
      // 課題仮説がまだ書き出されていない場合の補完
      blocks.push(
        `【対話で到達した真因（課題仮説設定の途中経過）】\n${causes.map((c) => `- ${c}`).join("\n")}`,
      );
      sourceIds.issueDialogueIds = [dialogue.id];
      summary.push(`真因分析 ${causes.length}件`);
    }
  }

  // ── 4. 構築済みの施策（施策構築モジュール・E4）──────────
  // 確定済み（confirmed）の施策データセット。
  // エビデンス・実験設計・指標まで揃った施策があるなら、
  // ロジックモデルの「活動」はそれをそのまま使うべきで、AIに再発明させない。
  interface MeasureRow {
    id: string;
    title: string;
    approach: string | null;
    target_population: string | null;
    intervention: string | null;
    evidence_status: string;
    experiment: { design?: string } | null;
  }
  const measures = await query<MeasureRow>(
    `SELECT id, title, approach, target_population, intervention,
            evidence_status, experiment
     FROM measure_designs
     WHERE project_id = $1 AND status = 'confirmed'
     ORDER BY sort_order, created_at
     LIMIT 10`,
    [projectId],
  ).catch(() => [] as MeasureRow[]);

  if (measures.length > 0) {
    const lines = measures.map((m) => {
      const parts = [`- ${m.title}`];
      if (m.approach) parts.push(`  作用機序: ${m.approach}`);
      if (m.target_population) parts.push(`  対象: ${m.target_population}`);
      if (m.intervention) parts.push(`  介入: ${m.intervention}`);
      parts.push(
        `  エビデンス: ${m.evidence_status}${
          m.experiment?.design ? `（実験設計: ${m.experiment.design}）` : ""
        }`,
      );
      return parts.join("\n");
    });
    blocks.push(
      `【構築済みの施策（施策構築モジュールで確定済み）】\n${lines.join("\n")}\n` +
        `※ 実施活動はこれらの施策をそのまま使ってください。別の活動を発明しないでください。`,
    );
    sourceIds.measureDesignIds = measures.map((m) => m.id);
    summary.push(`確定済み施策 ${measures.length}件`);
  }

  return {
    text: blocks.length > 0 ? blocks.join("\n\n") : "",
    sourceIds,
    summary,
  };
}

/**
 * 上流の分析があるときにAIへ与える追加指示。
 * 「一般論を書かせない」ためにここで縛る。
 */
export const GROUNDING_INSTRUCTION = `
上に示した現状と目標の差、および真因は、この自治体で実際に確認された事実です。
ロジックモデルは次の条件を満たしてください。

1. 実施活動は、示された真因に対処するものにしてください。
   真因と対応しない一般的な施策（「啓発の推進」「連携の強化」など、
   どの自治体にも当てはまる表現）は書かないでください。
2. 短期・中間アウトカムは、示されたギャップを埋める向きの変化として書いてください。
   可能な場合はギャップ分析の指標名をそのまま使ってください。
3. 投入資源は、示された影響人口や差の大きさに見合う規模にしてください。
`.trim();
