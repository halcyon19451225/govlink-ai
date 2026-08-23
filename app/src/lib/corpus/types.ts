/**
 * コーパス（横断学習データ）の語彙と変換ロジック（純粋・テスト可能）— X3
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * corpus_measures / corpus_evidence（040）の語彙・匿名化・変換は
 * ここに集約する。供出API・検収画面・ナレッジ抽出はここだけを参照する。
 *
 * ── 設計の要点 ────────────────────────────────────────────
 * - コーパスは「担当者が確認・確定した事実データ」のみ（方針ドキュメント0-(b)）
 * - 出典（source / source_note）を必ず持つ — 妥当性の追跡が生命線
 * - 匿名化: 自治体名は供出時に「当自治体」へ置換。コーパス行は
 *   municipality_id を持たない（contributor_key はサーバー側でハッシュ化）
 *
 * 設計: claude/coe-ownai-plan.md（承認済み方針）X3。
 */

import {
  normalizeEvidenceItems,
  normalizeExperiment,
  type EvidenceItem,
  type EvidenceStatus,
  type ExperimentPlan,
  type MeasureDesign,
} from "@/lib/measure/types";

// ─── 語彙 ─────────────────────────────────────────────────

export const CORPUS_STATUS = [
  { key: "pending", label: "検収待ち", color: "#f59e0b" },
  { key: "approved", label: "承認済み", color: "#10b981" },
  { key: "rejected", label: "却下", color: "#ef4444" },
] as const;

export type CorpusStatus = (typeof CORPUS_STATUS)[number]["key"];

export const CORPUS_STATUS_META: Record<CorpusStatus, { label: string; color: string }> =
  Object.fromEntries(CORPUS_STATUS.map((s) => [s.key, { label: s.label, color: s.color }])) as Record<
    CorpusStatus,
    { label: string; color: string }
  >;

/** 自治体規模帯（人口）。検収時にOrdo運営が設定・修正できる */
export const POPULATION_BANDS = [
  "〜1万",
  "1〜5万",
  "5〜20万",
  "20〜50万",
  "50万〜",
] as const;

export type PopulationBand = (typeof POPULATION_BANDS)[number];

export function populationBandOf(population: number | null | undefined): PopulationBand | null {
  if (population == null || !Number.isFinite(population) || population < 0) return null;
  if (population < 10_000) return "〜1万";
  if (population < 50_000) return "1〜5万";
  if (population < 200_000) return "5〜20万";
  if (population < 500_000) return "20〜50万";
  return "50万〜";
}

// ─── 匿名化 ───────────────────────────────────────────────

/**
 * 自由記述から自治体名を「当自治体」へ置換する。
 * 「御船町」→「当自治体」、「御船町立」→「当自治体立」のように
 * 名前そのものを機械的に置換する（完全な匿名化は検収の目視が最終防衛線）。
 */
export function anonymizeText(
  text: string | null | undefined,
  municipalityName: string | null | undefined,
): string | null {
  if (text == null) return null;
  const t = String(text);
  const name = (municipalityName ?? "").trim();
  if (!name) return t;
  let out = t.split(name).join("当自治体");
  // 「◯◯市」の「◯◯」だけの言及も拾う（3文字以上の語幹のみ。誤置換を避ける）
  const m = name.match(/^(.{3,})(市|町|村|区)$/);
  if (m && m[1]) out = out.split(m[1]).join("当自治体");
  return out;
}

// ─── コーパス行の形 ───────────────────────────────────────

export interface CorpusMeasureInput {
  field_category: string | null;
  population_band: string | null;
  title: string;
  approach: string | null;
  target_population: string | null;
  target_size: number | null;
  intervention: string | null;
  delivery: string | null;
  evidence_status: EvidenceStatus;
  evidence_items: EvidenceItem[];
  experiment: ExperimentPlan | null;
  structure_indicators: string[];
  process_indicators: string[];
  outcome_notes: string[];
  total_budget: number | null;
  unit_cost: number | null;
  cost_per_outcome_note: string | null;
  funding: string | null;
  effect_note: string | null;
  source_note: string | null;
}

