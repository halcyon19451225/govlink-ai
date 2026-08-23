// 三層アウトカム（短期・中間・長期）の共有定義
//
// 短期(outcome_initial)  概ね1年   … 図6フロー・年2回評価
// 中間(outcome_intermediate) 2〜5年 … 図7フロー・計画期間内1回
// 長期(outcome_long)    計画期間超 … 評価ではなく常時監視（スコアボード）
//
// 既存データには旧称 `outcome_mid` が入りうるため、読み取り時に正規化する。

import type { AchievementCondition } from "@/lib/stats/achievement";

export type OutcomeTier = "outcome_initial" | "outcome_intermediate" | "outcome_long";
export type IndicatorType = OutcomeTier | "process" | "efficiency";

export interface OutcomeTierMeta {
  key: OutcomeTier;
  label: string;
  span: string;
  /** 層を示すスウォッチ色（緑の順序尺度。状態色とは別系統） */
  color: string;
  note: string;
}

export const OUTCOME_TIER_META: Record<OutcomeTier, OutcomeTierMeta> = {
  outcome_initial: {
    key: "outcome_initial",
    label: "短期アウトカム",
    span: "概ね1年",
    color: "#9ae6c8",
    note: "年次評価・図6フロー",
  },
  outcome_intermediate: {
    key: "outcome_intermediate",
    label: "中間アウトカム",
    span: "2〜5年",
    color: "#4cc59d",
    note: "計画期間評価・図7フロー",
  },
  outcome_long: {
    key: "outcome_long",
    label: "長期アウトカム",
    span: "計画期間を超える",
    color: "#16a37a",
    note: "判定ではなく軌道の監視",
  },
};

/** 長期 → 中間 → 短期 の順（スコアボードの表示順） */
export const OUTCOME_TIER_ORDER: OutcomeTier[] = [
  "outcome_long",
  "outcome_intermediate",
  "outcome_initial",
];

/** 旧称 outcome_mid を含む値を正規化する */
export function normalizeIndicatorType(raw: string | null | undefined): IndicatorType {
  if (raw === "outcome_mid") return "outcome_intermediate";
  if (
    raw === "outcome_initial" ||
    raw === "outcome_intermediate" ||
    raw === "outcome_long" ||
    raw === "efficiency"
  ) {
    return raw;
  }
  return "process";
}

export function isOutcomeTier(v: IndicatorType): v is OutcomeTier {
  return (
    v === "outcome_initial" || v === "outcome_intermediate" || v === "outcome_long"
  );
}

/** スコアボードが必要とする KPI の形 */
export interface ScoreboardKpi {
  id: string;
  label: string;
  target: number | null;
  current: number | null;
  unit: string;
  baseline_value: number | null;
  baseline_year: number | null;
  achievement_condition: AchievementCondition | null;
  target_deadline: string | null;
  indicator_type: string | null;
  contributes_to_kpi_id: string | null;
}

export interface TieredKpis {
  outcome_long: ScoreboardKpi[];
  outcome_intermediate: ScoreboardKpi[];
  outcome_initial: ScoreboardKpi[];
  /** アウトカム以外（プロセス・効率性）。スコアボードには出さない */
  other: ScoreboardKpi[];
}

export function groupByTier(kpis: ScoreboardKpi[]): TieredKpis {
  const out: TieredKpis = {
    outcome_long: [],
    outcome_intermediate: [],
    outcome_initial: [],
    other: [],
  };
  for (const k of kpis) {
    const t = normalizeIndicatorType(k.indicator_type);
    if (isOutcomeTier(t)) out[t].push(k);
    else out.other.push(k);
  }
  return out;
}

/** 上位KPI(id) → それに寄与する下位KPI[] の対応表 */
export function buildContributionMap(kpis: ScoreboardKpi[]): Map<string, ScoreboardKpi[]> {
  const map = new Map<string, ScoreboardKpi[]>();
  for (const k of kpis) {
    const parent = k.contributes_to_kpi_id;
    if (!parent) continue;
    const list = map.get(parent);
    if (list) list.push(k);
    else map.set(parent, [k]);
  }
  return map;
}

/** 数値を桁区切り＋単位で表示用に整える（億単位などの丸めはしない） */
export function formatValue(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v) >= 1000 ? v.toLocaleString("ja-JP") : String(v);
  return `${s}${unit ?? ""}`;
}

// ─── 評価スパンの推定 ────────────────────────────
//
// KPI 作成時の indicator_type が既定値 'outcome_initial' に固定されていたため、
// 期限が十数年先の指標まで「短期アウトカム（概ね1年）」に分類される事故があった。
// 目標期限までの長さから妥当な層を推定し、宣言値とずれている場合に警告できるようにする。

/** 短期／中間の境目（日数）。18か月 */
const HORIZON_SHORT_DAYS = 548;
/** 中間／長期の境目（日数）。5年6か月 */
const HORIZON_MID_DAYS = 2007;

/**
 * 計画開始日から目標期限までの長さで評価スパンを推定する。
 * 期限か起点が不明なら null（推定しない）。
 */
export function inferTierFromHorizon(
  planStartDate: string | null | undefined,
  targetDeadline: string | null | undefined,
): OutcomeTier | null {
  if (!targetDeadline) return null;
  const end = new Date(targetDeadline);
  const start = planStartDate ? new Date(planStartDate) : null;
  if (Number.isNaN(end.getTime())) return null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 0) return null;
  if (days > HORIZON_MID_DAYS) return "outcome_long";
  if (days > HORIZON_SHORT_DAYS) return "outcome_intermediate";
  return "outcome_initial";
}

/**
 * 宣言された層と、期限から推定した層のずれを返す。
 * ずれていなければ null。担当者の設定は尊重し、警告の表示だけに使う。
 */
export function tierMismatch(
  declared: string | null | undefined,
  planStartDate: string | null | undefined,
  targetDeadline: string | null | undefined,
): { declared: OutcomeTier; inferred: OutcomeTier } | null {
  const d = normalizeIndicatorType(declared);
  if (!isOutcomeTier(d)) return null;
  const inferred = inferTierFromHorizon(planStartDate, targetDeadline);
  if (!inferred || inferred === d) return null;
  return { declared: d, inferred };
}
