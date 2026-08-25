/**
 * 自律コーパス収集の語彙とサニタイズ（純粋・テスト可能）— X7a
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * corpus_sources / corpus_harvest_runs / corpus_context（042）と
 * 収集エンジンの語彙・防御はここに集約する。エンジン・API・画面・
 * 検査スクリプト（check:harvest）はここだけを参照する。
 *
 * ── 品質原則（X3から継承） ─────────────────────────────────
 * - 無確認の自動登録をしない: 自動収集は status='pending' 投入まで
 * - 全行出典必須・source_key 冪等・推測禁止（数値は本文にある場合のみ転記）
 * - 重複は dup_of を付けるだけ。自動では絶対に落とさない（判断は検収者）
 *
 * 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第1部。
 */

import type { CorpusEvidenceInput } from "@/lib/corpus/types";
import type { OutcomeTier } from "@/lib/outcome/tiers";
import type { PestleKey, SevenSKey } from "@/lib/asis/types";

// ─── ソースレジストリの語彙（042 の CHECK と同一） ─────────

export const HARVEST_SOURCE_KINDS = [
  { key: "structured_db", label: "構造化ソース" },
  { key: "pdf_repository", label: "PDFリポジトリ" },
  { key: "press", label: "プレス・広報" },
] as const;

export type HarvestSourceKind = (typeof HARVEST_SOURCE_KINDS)[number]["key"];

export const CRAWL_FREQUENCIES = [
  { key: "weekly", label: "週次", days: 7 },
  { key: "monthly", label: "月次", days: 30 },
  { key: "manual", label: "手動のみ", days: null },
] as const;

export type CrawlFrequency = (typeof CRAWL_FREQUENCIES)[number]["key"];

export const HARVEST_RUN_STATUS = [
  { key: "running", label: "実行中", color: "#6366f1" },
  { key: "succeeded", label: "成功", color: "#10b981" },
  { key: "partial", label: "一部失敗", color: "#f59e0b" },
  { key: "failed", label: "失敗", color: "#ef4444" },
] as const;

export type HarvestRunStatus = (typeof HARVEST_RUN_STATUS)[number]["key"];

export const HARVEST_RUN_STATUS_META = Object.fromEntries(
  HARVEST_RUN_STATUS.map((s) => [s.key, { label: s.label, color: s.color }]),
) as Record<HarvestRunStatus, { label: string; color: string }>;

/**
 * 検収の粒度（043 の CHECK と同一 — X7c §3-4）。
 * どのモードでも「無確認の自動登録をしない」は維持 —
 * 承認操作なしに approved には絶対ならない。変わるのは確認の粒度だけ。
 */
export const REVIEW_MODES = [
  { key: "full", label: "full — 1件ずつ精査", detail: "AI抽出を経る全行の既定。統計欄・財政欄も目視" },
  { key: "light", label: "light — 収集回まとめ承認", detail: "機械転記・AI不介在のソース向け。サンプル10件＋欠損サマリーを確認して収集回単位で承認" },
  { key: "spot", label: "spot — 10%抜き取り", detail: "低リスク種別。ランダム10%を目視→問題なければ残りをまとめ承認（問題があればfullに切替）" },
] as const;

export type ReviewMode = (typeof REVIEW_MODES)[number]["key"];

export const REVIEW_MODE_META = Object.fromEntries(
  REVIEW_MODES.map((m) => [m.key, { label: m.label, detail: m.detail }]),
) as Record<ReviewMode, { label: string; detail: string }>;

/** spot モードの抜き取り率 */
export const SPOT_SAMPLE_RATE = 0.1;

// ─── 統計的根拠・財政効果の語彙（042 の CHECK と同一） ──────

/** outcome_tier — kpis.indicator_type / lib/outcome/tiers.ts と同語彙（語彙分裂を作らない） */
export const HARVEST_OUTCOME_TIERS: readonly OutcomeTier[] = [
  "outcome_initial",
  "outcome_intermediate",
  "outcome_long",
] as const;

export const EFFECT_SIZE_TYPES = [
  { key: "rate_diff", label: "率の差" },
  { key: "mean_diff", label: "平均値の差" },
  { key: "rr", label: "リスク比 (RR)" },
  { key: "or", label: "オッズ比 (OR)" },
  { key: "hr", label: "ハザード比 (HR)" },
  { key: "irr", label: "発生率比 (IRR)" },
  { key: "cohen_d", label: "Cohen's d" },
  { key: "other", label: "その他" },
] as const;

export type EffectSizeType = (typeof EFFECT_SIZE_TYPES)[number]["key"];

export const FISCAL_EFFECT_UNITS = [
  { key: "per_person_total", label: "1人あたり累計" },
  { key: "per_person_year", label: "1人あたり年間" },
  { key: "total_year", label: "全体・年間" },
  { key: "other", label: "その他" },
] as const;

