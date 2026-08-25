import "server-only";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { query, queryOne } from "@/lib/db";
import { aiCreateMessage } from "@/lib/ai/gateway";
import {
  getAdapter,
  htmlToText,
  type HarvestListItem,
} from "@/lib/corpus/harvest/adapters";
import {
  makeAutoSourceKey,
  sanitizeHarvestEvidence,
  type HarvestEvidenceInput,
} from "@/lib/corpus/harvest/types";

/**
 * 収集エンジン — X7a（アダプタA: 構造化ソース）
 *
 * 1回の呼び出しで「1ソース」だけ処理する（AmplifyのAPIタイムアウト対策。
 * 長時間ジョブを Next.js に持たせない — 設計 §2）。
 *
 * 流れ:
 *  1. 一覧ページ取得 → last_content_hash と比較。変化なければ items_found=0 で終了
 *     （トークン消費ゼロ）
 *  2. 新規エントリの本文を取得（HTML/PDF）→ ゲートウェイ経由で構造化抽出
 *     （taskType: knowledge.harvest。推測禁止・出典必須・レベル正直判定）
 *  3. sanitizeHarvestEvidence の機械防御を通過した行だけ corpus_evidence へ
 *     status='pending' で INSERT（ON CONFLICT DO NOTHING — 検収済み行を上書きしない）
 *  4. 重複スキャン（pg_trgm 類似度 0.6 以上に dup_of を付けるだけ。自動では落とさない）
 *  5. run 集計（件数・トークン・件名レベルの明細ログ）を書いて終了
 */

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 60_000;
const DUP_THRESHOLD = 0.6;
const USER_AGENT = "CoeCorpusHarvester/1.0 (EBPM corpus builder; contact: ordoservice.com@gmail.com)";

// ─── 対象ソースの選定 ─────────────────────────────────────

export interface DueSource {
  id: string;
  name: string;
}

const DUE_CONDITION = `
  s.enabled
  AND s.crawl_frequency <> 'manual'
  AND (
    s.last_crawled_at IS NULL
    OR (s.crawl_frequency = 'weekly'  AND s.last_crawled_at < now() - interval '7 days')
    OR (s.crawl_frequency = 'monthly' AND s.last_crawled_at < now() - interval '30 days')
  )
  AND NOT EXISTS (
    SELECT 1 FROM corpus_harvest_runs r
    WHERE r.source_id = s.id AND r.status = 'running'
      AND r.started_at > now() - interval '30 minutes'
  )`;

/** 期限が来た enabled ソースを1つ返す（最も古いものから） */
export async function pickDueSource(): Promise<DueSource | null> {
  return queryOne<DueSource>(
    `SELECT s.id, s.name FROM corpus_sources s
     WHERE ${DUE_CONDITION}
     ORDER BY s.last_crawled_at ASC NULLS FIRST
     LIMIT 1`,
  );
}

/** 残りの対象ソース数（Lambda側の再呼び出し判断用） */
export async function countDueSources(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM corpus_sources s WHERE ${DUE_CONDITION}`,
  );
  return Number(row?.n ?? 0);
}

/** 検収待ちの総数（溜めすぎ防止の判断材料 — 設計 §3-4） */
export async function countPendingReview(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT (
       (SELECT count(*) FROM corpus_evidence WHERE status = 'pending')
     + (SELECT count(*) FROM corpus_measures WHERE status = 'pending')
     + (SELECT count(*) FROM corpus_context  WHERE status = 'pending')
     )::text AS n`,
  );
  return Number(row?.n ?? 0);
}

/** 検収残がこの件数を超えたらスケジュール巡回を一時停止する（手動実行は可） */
export const REVIEW_BACKLOG_LIMIT = 2000;

// ─── 取得の小道具 ─────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf,*/*" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** アイテム本文をテキスト化（HTML / PDF。PDFは pdf-parse — 既存の抽出ルートと同方式） */
async function fetchItemText(url: string): Promise<{ text: string; kind: "html" | "pdf" }> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const isPdf = contentType.includes("pdf") || /\.pdf(\?|$)/i.test(url);
  if (isPdf) {
    const buffer = Buffer.from(await res.arrayBuffer());
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return { text: result.text.slice(0, MAX_BODY_CHARS), kind: "pdf" };
  }
  const html = await res.text();
  return { text: htmlToText(html).slice(0, MAX_BODY_CHARS), kind: "html" };
}

