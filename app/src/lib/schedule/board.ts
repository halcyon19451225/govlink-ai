/**
 * 進捗ボードの計算（S1 D①）— 純粋・テスト可能
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * タスクの状態判定（期限超過は improvement の isOverdue と同じ考え方:
 * 期限を過ぎて未完了のみ）と、年度四半期（Q1=4〜6月）の計算はここに集約する。
 * 画面（ScheduleClient）と検査（check:schedule）はここだけを参照する。
 */

export type TaskProgressState = "done" | "overdue" | "pending";

export function taskState(
  t: { due_date: string | null; completed_at: string | null },
  asOf: Date = new Date(),
): TaskProgressState {
  if (t.completed_at) return "done";
  if (t.due_date) {
    const d = new Date(t.due_date);
    if (!Number.isNaN(d.getTime()) && d < asOf) return "overdue";
  }
  return "pending";
}

/** 年度四半期のキー（Q1=4〜6月）。例: 2026-04-15 → "2026Q1"、2027-02-01 → "2026Q4" */
export function fiscalQuarterKey(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `${fy}Q${q}`;
}

const QUARTER_MONTHS: Record<number, string> = { 1: "4〜6月", 2: "7〜9月", 3: "10〜12月", 4: "1〜3月" };

export function quarterLabel(key: string): string {
  const m = key.match(/^(\d{4})Q([1-4])$/);
  if (!m) return key;
  return `${m[1]}年度Q${m[2]}（${QUARTER_MONTHS[Number(m[2])]}）`;
}

/** min〜max の日付を覆う年度四半期キーの列（上限16四半期で打ち切り） */
export function quarterRange(minDate: string, maxDate: string): string[] {
  const parse = (k: string) => {
    const m = k.match(/^(\d{4})Q([1-4])$/);
    if (!m) return null;
    return Number(m[1]) * 4 + (Number(m[2]) - 1);
  };
  const start = parse(fiscalQuarterKey(minDate));
  const end = parse(fiscalQuarterKey(maxDate));
  if (start == null || end == null) return [];
  const out: string[] = [];
  for (let v = start; v <= end && out.length < 16; v++) {
    out.push(`${Math.floor(v / 4)}Q${(v % 4) + 1}`);
  }
  return out;
}
