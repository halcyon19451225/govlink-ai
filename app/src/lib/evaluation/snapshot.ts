import "server-only";
import { query } from "@/lib/db";
import {
  calcAchievement,
  type AchievementCondition,
} from "@/lib/stats/achievement";
import { normalizeIndicatorType } from "@/lib/outcome/tiers";

/**
 * 評価に紐づくKPIの実績スナップショット。
 * 承認時にこの配列を program_evaluations.kpi_snapshot へ凍結する。
 */
export interface KpiSnapshotItem {
  kpi_id: string;
  label: string;
  unit: string;
  current: number | null;
  target: number | null;
  baseline: number | null;
  condition: AchievementCondition | null;
  indicator_type: string;
  rate: number | null;
  clamped: number;
  achieved: boolean;
  formula: string;
}

interface KpiRow {
  id: string;
  label: string;
  unit: string;
  current: number | null;
  target: number | null;
  baseline_value: number | null;
  achievement_condition: AchievementCondition | null;
  indicator_type: string | null;
}

/** 指定KPIの現時点の実績と到達度を計算する */
export async function buildKpiSnapshot(
  projectId: string,
  kpiIds: string[],
): Promise<KpiSnapshotItem[]> {
  if (kpiIds.length === 0) return [];

  const rows = await query<KpiRow>(
    `SELECT id, label, unit,
            current::float AS current, target::float AS target,
            baseline_value::float AS baseline_value,
            achievement_condition, indicator_type
     FROM kpis
     WHERE project_id = $1 AND id = ANY($2::uuid[])`,
    [projectId, kpiIds],
  );

  return rows.map((k) => {
    const ach = calcAchievement({
      current: k.current,
      target: k.target,
      baseline: k.baseline_value,
      condition: k.achievement_condition,
    });
    return {
      kpi_id: k.id,
      label: k.label,
      unit: k.unit ?? "",
      current: k.current,
      target: k.target,
      baseline: k.baseline_value,
      condition: k.achievement_condition,
      indicator_type: normalizeIndicatorType(k.indicator_type),
      rate: ach.rate,
      clamped: ach.clamped,
      achieved: ach.achieved,
      formula: ach.formula,
    };
  });
}

/**
 * スナップショットから評価全体の到達度を出す（対象KPIの単純平均）。
 * 対象が0件、または全て算定不能なら null。
 */
export function aggregateRate(snapshot: KpiSnapshotItem[]): number | null {
  const rates = snapshot.map((s) => s.rate).filter((r): r is number => r != null);
  if (rates.length === 0) return null;
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return Math.round(avg * 10) / 10;
}

/** 全KPIが目標を満たしているか（図6/図7の auto ステップの判定に使う） */
export function allAchieved(snapshot: KpiSnapshotItem[]): boolean {
  return snapshot.length > 0 && snapshot.every((s) => s.achieved);
}