// ─── AI抽出（ゲートウェイ経由・knowledge.harvest） ─────────

const HARVEST_TOOL: Anthropic.Tool = {
  name: "record_harvest",
  description: "収集した資料から効果検証・調査研究の結果を構造化して記録します。",
  input_schema: {
    type: "object",
    properties: {
      evidence: {
        type: "array",
        description: "資料に記載されている効果検証・調査研究の結果（最大20件）",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "検証・研究の内容が分かる題名" },
            source: { type: "string", description: "出典（資料名・機関・著者・年）— 必ず書く" },
            url: { type: "string", description: "出典URL（分かる場合）" },
            year: { type: "number" },
            design: {
              type: "string",
              enum: ["sr", "rct", "qed", "prepost", "case"],
              description:
                "研究デザイン。本文の記載から正直に判定: RCT明記=rct / 対照群あり無作為不明=qed / 前後比較=prepost / 事例=case。判定できなければ case",
            },
            evidence_level: {
              type: "number",
              description: "1〜5（design の既定でよい。過大評価しない）",
            },
            population: { type: "string", description: "検証の対象集団" },
            effect_summary: { type: "string", description: "効果の要約（数値は記載どおり）" },
            transferability: {
              type: "string",
              description: "対象・環境の特性（外的妥当性の判断材料。海外ソースでは必須）",
            },
            field_category: { type: "string", description: "分野（介護予防・健診 等）" },
            source_note: { type: "string", description: "資料内の該当箇所（章・ページ等）" },
            output_summary: {
              type: "string",
              description: "アウトプット: 何をどれだけ提供したか（例: サロン週1回×24ヶ月）",
            },
            outcome_summary: {
              type: "string",
              description: "変化したアウトカム指標と変化量（本文の記載どおり）",
            },
            outcome_tier: {
              type: "string",
              enum: ["outcome_initial", "outcome_intermediate", "outcome_long"],
              description: "アウトカムの層: 概ね1年内=initial / 2〜5年=intermediate / それ以上=long",
            },
            effect_size_type: {
              type: "string",
              enum: ["rate_diff", "mean_diff", "rr", "or", "hr", "irr", "cohen_d", "other"],
            },
            effect_size_value: { type: "number", description: "効果量の点推定値（本文にある場合のみ）" },
            ci_low: { type: "number", description: "95%CI下限（本文にある場合のみ）" },
            ci_high: { type: "number", description: "95%CI上限（本文にある場合のみ）" },
            p_value: { type: "number", description: "p値（本文にある場合のみ）" },
            stat_method: { type: "string", description: "統計手法（DiD・ロジスティック回帰 等）" },
            sample_size: { type: "number", description: "標本規模（本文にある場合のみ）" },
            followup_months: { type: "number", description: "追跡期間（月。本文にある場合のみ）" },
            fiscal_effect_amount: {
              type: "number",
              description: "財政効果額（円換算。本文にある場合のみ）",
            },
            fiscal_effect_unit: {
              type: "string",
              enum: ["per_person_total", "per_person_year", "total_year", "other"],
            },
            fiscal_effect_basis: {
              type: "string",
              description: "何の財政か（給付費/医療費/扶助費/税収/事業費削減 等）",
            },
            fiscal_effect_rate: {
              type: "number",
              description: "財政効果率＝財政効果額（年換算）÷事業費（本文から算定可能な場合のみ）",
            },
            fiscal_horizon_years: { type: "number", description: "効果の発現・計測期間（年）" },
            fiscal_note: { type: "string", description: "算定根拠・割引率・通貨換算の注記" },
          },
          required: ["title", "source", "effect_summary"],
        },
      },
    },
    required: ["evidence"],
  },
};

