/**
 * 施策構築の対話 — 純粋ロジック（E2）
 *
 * AIツール出力の取り込み（サニタイズ）とフェーズ進行のガードを、
 * ルートから切り出してテスト可能にしてある（scripts/check-measure-format.mjs）。
 *
 * ガードの思想は課題仮説対話と同じ:
 * 現状整理でクロス分析が飛ばされた事故（AIが phase を勝手に進めた）を
 * プロンプトの禁止だけに頼らず、サーバ側で構造的に塞ぐ。
 */

import {
  MEASURE_STEP_ORDER,
  activeApproaches,
  normalizeEvidenceItems,
  normalizeExperiment,
  type ApproachCost,
  type ApproachEvidence,
  type ApproachExperiment,
  type ApproachIndicators,
  type ApproachItem,
  type EvidenceStatus,
  type KpiDraft,
  type MeasureDialogueData,
  type MeasureStep,
  normalizeBudgetBreakdown,
} from "./types";

/**
 * この実装段で対話が到達できる最遠のフェーズ。
 * E4 で全フェーズ（done まで）が実装された。
 */
export const IMPLEMENTED_MAX_STEP: MeasureStep = "done";

function str(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// ─── サニタイズ ───────────────────────────────────────────

/** 新しいアプローチの取り込み。id はサーバ側で a1, a2… と採番する */
export function sanitizeApproaches(arr: unknown, startIndex: number): ApproachItem[] {
  if (!Array.isArray(arr)) return [];
  const out: ApproachItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const approach = str(o.approach, 400);
    const measureTitle = str(o.measure_title, 120);
    if (!approach || !measureTitle) continue;
    out.push({
      id: `a${startIndex + out.length + 1}`,
      root_cause: str(o.root_cause, 600),
      approach,
      measure_title: measureTitle,
      target: str(o.target, 300),
      intervention: str(o.intervention, 500),
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** 既存アプローチの文言更新（id 指定の上書き。id の無いものは無視） */
export function applyApproachUpdates(
  base: ApproachItem[],
  arr: unknown,
): ApproachItem[] {
  if (!Array.isArray(arr)) return base;
  const byId = new Map(base.map((a) => [a.id, a]));
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const id = str(o.id, 20);
    const current = byId.get(id);
    if (!current) continue;
    byId.set(id, {
      ...current,
      root_cause: str(o.root_cause, 600) || current.root_cause,
      approach: str(o.approach, 400) || current.approach,
      measure_title: str(o.measure_title, 120) || current.measure_title,
      target: str(o.target, 300) || current.target,
      intervention: str(o.intervention, 500) || current.intervention,
    });
  }
  return base.map((a) => byId.get(a.id) ?? a);
}

/**
 * アプローチの取り下げ（retire_approaches）。行は消さず retired を立てる。
 *
 * 2026-08-31、担当者が「Cは別施策として後で扱う」と伝えたのに構造上取り下げる
 * 手段が無く、AIが「データセットには含まれていません」と事実と違う説明をした。
 * 課題仮説設定の merge_problems と同じ理由で、行は残して印だけ立てる
 * （エビデンス・実験・指標・コストが approach_id で参照しているため）。
 */
export function applyApproachRetirements(
  base: ApproachItem[],
  arr: unknown,
): ApproachItem[] {
  if (!Array.isArray(arr)) return base;
  const reasons = new Map<string, string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const id = str(o.approach_id ?? o.id, 20);
    if (!id) continue;
    reasons.set(id, str(o.reason, 200));
  }
  if (reasons.size === 0) return base;
  return base.map((a) =>
    reasons.has(a.id) ? { ...a, retired: true, retired_reason: reasons.get(a.id) || "" } : a,
  );
}

function evidenceStatus(v: unknown): EvidenceStatus {
  return v === "sufficient" || v === "partial" ? v : "none";
}

/** アプローチごとのエビデンス評価の取り込み（approach_id 単位で上書き） */
export function sanitizeApproachEvidence(
  arr: unknown,
  validIds: Set<string>,
): ApproachEvidence[] {
  if (!Array.isArray(arr)) return [];
  const out: ApproachEvidence[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const aid = str(o.approach_id, 20);
    if (!aid || !validIds.has(aid) || seen.has(aid)) continue;
    seen.add(aid);
    const entry: ApproachEvidence = {
      approach_id: aid,
      status: evidenceStatus(o.status),
      items: normalizeEvidenceItems(o.items).slice(0, 8),
    };
    const note = str(o.note, 500);
    if (note) entry.note = note;
    out.push(entry);
  }
  return out;
}

/** approach_id をキーに上書きマージする */
export function upsertEvidence(
  base: ApproachEvidence[],
  incoming: ApproachEvidence[],
): ApproachEvidence[] {
  if (incoming.length === 0) return base;
  const map = new Map(base.map((b) => [b.approach_id, b]));
  for (const item of incoming) map.set(item.approach_id, item);
  return Array.from(map.values());
}

/** アプローチごとの実験設計の取り込み（approach_id 単位で上書き）— E3 */
export function sanitizeExperiments(
  arr: unknown,
  validIds: Set<string>,
): ApproachExperiment[] {
  if (!Array.isArray(arr)) return [];
  const out: ApproachExperiment[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const aid = str(o.approach_id, 20);
    if (!aid || !validIds.has(aid) || seen.has(aid)) continue;
    // 設計本体の検査（design の enum・各フィールドの整形）は
    // measure_designs 側と同じ正規化を通す（形の定義を1箇所に保つ）
    const plan = normalizeExperiment(o);
    if (!plan || !plan.rationale) continue;
    seen.add(aid);
    out.push({ approach_id: aid, ...plan });
  }
  return out;
}

/** approach_id をキーに上書きマージする */
export function upsertExperiments(
  base: ApproachExperiment[],
  incoming: ApproachExperiment[],
): ApproachExperiment[] {
  if (incoming.length === 0) return base;
  const map = new Map(base.map((b) => [b.approach_id, b]));
  for (const item of incoming) map.set(item.approach_id, item);
  return Array.from(map.values());
}

/**
 * 実験設計が必要なアプローチ（エビデンスが sufficient でないもの）。
 * 確定条件（canConfirm / DBのCHECK）と同じ規則。
 */
export function approachesNeedingExperiment(data: MeasureDialogueData): ApproachItem[] {
  // エビデンスの有無で絞らない — 参照できる研究があっても、
  // この町のこの対象で効いたかを後から言うには比較の設計が要る（2026-09-01 方針）
  return activeApproaches(data.approaches);
}

/** 生存中の全アプローチに実験設計（手法と選定理由）が付いているか */
export function allExperimentsDesigned(data: MeasureDialogueData): boolean {
  const byId = new Map(data.experiments.map((e) => [e.approach_id, e]));
  return approachesNeedingExperiment(data).every((a) => {
    const e = byId.get(a.id);
    return e != null && !!e.design && (e.rationale ?? "").trim().length > 0;
  });
}

function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const CONDITIONS = new Set(["lte", "lt", "gte", "gt", "eq"]);

function sanitizeKpiDrafts(v: unknown): KpiDraft[] {
  if (!Array.isArray(v)) return [];
  const out: KpiDraft[] = [];
  for (const it of v) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const existing = str(o.existing_kpi_id, 60);
    const label = str(o.label, 120);
    // 既存参照なら label 無しでも通す。新規案は label 必須
    if (!existing && !label) continue;
    const d: KpiDraft = {
      existing_kpi_id: existing || null,
      label,
      unit: str(o.unit, 20),
    };
    const baseline = numOrNull(o.baseline);
    if (baseline != null) d.baseline = baseline;
    const target = numOrNull(o.target);
    if (target != null) d.target = target;
    const deadline = str(o.deadline, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) d.deadline = deadline;
    const cond = str(o.condition, 4);
    if (CONDITIONS.has(cond)) {
      d.condition = cond as NonNullable<KpiDraft["condition"]>;
    }
    out.push(d);
    if (out.length >= 5) break;
  }
  return out;
}

/** アプローチごとの指標の取り込み（approach_id 単位で上書き）— E4 */
export function sanitizeIndicators(
  arr: unknown,
  validIds: Set<string>,
): ApproachIndicators[] {
  if (!Array.isArray(arr)) return [];
  const out: ApproachIndicators[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const aid = str(o.approach_id, 20);
    if (!aid || !validIds.has(aid) || seen.has(aid)) continue;
    seen.add(aid);
    out.push({
      approach_id: aid,
      structure: strArray(o.structure, 6, 120),
      process: strArray(o.process, 6, 120),
      outcome_initial: sanitizeKpiDrafts(o.outcome_initial),
      outcome_intermediate: sanitizeKpiDrafts(o.outcome_intermediate),
    });
  }
  return out;
}

/** アプローチごとのコストの取り込み（approach_id 単位で上書き）— E4 */
export function sanitizeCosts(arr: unknown, validIds: Set<string>): ApproachCost[] {
  if (!Array.isArray(arr)) return [];
  const out: ApproachCost[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const aid = str(o.approach_id, 20);
    if (!aid || !validIds.has(aid) || seen.has(aid)) continue;
    const note = str(o.cost_per_outcome_note, 500);
    const total = numOrNull(o.total_budget);
    const unit = numOrNull(o.unit_cost);
    const funding = str(o.funding, 200);
    // 算定式か総事業費のどちらかは無いと「コストを整理した」とは言えない
    if (!note && total == null) continue;
    seen.add(aid);
    const c: ApproachCost = { approach_id: aid, cost_per_outcome_note: note };
    if (total != null) c.total_budget = total;
    if (unit != null) c.unit_cost = unit;
    if (funding) c.funding = funding;
    const breakdown = normalizeBudgetBreakdown(o.breakdown);
    if (breakdown.length > 0) c.breakdown = breakdown;
    out.push(c);
  }
  return out;
}

/** approach_id をキーに上書きマージする（indicators / costs 共用） */
export function upsertByApproach<T extends { approach_id: string }>(
  base: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) return base;
  const map = new Map(base.map((b) => [b.approach_id, b]));
  for (const item of incoming) map.set(item.approach_id, item);
  return Array.from(map.values());
}