export interface CorpusEvidenceInput {
  field_category: string | null;
  population_band: string | null;
  title: string;
  source: string;
  url: string | null;
  year: number | null;
  design: EvidenceItem["design"];
  evidence_level: EvidenceItem["evidence_level"];
  population: string | null;
  effect_summary: string;
  transferability: string | null;
  source_note: string | null;
}

// ─── 施策データセット → コーパス行 ─────────────────────────

const clip = (s: string | null | undefined, max: number): string | null => {
  if (s == null) return null;
  const t = String(s).trim();
  return t ? t.slice(0, max) : null;
};

const clipStrings = (arr: unknown, maxItems = 20, maxLen = 300): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);
};

/**
 * 確定済みの施策データセットをコーパス行（匿名化済み）へ変換する。
 * - kpiLabels: kpi_ids_* を人が読める要約（「短期: 参加率（目標50%）」等）に落とす
 * - effectNote: 昇格済み実験結果の要約（呼び出し側が組み立てる）
 */
export function corpusMeasureFromMeasure(
  m: MeasureDesign,
  opts: {
    municipalityName: string | null;
    kpiNotes: string[];
    effectNote?: string | null;
    fieldCategory?: string | null;
    populationBand?: string | null;
  },
): CorpusMeasureInput {
  const anon = (s: string | null | undefined, max = 2000) =>
    clip(anonymizeText(s, opts.municipalityName), max);

  // エビデンス項目・実験計画の自由記述も匿名化する
  const evidence = normalizeEvidenceItems(
    m.evidence_items.map((e) => ({
      ...e,
      title: anonymizeText(e.title, opts.municipalityName) ?? e.title,
      // 出典も匿名化する（「◯◯町高齢者福祉計画」が供出元を特定してしまうため。
      // 「当自治体高齢者福祉計画」でも資料種別は追跡できる）
      source: anonymizeText(e.source, opts.municipalityName) ?? e.source,
      effect_summary:
        anonymizeText(e.effect_summary, opts.municipalityName) ?? e.effect_summary,
      ...(e.population
        ? { population: anonymizeText(e.population, opts.municipalityName) ?? undefined }
        : {}),
      ...(e.transferability
        ? {
            transferability:
              anonymizeText(e.transferability, opts.municipalityName) ?? undefined,
          }
        : {}),
    })),
  );

  let experiment: ExperimentPlan | null = null;
  if (m.experiment) {
    const raw: Record<string, unknown> = { ...m.experiment };
    for (const k of Object.keys(raw)) {
      if (typeof raw[k] === "string") {
        raw[k] = anonymizeText(raw[k] as string, opts.municipalityName);
      }
    }
    experiment = normalizeExperiment(raw);
  }

  return {
    field_category: clip(opts.fieldCategory, 60),
    population_band: clip(opts.populationBand, 20),
    title: anon(m.title, 200) ?? "（無題の施策）",
    approach: anon(m.approach),
    target_population: anon(m.target_population, 400),
    target_size: m.target_size ?? null,
    intervention: anon(m.intervention),
    delivery: anon(m.delivery, 400),
    evidence_status: m.evidence_status,
    evidence_items: evidence,
    experiment,
    structure_indicators: clipStrings(
      m.structure_indicators.map((s) => anonymizeText(s.text, opts.municipalityName) ?? s.text),
    ),
    process_indicators: clipStrings(
      m.process_indicators.map((s) => anonymizeText(s.text, opts.municipalityName) ?? s.text),
    ),
    outcome_notes: clipStrings(
      opts.kpiNotes.map((s) => anonymizeText(s, opts.municipalityName) ?? s),
    ),
    total_budget: m.total_budget ?? null,
    unit_cost: m.unit_cost ?? null,
    cost_per_outcome_note: anon(m.cost_per_outcome_note, 600),
    funding: anon(m.funding, 400),
    effect_note: clip(anonymizeText(opts.effectNote, opts.municipalityName), 1000),
    source_note: "自治体の確定済み施策データセット（Coe・匿名化供出）",
  };
}

