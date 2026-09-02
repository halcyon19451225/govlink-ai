/**
 * 指標No.5（アクティビティ）実施率の計算部（純粋関数 — 検査から直接叩ける）。
 * DBを読む集計は activityStats.ts（サーバー専用）が担う。
 */

import { planTasks } from "@/lib/measure/schedule";
import type { MeasureActivity } from "@/lib/measure/dataset";

/**
 * 計画期間の年度数。SQLで日付演算をすると date/timestamp の型混在で落ちやすいので
 * （実機で CEIL(interval) の500を踏んだ）、日付文字列からJSで数える。
 * 終了日が無ければ1年とみなす。
 */
export function planYearsBetween(startIso: string, endIso: string | null): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  if (Number.isNaN(start)) return 3;
  const end = endIso ? Date.parse(`${endIso}T00:00:00Z`) : start + 365 * 86_400_000;
  if (Number.isNaN(end) || end <= start) return 1;
  return Math.max(1, Math.ceil((end - start) / (365.25 * 86_400_000)));
}

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