export type FiscalEffectUnit = (typeof FISCAL_EFFECT_UNITS)[number]["key"];

// ─── corpus_context の語彙（042 の CHECK と同一） ───────────

export const CONTEXT_KINDS = [
  { key: "policy_package", label: "政策パッケージ" },
  { key: "legal_system", label: "制度・法改正" },
  { key: "subsidy_program", label: "補助金・公募" },
  { key: "regional_stat", label: "地域統計" },
  { key: "trend", label: "トレンド" },
] as const;

export type ContextKind = (typeof CONTEXT_KINDS)[number]["key"];

export const SWOT_HINTS = ["opportunity", "threat", "strength", "weakness", "neutral"] as const;
export type SwotHint = (typeof SWOT_HINTS)[number];

export const REGION_SCOPES = ["national", "prefecture", "municipality"] as const;
export type RegionScope = (typeof REGION_SCOPES)[number];

// PESTLE / 7S は As-Is（lib/asis/types.ts）の語彙をそのまま使う
export const CONTEXT_PESTLE_TAGS: readonly PestleKey[] = ["P", "E", "S", "T", "L", "Env"];
export const CONTEXT_SEVEN_S_TAGS: readonly SevenSKey[] = [
  "strategy",
  "structure",
  "system",
  "shared_values",
  "skills",
  "staff",
  "style",
];

// ─── source_key 規約 ─────────────────────────────────────

/**
 * 自動収集行の source_key: `webseed:auto:<adapter>:<安定ID>`。
 * 既存の `webseed:…`（手動シード）・自治体供出の体系はそのまま。
 */
export function makeAutoSourceKey(adapter: string, stableId: string): string {
  const id = stableId.replace(/\s+/g, "-").slice(0, 120);
  return `webseed:auto:${adapter}:${id}`;
}

/** URLから安定IDを作る（パス末尾を使い、長すぎる場合は末尾を保持） */
export function stableIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    const tail = path.split("/").filter(Boolean).slice(-2).join("-") || u.hostname;
    return tail.slice(-100);
  } catch {
    return url.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);
  }
}

// ─── 巡回スケジュール（純関数） ───────────────────────────

/** 次回収集予定。manual は null（スケジュール収集の対象外） */
export function nextCrawlDue(
  frequency: CrawlFrequency,
  lastCrawledAt: Date | null,
  now: Date,
): Date | null {
  const meta = CRAWL_FREQUENCIES.find((f) => f.key === frequency);
  if (!meta || meta.days == null) return null;
  if (!lastCrawledAt) return now; // 一度も収集していなければ即時対象
  return new Date(lastCrawledAt.getTime() + meta.days * 24 * 60 * 60 * 1000);
}

/** スケジュール収集の対象か（enabled の確認は呼び出し側） */
export function isCrawlDue(
  frequency: CrawlFrequency,
  lastCrawledAt: Date | null,
  now: Date,
): boolean {
  const due = nextCrawlDue(frequency, lastCrawledAt, now);
  return due != null && due.getTime() <= now.getTime();
}

// ─── 収集行の形（corpus_evidence の拡張欄つき） ─────────────

export interface HarvestEvidenceInput extends CorpusEvidenceInput {
  // (a) 因果の統計的根拠 — 本文に数値がある場合のみ。無ければ null のまま
  output_summary: string | null;
  outcome_summary: string | null;
  outcome_tier: OutcomeTier | null;
  effect_size_type: EffectSizeType | null;
  effect_size_value: number | null;
  ci_low: number | null;
  ci_high: number | null;
  p_value: number | null;
  stat_method: string | null;
  sample_size: number | null;
  followup_months: number | null;
  // (b) 財政効果（fiscal_effect_rate ＝ 年換算財政効果額 ÷ 事業費 — 042参照）
  fiscal_effect_amount: number | null;
  fiscal_effect_unit: FiscalEffectUnit | null;
  fiscal_effect_basis: string | null;
  fiscal_effect_rate: number | null;
  fiscal_horizon_years: number | null;
  fiscal_note: string | null;
}

export interface HarvestRejection {
  title: string;
  reason: string;
}

export interface HarvestSanitizeResult {
  rows: HarvestEvidenceInput[];
  rejected: HarvestRejection[];
}

// ─── サニタイズ（機械防御 — sanitizeExtractionProposals と同系） ──

const MAX_EVIDENCE_PER_ITEM = 20;
const STUDY_DESIGN_KEYS = new Set(["sr", "rct", "qed", "prepost", "case"]);
const DESIGN_DEFAULT_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5> = {
  sr: 5,
  rct: 4,
  qed: 3,
  prepost: 2,
  case: 1,
};