/** EvidenceItem（施策のC区画）→ コーパスのエビデンス行 */
export function corpusEvidenceFromItem(
  e: EvidenceItem,
  opts: { municipalityName: string | null; fieldCategory?: string | null; populationBand?: string | null },
): CorpusEvidenceInput {
  const anon = (s: string | null | undefined, max = 1000) =>
    clip(anonymizeText(s, opts.municipalityName), max);
  return {
    field_category: clip(opts.fieldCategory, 60),
    population_band: clip(opts.populationBand, 20),
    title: anon(e.title, 300) ?? "（無題）",
    source: anon(e.source, 300) ?? "出典不明",
    url: e.url ? clip(e.url, 500) : null,
    year: e.year ?? null,
    design: e.design,
    evidence_level: e.evidence_level,
    population: anon(e.population, 400),
    effect_summary: anon(e.effect_summary, 1000) ?? "",
    transferability: anon(e.transferability, 1000),
    source_note: "自治体の確定済み施策データセットのエビデンス欄（Coe・匿名化供出）",
  };
}

// ─── ナレッジ抽出の提案の取り込み ─────────────────────────

const STUDY_DESIGN_KEYS = new Set(["sr", "rct", "qed", "prepost", "case"]);

export interface ExtractionProposals {
  measures: CorpusMeasureInput[];
  evidence: CorpusEvidenceInput[];
}

/**
 * AIの抽出ツール出力を安全に取り込む。
 * - 必須欄（title / エビデンスは source・effect_summary）の無いものは捨てる
 * - design 不正は case（事例）に落とし、レベルは design の既定に丸める
 * - 件数・長さを制限する
 */
export function sanitizeExtractionProposals(raw: unknown): ExtractionProposals {
  const out: ExtractionProposals = { measures: [], evidence: [] };
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o["measures"])) {
    for (const item of o["measures"].slice(0, 10)) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const title = clip(typeof m["title"] === "string" ? m["title"] : null, 200);
      if (!title) continue;
      out.measures.push({
        field_category: clip(str(m["field_category"]), 60),
        population_band: null,
        title,
        approach: clip(str(m["approach"]), 2000),
        target_population: clip(str(m["target_population"]), 400),
        target_size: num(m["target_size"]),
        intervention: clip(str(m["intervention"]), 2000),
        delivery: clip(str(m["delivery"]), 400),
        evidence_status: "none",
        evidence_items: [],
        experiment: null,
        structure_indicators: clipStrings(m["structure_indicators"]),
        process_indicators: clipStrings(m["process_indicators"]),
        outcome_notes: clipStrings(m["outcome_notes"]),
        total_budget: num(m["total_budget"]),
        unit_cost: num(m["unit_cost"]),
        cost_per_outcome_note: clip(str(m["cost_per_outcome_note"]), 600),
        funding: clip(str(m["funding"]), 400),
        effect_note: clip(str(m["effect_note"]), 1000),
        source_note: clip(str(m["source_note"]), 300),
      });
    }
  }

  if (Array.isArray(o["evidence"])) {
    for (const item of o["evidence"].slice(0, 15)) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const title = clip(str(e["title"]), 300);
      const source = clip(str(e["source"]), 300);
      const effect = clip(str(e["effect_summary"]), 1000);
      if (!title || !source || !effect) continue;
      const design = STUDY_DESIGN_KEYS.has(String(e["design"]))
        ? (String(e["design"]) as CorpusEvidenceInput["design"])
        : "case";
      const defaultLevel = { sr: 5, rct: 4, qed: 3, prepost: 2, case: 1 }[design] as 1 | 2 | 3 | 4 | 5;
      const rawLevel = num(e["evidence_level"]);
      const level =
        rawLevel != null && rawLevel >= 1 && rawLevel <= 5
          ? (Math.round(rawLevel) as 1 | 2 | 3 | 4 | 5)
          : defaultLevel;
      out.evidence.push({
        field_category: clip(str(e["field_category"]), 60),
        population_band: null,
        title,
        source,
        url: clip(str(e["url"]), 500),
        year: num(e["year"]) != null ? Math.round(num(e["year"])!) : null,
        design,
        evidence_level: level,
        population: clip(str(e["population"]), 400),
        effect_summary: effect,
        transferability: clip(str(e["transferability"]), 1000),
        source_note: clip(str(e["source_note"]), 300),
      });
    }
  }

  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
