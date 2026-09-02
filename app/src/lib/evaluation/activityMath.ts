/**
 * 指標No.5（アクティビティ）実施率の計算部（純粋関数 — 検査から直接叩ける）。
 * DBを読む集計は activityStats.ts（サーバー専用）が担う。
 */

import { planTasks } from "@/lib/measure/schedule";
import type { MeasureActivity } from "@/lib/measure/dataset";

/** 年度の窓（4月始まり）。fiscalYear は開始西暦年（2026 = 令和8年度） */
export function fiscalYearWindow(fiscalYear: number): { start: string; end: string } {
  return { start: `${fiscalYear}-04-01`, end: `${fiscalYear + 1}-03-31` };
}

/** ISO日付が年度内か */
export function inFiscalYear(isoDate: string, fiscalYear: number): boolean {
  const { start, end } = fiscalYearWindow(fiscalYear);
  return isoDate >= start && isoDate <= end;
}

/**
 * 計画件数 — アクティビティを 057 の展開規則（planTasks。スケジュール反映と同じ計算）で
 * 展開し、当該年度に期限が落ちる件数を数える。反映済みかどうかは問わない。
 */
export function plannedCountInYear(
  activities: MeasureActivity[],
  planYears: number,
  fiscalYear: number,
): { planned: number; byActivity: { activity_id: string; title: string; planned: number }[] } {
  const byActivity: { activity_id: string; title: string; planned: number }[] = [];
  let planned = 0;
  for (const a of activities) {
    const inYear = planTasks(a, planYears).filter((t) => inFiscalYear(t.due_date, fiscalYear));
    if (inYear.length > 0) {
      byActivity.push({ activity_id: a.id, title: a.title, planned: inYear.length });
      planned += inYear.length;
    }
  }
  return { planned, byActivity };
}
