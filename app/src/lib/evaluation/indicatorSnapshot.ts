import "server-only";

/**
 * 指標スナップショット（CA2-2）— program_evaluations.indicator_snapshot に入れる中身。
 *
 * 評価が拠り所にした指標の定義・目標・実績・判定を、その時点の値で写し取る。
 * 保存時に作り、承認後は書き換えない（030 の kpi_snapshot と同じ思想の指標版）。
 * 実績は measure_indicator_results（058 — 履歴）から対象年度の最新を選ぶ。
 */

import { query } from "@/lib/db";
import { isAchieved } from "@/lib/stats/achievement";
import { computeActivityRate, type ActivityRateResult } from "@/lib/evaluation/activityStats";

export interface IndicatorSnapshotItem {
  indicator_id: string;
  category_no: number;
  /** 取組レベルなら取組ID、主要施策レベルなら null */
  measure_work_id: string | null;
  label: string;
  unit: string | null;
  baseline_value: number | null;
  target_value: number | null;
  achievement_condition: string;
  /** 対象年度の最新実績（無ければ年度不問の最新） */
  result_value: number | null;
  result_text: string | null;
  result_measured_on: string | null;
  result_source: string | null;
  result_fiscal_year: number | null;
  /** 実績と目標から機械判定（実績・目標のどちらかが無ければ null） */
  achieved: boolean | null;
  /** No.5 のみ: タスク完了実績からの実施率（分母0は null） */
  activity_rate?: number | null;
  activity_planned?: number;
  activity_completed?: number;
}

interface IndicatorRow {
  id: string;
  category_no: number;
  measure_work_id: string | null;
  label: string;
  unit: string | null;
  baseline_value: number | null;
  target_value: number | null;
  achievement_condition: string;
}

interface ResultRow {
  measure_indicator_id: string;
  fiscal_year: number | null;
  measured_on: string | null;
  value: number | null;
  value_text: string | null;
  source: string;
  created_at: string;
}

/** 対象年度の最新を選ぶ（年度一致 > 年度不問。同率なら測定日→登録順） */
function pickLatest(rows: ResultRow[], fiscalYear: number | null): ResultRow | null {
  if (rows.length === 0) return null;
  const pool =
    fiscalYear != null && rows.some((r) => r.fiscal_year === fiscalYear)
      ? rows.filter((r) => r.fiscal_year === fiscalYear)
      : rows;
  return [...pool].sort((a, b) => {
    const da = a.measured_on ?? a.created_at.slice(0, 10);
    const db = b.measured_on ?? b.created_at.slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  })[pool.length - 1] ?? null;
}

/**
 * 指標スナップショットを作る。
 * - measureWorkId あり（図6）: その取組の指標＋主要施策レベルのコスト系（No.3・15）
 * - measureWorkId なし（図7）: 主要施策レベルの指標すべて
 */
export async function buildIndicatorSnapshot(
  projectId: string,
  measureDesignId: string,
  measureWorkId: string | null,
  fiscalYear: number | null,
): Promise<{ items: IndicatorSnapshotItem[]; activityRate: ActivityRateResult | null }> {
  const indicators = await query<IndicatorRow>(
    measureWorkId
      ? `SELECT id, category_no, measure_work_id, label, unit,
                baseline_value::float AS baseline_value,
                target_value::float AS target_value, achievement_condition
           FROM measure_indicators
          WHERE project_id = $1 AND measure_design_id = $2
            AND (measure_work_id = $3
                 OR (measure_work_id IS NULL AND category_no IN (3, 15)))
          ORDER BY category_no`
      : `SELECT id, category_no, measure_work_id, label, unit,
                baseline_value::float AS baseline_value,
                target_value::float AS target_value, achievement_condition
           FROM measure_indicators
          WHERE project_id = $1 AND measure_design_id = $2
            AND measure_work_id IS NULL
          ORDER BY category_no`,
    measureWorkId ? [projectId, measureDesignId, measureWorkId] : [projectId, measureDesignId],
  );
  if (indicators.length === 0) return { items: [], activityRate: null };

  const results = await query<ResultRow>(
    `SELECT measure_indicator_id, fiscal_year,
            to_char(measured_on, 'YYYY-MM-DD') AS measured_on,
            value::float AS value, value_text, source, created_at::text AS created_at
       FROM measure_indicator_results
      WHERE measure_indicator_id = ANY($1::uuid[])`,
    [indicators.map((i) => i.id)],
  );
  const byIndicator = new Map<string, ResultRow[]>();
  for (const r of results) {
    const list = byIndicator.get(r.measure_indicator_id);
    if (list) list.push(r);
    else byIndicator.set(r.measure_indicator_id, [r]);
  }

  // No.5 はタスク完了実績からの自動集計を併記する
  const activityRate =
    measureWorkId && fiscalYear != null
      ? await computeActivityRate(projectId, measureWorkId, fiscalYear)
      : null;

  const items = indicators.map((ind): IndicatorSnapshotItem => {
    const latest = pickLatest(byIndicator.get(ind.id) ?? [], fiscalYear);
    // No.5 は自動集計の実施率を実績として扱う（手入力の実績があればそちらを優先）
    const effectiveValue =
      latest?.value ??
      (ind.category_no === 5 && ind.measure_work_id ? activityRate?.rate ?? null : null);
    const achieved =
      effectiveValue != null && ind.target_value != null
        ? isAchieved(effectiveValue, ind.target_value, ind.achievement_condition as never)
        : null;
    return {
      indicator_id: ind.id,
      category_no: ind.category_no,
      measure_work_id: ind.measure_work_id,
      label: ind.label,
      unit: ind.unit,
      baseline_value: ind.baseline_value,
      target_value: ind.target_value,
      achievement_condition: ind.achievement_condition,
      result_value: effectiveValue,
      result_text: latest?.value_text ?? null,
      result_measured_on: latest?.measured_on ?? null,
      result_source:
        latest?.source ??
        (ind.category_no === 5 && activityRate?.rate != null ? "auto_tasks" : null),
      result_fiscal_year: latest?.fiscal_year ?? null,
      achieved,
      ...(ind.category_no === 5 && ind.measure_work_id
        ? {
            activity_rate: activityRate?.rate ?? null,
            activity_planned: activityRate?.planned ?? 0,
            activity_completed: activityRate?.completed ?? 0,
          }
        : {}),
    };
  });

  return { items, activityRate };
}