/**
 * 全アプローチに指標が付いているか。
 * 「短期アウトカムKPIが1件以上」を必須にする — 概ね1年で測れる指標が無い施策は
 * 年次評価（図6フロー）に乗らず、C工程で評価不能になるため。
 */
export function allIndicatorsSet(data: MeasureDialogueData): boolean {
  const alive = activeApproaches(data.approaches);
  if (alive.length === 0) return false;
  const byId = new Map(data.indicators.map((i) => [i.approach_id, i]));
  return alive.every((a) => {
    const ind = byId.get(a.id);
    return ind != null && ind.outcome_initial.length > 0;
  });
}

/** 全アプローチにコストが付いているか */
export function allCostsSet(data: MeasureDialogueData): boolean {
  const alive = activeApproaches(data.approaches);
  if (alive.length === 0) return false;
  const set = new Set(data.costs.map((c) => c.approach_id));
  return alive.every((a) => set.has(a.id));
}

// ─── フェーズ進行のガード ─────────────────────────────────

export function measureStepIndex(s: MeasureStep): number {
  const i = MEASURE_STEP_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

export function parseMeasurePhase(v: unknown, fallback: MeasureStep): MeasureStep {
  return typeof v === "string" && (MEASURE_STEP_ORDER as string[]).includes(v)
    ? (v as MeasureStep)
    : fallback;
}

/** 全アプローチにエビデンス評価が付いているか */
export function allApproachesAssessed(data: MeasureDialogueData): boolean {
  const alive = activeApproaches(data.approaches);
  if (alive.length === 0) return false;
  const assessed = new Set(data.evidence.map((e) => e.approach_id));
  return alive.every((a) => assessed.has(a.id));
}

/**
 * フェーズの逆行・飛び越し・前提未達の進行を防ぐ。
 *
 * - 2段以上の飛び越し禁止（approach → experiment など）
 * - evidence にはアプローチが1件以上ないと進めない
 * - experiment には全アプローチのエビデンス評価が済むまで進めない
 * - indicators には「実験設計が必要な全アプローチ」に設計が付くまで進めない
 * - cost には全アプローチに短期アウトカムKPIが1件以上付くまで進めない
 * - done には全アプローチにコストが付くまで進めない
 * - IMPLEMENTED_MAX_STEP より先には進めない（未実装フェーズの暴走防止）
 */
export function guardMeasurePhase(
  requested: MeasureStep,
  current: MeasureStep,
  data: MeasureDialogueData,
): MeasureStep {
  // 逆行の禁止。2026-08-31、コスト整理まで進んだ対話が AI の返答ひとつで
  // エビデンス探索へ戻り、担当者から見ると工程が巻き戻った。
  // 前提未達による引き戻しはこの下で行うので、要求された後退はここで捨てる。
  const notBack =
    measureStepIndex(requested) < measureStepIndex(current) ? current : requested;
  const nextIdx = Math.min(measureStepIndex(current) + 1, MEASURE_STEP_ORDER.length - 1);
  let phase =
    measureStepIndex(notBack) > measureStepIndex(current) + 1
      ? (MEASURE_STEP_ORDER[nextIdx] ?? notBack)
      : notBack;

  if (
    measureStepIndex(phase) >= measureStepIndex("evidence") &&
    activeApproaches(data.approaches).length === 0
  ) {
    phase = "approach";
  }
  if (
    measureStepIndex(phase) >= measureStepIndex("experiment") &&
    !allApproachesAssessed(data)
  ) {
    phase = "evidence";
  }
  // 実験設計が必要なアプローチ（sufficient でないもの）に設計が付くまで
  // indicators へは進めない（確定条件と同じ規則をフェーズ進行にも張る）
  if (
    measureStepIndex(phase) >= measureStepIndex("indicators") &&
    !allExperimentsDesigned(data)
  ) {
    phase = "experiment";
  }
  // 短期アウトカムKPIが全アプローチに付くまで cost へは進めない
  if (measureStepIndex(phase) >= measureStepIndex("cost") && !allIndicatorsSet(data)) {
    phase = "indicators";
  }
  // コストが全アプローチに付くまで done にはできない
  if (phase === "done" && !allCostsSet(data)) {
    phase = "cost";
  }
  if (measureStepIndex(phase) > measureStepIndex(IMPLEMENTED_MAX_STEP)) {
    phase = IMPLEMENTED_MAX_STEP;
  }
  return phase;
}