function buildSystemPrompt(sourceOrg: string, promptHint: string): string {
  return `あなたは日本の自治体政策のアナリストです。
自動収集した公開資料から、効果検証・調査研究の結果を record_harvest ツールで構造化してください。
収集元: ${sourceOrg}

【厳守 — コーパス汚染の防止】
- **資料に書かれている事実だけ**を記録する。推測・補完・一般論の追加をしない。
- 数値（効果量・CI・p値・標本規模・財政効果額）は**本文に記載がある場合のみ**記載どおりに写す。
  無ければ該当フィールドを出さない（空欄のままにする）。単位を変えない。
- design は正直に判定する。無作為割付の明記が無いのに rct にしない。
  対照群の記述が無ければ prepost か case。evidence_level を過大にしない。
- 出典（source）と資料内の該当箇所（source_note）を必ず付ける。
- アウトプット→アウトカムの対応が読み取れる場合のみ output_summary / outcome_summary を書く。
- 該当する情報が無ければ空配列でよい（無理に拾わない）。
- この結果は検収担当者の承認を経て自治体横断の学習データになる。
  誤った構造化は下流の政策提案の妥当性を壊すことを意識する。

【このソースの特記】
${promptHint}`;
}

// ─── 実行本体 ─────────────────────────────────────────────

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  adapter: string;
  enabled: boolean;
  license_note: string;
  last_content_hash: string | null;
}

type LogEntry = {
  kind: "new" | "known" | "rejected" | "error" | "info";
  title: string;
  url?: string;
  note?: string;
};

export interface HarvestSummary {
  runId: string;
  sourceId: string;
  sourceName: string;
  status: "succeeded" | "partial" | "failed";
  pagesFetched: number;
  itemsFound: number;
  itemsNew: number;
  itemsDuplicate: number;
  itemsRejected: number;
  inputTokens: number;
  outputTokens: number;
  errorSummary: string | null;
}

/**
 * 1ソースの収集を実行する。呼び出し側の責務:
 *  - cron: x-cron-key 認証・pickDueSource での選定
 *  - 手動: 管理者セッション認可
 */
