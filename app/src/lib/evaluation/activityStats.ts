/**
 * 指標No.5（アクティビティ指標）の実施率 — タスク完了実績からの自動集計（CA2-1）。
 *
 * 分母: 取組のアクティビティを 057 の展開規則（lib/measure/schedule.ts の planTasks —
 *       スケジュール反映と同じ計算）で当該年度分に展開した計画件数。
 *       スケジュールに反映済みかどうかは問わない（計画は計画として数える）。
 * 分子: measure_activity_tasks → schedule_tasks.completed_at が年度内の完了件数。
 *
 * 表示は常にオンデマンド計算。measure_indicator_results へ実体化するのは
 * 評価の承認時だけ（source='auto_tasks', auto_computed=true）。承認済み評価の
 * 数字が、後からタスクを触っても動かないようにするため（030の凍結と同じ思想）。
 */

import { query } from "@/lib/db";
import type { MeasureActivity } from "@/lib/measure/dataset";
import { fiscalYearWindow, plannedCountInYear } from "./activityMath";

export { fiscalYearWindow, inFiscalYear, plannedCountInYear } from "./activityMath";

export interface ActivityRateResult {
  fiscal_year: number;
  planned: number;
  completed: number;
  /** 0-100。分母0のときは null（「計画が無い」と「0%」を区別する） */
  rate: number | null;
  breakdown: { activity_id: string; title: string; planned: number; completed: number }[];
}

/**
 * 取組×年度の実施率を計算する（サーバー専用）。
 */
export async function computeActivityRate(
  projectId: string,
  measureWorkId: string,
  fiscalYear: number,
): Promise<ActivityRateResult> {
  const { start, end } = fiscalYearWindow(fiscalYear);

  const [activities, planRow, completedRows] = await Promise.all([
    query<MeasureActivity>(
      `SELECT a.id, a.measure_work_id, a.title, a.note,
              to_char(a.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(a.due_date, 'YYYY-MM-DD') AS due_date,
              a.recurrence, a.occurrences, a.owner_department,
              a.document_required,
              to_char(a.document_deadline, 'YYYY-MM-DD') AS document_deadline,
              a.document_offset_days, a.sort_order
         FROM measure_activities a
        WHERE a.project_id = $1 AND a.measure_work_id = $2
        ORDER BY a.sort_order`,
      [projectId, measureWorkId],
    ),
    query<{ years: number }>(
      `SELECT GREATEST(1, CEIL(
                (COALESCE(plan_end_date, plan_start_date + INTERVAL '1 year') - plan_start_date)
                / 365.0))::int AS years
         FROM projects WHERE id = $1 AND plan_start_date IS NOT NULL`,
      [projectId],
    ),
    query<{ measure_activity_id: string; completed: number }>(
      `SELECT t.measure_activity_id, count(*)::int AS completed
         FROM measure_activity_tasks t
         JOIN schedule_tasks s ON s.id = t.schedule_task_id
        WHERE t.measure_activity_id IN (
                SELECT id FROM measure_activities
                 WHERE project_id = $1 AND measure_work_id = $2)
          AND s.completed_at IS NOT NULL
          AND s.completed_at >= $3::date
          AND s.completed_at < ($4::date + INTERVAL '1 day')
        GROUP BY t.measure_activity_id`,
      [projectId, measureWorkId, start, end],
    ),
  ]);

  const planYears = planRow[0]?.years ?? 3;
  const { planned, byActivity } = plannedCountInYear(activities, planYears, fiscalYear);
  const completedBy = new Map(completedRows.map((r) => [r.measure_activity_id, r.completed]));

  const breakdown = byActivity.map((b) => ({
    ...b,
    completed: Math.min(completedBy.get(b.activity_id) ?? 0, b.planned),
  }));
  // 計画外（年度外の期限や期限なし）のタスク完了は分子に入れない — 分母との対応を守る
  const completed = breakdown.reduce((acc, b) => acc + b.completed, 0);

  return {
    fiscal_year: fiscalYear,
    planned,
    completed,
    rate: planned > 0 ? Math.round((completed / planned) * 1000) / 10 : null,
    breakdown,
  };
}