const clip = (s: unknown, max: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const intOrNull = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/**
 * AIの収集抽出ツール出力を安全に取り込む。
 * - 必須欄（title / source / effect_summary）の無い行は捨てる（理由を記録）
 * - 海外ソース（overseas）は transferability（外的妥当性メモ）必須
 * - design 不正は case に落とし、レベルは design の既定に丸める
 * - 統計欄: 数値でないものは null。p値は 0〜1 のみ。CI は low ≤ high のみ
 * - 財政欄: 数値でないものは null。海外行の金額には参考値注記を付ける
 */
export function sanitizeHarvestEvidence(
  raw: unknown,
  opts: { overseas?: boolean } = {},
): HarvestSanitizeResult {
  const out: HarvestSanitizeResult = { rows: [], rejected: [] };
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o["evidence"]) ? o["evidence"] : [];

  for (const item of list.slice(0, MAX_EVIDENCE_PER_ITEM)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const title = clip(e["title"], 300);
    const source = clip(e["source"], 300);
    const effect = clip(e["effect_summary"], 1000);
    if (!title) {
      out.rejected.push({ title: "（無題）", reason: "title が空" });
      continue;
    }
    if (!source || !effect) {
      out.rejected.push({ title, reason: !source ? "出典（source）が空" : "効果の要約が空" });
      continue;
    }
    const transferability = clip(e["transferability"], 1000);
    if (opts.overseas && !transferability) {
      out.rejected.push({ title, reason: "海外ソースに外的妥当性メモ（transferability）が無い" });
      continue;
    }

    const design = STUDY_DESIGN_KEYS.has(String(e["design"]))
      ? (String(e["design"]) as HarvestEvidenceInput["design"])
      : "case";
    const defaultLevel = DESIGN_DEFAULT_LEVEL[design] ?? 1;
    const rawLevel = num(e["evidence_level"]);
    const level =
      rawLevel != null && rawLevel >= 1 && rawLevel <= 5
        ? (Math.round(rawLevel) as 1 | 2 | 3 | 4 | 5)
        : defaultLevel;

    // 統計欄の防御
    let ciLow = num(e["ci_low"]);
    let ciHigh = num(e["ci_high"]);
    if (ciLow != null && ciHigh != null && ciLow > ciHigh) {
      ciLow = null;
      ciHigh = null;
    }
    let pValue = num(e["p_value"]);
    if (pValue != null && (pValue < 0 || pValue > 1)) pValue = null;
    const effectSizeType = EFFECT_SIZE_TYPES.some((t) => t.key === e["effect_size_type"])
      ? (e["effect_size_type"] as EffectSizeType)
      : null;
    const outcomeTier = HARVEST_OUTCOME_TIERS.includes(e["outcome_tier"] as OutcomeTier)
      ? (e["outcome_tier"] as OutcomeTier)
      : null;

    // 財政欄の防御
    const fiscalUnit = FISCAL_EFFECT_UNITS.some((u) => u.key === e["fiscal_effect_unit"])
      ? (e["fiscal_effect_unit"] as FiscalEffectUnit)
      : null;
    const fiscalAmount = num(e["fiscal_effect_amount"]);
    let fiscalNote = clip(e["fiscal_note"], 600);
    if (opts.overseas && fiscalAmount != null) {
      // 海外行は率のみ参照・金額は参考値（設計 §1-2(b)）
      const mark = "【海外・参考値】";
      fiscalNote = fiscalNote ? `${mark}${fiscalNote}`.slice(0, 600) : mark;
    }

    out.rows.push({
      field_category: clip(e["field_category"], 60),
      population_band: null,
      title,
      source,
      url: clip(e["url"], 500),
      year: intOrNull(e["year"]),
      design,
      evidence_level: level,
      population: clip(e["population"], 400),
      effect_summary: effect,
      transferability,
      source_note: clip(e["source_note"], 300),
      output_summary: clip(e["output_summary"], 600),
      outcome_summary: clip(e["outcome_summary"], 600),
      outcome_tier: outcomeTier,
      effect_size_type: effectSizeType,
      effect_size_value: num(e["effect_size_value"]),
      ci_low: ciLow,
      ci_high: ciHigh,
      p_value: pValue,
      stat_method: clip(e["stat_method"], 300),
      sample_size: intOrNull(e["sample_size"]),
      followup_months: intOrNull(e["followup_months"]),
      fiscal_effect_amount: fiscalAmount,
      fiscal_effect_unit: fiscalUnit,
      fiscal_effect_basis: clip(e["fiscal_effect_basis"], 300),
      fiscal_effect_rate: num(e["fiscal_effect_rate"]),
      fiscal_horizon_years: num(e["fiscal_horizon_years"]),
      fiscal_note: fiscalNote,
    });
  }

  return out;
}

// ─── コスト概算（表示用・推定） ───────────────────────────

/** トークン→円の概算（Sonnet系の目安単価・150円/USD。画面には「推定」と明記する） */
export function estimateTokenCostYen(inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  return Math.round(usd * 150);
}