export async function runHarvest(
  sourceId: string,
  trigger: "scheduled" | "manual",
): Promise<HarvestSummary> {
  const source = await queryOne<SourceRow>(
    `SELECT id, name, kind, base_url, adapter, enabled, license_note, last_content_hash
     FROM corpus_sources WHERE id = $1`,
    [sourceId],
  );
  if (!source) throw new Error("ソースが見つかりません");
  if (!source.enabled) throw new Error("このソースは無効です（有効化はライセンス確認後に）");
  const adapter = getAdapter(source.adapter);
  if (!adapter) throw new Error(`未実装のアダプタです: ${source.adapter}`);

  const run = await queryOne<{ id: string }>(
    `INSERT INTO corpus_harvest_runs (source_id, trigger) VALUES ($1, $2) RETURNING id`,
    [source.id, trigger],
  );
  if (!run) throw new Error("収集runの作成に失敗しました");

  const log: LogEntry[] = [];
  let pagesFetched = 0;
  let itemsFound = 0;
  let itemsNew = 0;
  let itemsDuplicate = 0;
  let itemsRejected = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let itemErrors = 0;
  let errorSummary: string | null = null;

  const finalize = async (status: "succeeded" | "partial" | "failed") => {
    await query(
      `UPDATE corpus_harvest_runs SET
         status = $2, finished_at = now(), pages_fetched = $3, items_found = $4,
         items_new = $5, items_duplicate = $6, items_rejected_by_sanitize = $7,
         input_tokens = $8, output_tokens = $9, error_summary = $10, log = $11::jsonb
       WHERE id = $1`,
      [
        run.id,
        status,
        pagesFetched,
        itemsFound,
        itemsNew,
        itemsDuplicate,
        itemsRejected,
        inputTokens,
        outputTokens,
        errorSummary,
        JSON.stringify(log.slice(0, 200)),
      ],
    );
    return {
      runId: run.id,
      sourceId: source.id,
      sourceName: source.name,
      status,
      pagesFetched,
      itemsFound,
      itemsNew,
      itemsDuplicate,
      itemsRejected,
      inputTokens,
      outputTokens,
      errorSummary,
    } satisfies HarvestSummary;
  };

  // 1. 一覧ページ取得 → 差分検知
  let listHtml: string;
  try {
    const res = await fetchWithTimeout(source.base_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    listHtml = await res.text();
    pagesFetched++;
  } catch (e) {
    errorSummary = `一覧ページの取得に失敗: ${e instanceof Error ? e.message : String(e)}`;
    return finalize("failed");
  }

  const contentHash = createHash("sha256").update(htmlToText(listHtml)).digest("hex");
  if (contentHash === source.last_content_hash) {
    log.push({ kind: "info", title: "一覧ページに変化なし（トークン消費ゼロで終了）" });
    await query(`UPDATE corpus_sources SET last_crawled_at = now(), updated_at = now() WHERE id = $1`, [
      source.id,
    ]);
    return finalize("succeeded");
  }

  // 2. 候補アイテムの抽出と既知判定
  const items = adapter.listItems(listHtml, source.base_url);
  itemsFound = items.length;
  if (items.length === 0) {
    log.push({ kind: "info", title: "一覧から候補アイテムを抽出できませんでした（ページ構造の変化の可能性）" });
  }

  const newItems: HarvestListItem[] = [];
  for (const item of items) {
    const sourceKey = makeAutoSourceKey(adapter.key, item.stableId);
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM corpus_evidence WHERE source_key = $1 OR source_key LIKE $1 || ':%' LIMIT 1`,
      [sourceKey],
    );
    if (existing) {
      itemsDuplicate++;
      continue;
    }
    newItems.push(item);
  }

  const capped = newItems.slice(0, adapter.itemLimitPerRun);
  if (newItems.length > capped.length) {
    // 上限で落とした分は黙って切らずに明細へ残す（次回のrunで処理される）
    log.push({
      kind: "info",
      title: `新規${newItems.length}件のうち${capped.length}件のみ処理（1回の上限。残りは次回）`,
    });
  }

  // 3. 各アイテム: 本文取得 → AI抽出 → sanitize → pending 投入
  const insertedIds: string[] = [];
  for (const item of capped) {
    try {
      const body = await fetchItemText(item.url);
      pagesFetched++;
      if (!body.text.trim()) {
        log.push({ kind: "error", title: item.title, url: item.url, note: "本文テキストが空（画像PDFの可能性）" });
        itemErrors++;
        continue;
      }

      const message = await aiCreateMessage(
        { taskType: "knowledge.harvest" },
        {
          max_tokens: 4000,
          system: [
            {
              type: "text",
              text: buildSystemPrompt(adapter.sourceOrg, adapter.promptHint),
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: [HARVEST_TOOL],
          tool_choice: { type: "tool", name: "record_harvest" },
          messages: [
            {
              role: "user",
              content: `資料名: ${item.title}\nURL: ${item.url}\n\n----- 資料本文（${body.kind}） -----\n${body.text}`,
            },
          ],
        },
      );
      inputTokens += message.usage?.input_tokens ?? 0;
      outputTokens += message.usage?.output_tokens ?? 0;

      const toolUse = message.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_harvest",
      );
      if (!toolUse) {
        log.push({ kind: "error", title: item.title, url: item.url, note: "AI応答の解析に失敗" });
        itemErrors++;
        continue;
      }

      const { rows, rejected } = sanitizeHarvestEvidence(toolUse.input, {
        overseas: adapter.overseas,
      });
      itemsRejected += rejected.length;
      for (const r of rejected) {
        log.push({ kind: "rejected", title: r.title, url: item.url, note: r.reason });
      }

      let seq = 0;
      for (const row of rows) {
        const sourceKey =
          rows.length === 1
            ? makeAutoSourceKey(adapter.key, item.stableId)
            : makeAutoSourceKey(adapter.key, `${item.stableId}:${++seq}`);
        const id = await insertHarvestEvidence(row, {
          sourceKey,
          harvestRunId: run.id,
          fallbackUrl: item.url,
          sourceOrg: adapter.sourceOrg,
          itemTitle: item.title,
        });
        if (id) {
          itemsNew++;
          insertedIds.push(id);
          log.push({ kind: "new", title: row.title, url: row.url ?? item.url });
        } else {
          itemsDuplicate++;
          log.push({ kind: "known", title: row.title, url: item.url, note: "既存の source_key（スキップ）" });
        }
      }
    } catch (e) {
      itemErrors++;
      log.push({
        kind: "error",
        title: item.title,
        url: item.url,
        note: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 4. 重複スキャン（付けるだけ。自動では落とさない）
  try {
    for (const id of insertedIds) {
      await markDuplicates(id);
    }
  } catch (e) {
    log.push({ kind: "error", title: "重複スキャンに失敗", note: e instanceof Error ? e.message : String(e) });
  }

  // 5. ソースの巡回記録と run 集計
  await query(
    `UPDATE corpus_sources SET last_crawled_at = now(), last_content_hash = $2, updated_at = now()
     WHERE id = $1`,
    [source.id, contentHash],
  );
  if (itemErrors > 0) {
    errorSummary = `${itemErrors}件のアイテム処理に失敗（明細はログ参照）`;
    return finalize("partial");
  }
  return finalize("succeeded");
}

// ─── DB書き込み ───────────────────────────────────────────

async function insertHarvestEvidence(
  row: HarvestEvidenceInput,
  meta: {
    sourceKey: string;
    harvestRunId: string;
    fallbackUrl: string;
    sourceOrg: string;
    itemTitle: string;
  },
): Promise<string | null> {
  const sourceNote = row.source_note
    ? `${meta.sourceOrg} / ${row.source_note}`
    : `${meta.sourceOrg} / ${meta.itemTitle}`;
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO corpus_evidence
       (status, field_category, population_band, title, source, url, year,
        design, evidence_level, population, effect_summary, transferability,
        source_kind, source_key, contributor_key, source_note, harvest_run_id,
        output_summary, outcome_summary, outcome_tier,
        effect_size_type, effect_size_value, ci_low, ci_high, p_value,
        stat_method, sample_size, followup_months,
        fiscal_effect_amount, fiscal_effect_unit, fiscal_effect_basis,
        fiscal_effect_rate, fiscal_horizon_years, fiscal_note)
     VALUES ('pending', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             'harvest', $12, NULL, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
             $26, $27, $28, $29, $30, $31)
     ON CONFLICT (source_key) DO NOTHING
     RETURNING id`,
    [
      row.field_category,
      row.population_band,
      row.title,
      row.source,
      row.url ?? meta.fallbackUrl,
      row.year,
      row.design,
      row.evidence_level,
      row.population,
      row.effect_summary,
      row.transferability,
      meta.sourceKey,
      sourceNote,
      meta.harvestRunId,
      row.output_summary,
      row.outcome_summary,
      row.outcome_tier,
      row.effect_size_type,
      row.effect_size_value,
      row.ci_low,
      row.ci_high,
      row.p_value,
      row.stat_method,
      row.sample_size,
      row.followup_months,
      row.fiscal_effect_amount,
      row.fiscal_effect_unit,
      row.fiscal_effect_basis,
      row.fiscal_effect_rate,
      row.fiscal_horizon_years,
      row.fiscal_note,
    ],
  );
  return inserted?.id ?? null;
}

/**
 * 重複の疑いを付ける（pg_trgm・タイトル＋出典の類似度 0.6 以上の最上位1件）。
 * 付けるだけで自動では絶対に落とさない — 「重複として却下/別物として承認」は検収者の判断。
 */
async function markDuplicates(evidenceId: string): Promise<void> {
  await query(
    `UPDATE corpus_evidence e SET dup_of = d.id, dup_score = d.score
     FROM (
       SELECT c.id, similarity(c.title || ' ' || c.source, s.title || ' ' || s.source) AS score
       FROM corpus_evidence c, corpus_evidence s
       WHERE s.id = $1 AND c.id <> $1
         AND c.status <> 'rejected'
         AND similarity(c.title || ' ' || c.source, s.title || ' ' || s.source) >= $2
       ORDER BY score DESC
       LIMIT 1
     ) d
     WHERE e.id = $1`,
    [evidenceId, DUP_THRESHOLD],
  );
}
