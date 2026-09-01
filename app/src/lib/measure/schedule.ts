/**
 * アクティビティ（実施項目）をスケジュールのタスクへ展開する（純粋関数）。
 *
 * 繰り返しの実施項目は、計画期間の年度数だけタスクに割れる。
 * 「毎年度の運営協議会で未達検証」を1行で持ち、反映時に4件のタスクにする、
 * というのが担当者の書き方に一番近い。
 *
 * 実施期限（due_date）が無いものは反映しない。日付の無いタスクは
 * スケジュール画面でも進捗ボードでも置き場所が無く、黙って消えたように見えるため。
 */

import type { ActivityRecurrence, MeasureActivity } from "./dataset";

/** 展開後の1件 */
export interface PlannedTask {
  activity_id: string;
  title: string;
  due_date: string;
  document_required: boolean;
  document_deadline: string | null;
  owner_department: string | null;
  /** 何回目か（1始まり）。繰り返しでないときは 1 */
  occurrence: number;
}

const STEP_MONTHS: Record<ActivityRecurrence, number> = {
  none: 0,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** 既定の繰り返し回数 — 計画期間の年度数から決める */
export function defaultOccurrences(recurrence: ActivityRecurrence, planYears: number): number {
  if (recurrence === "none") return 1;
  const perYear = 12 / STEP_MONTHS[recurrence];
  return Math.max(1, Math.round(perYear * planYears));
}

/** 日付に月を足す（末日は月末に丸める。1/31 + 1か月 = 2/28） */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const d = new Date(t + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * 1つのアクティビティをタスクへ展開する。
 * 期限が無ければ空配列（＝反映しない）。
 */
export function planTasks(a: MeasureActivity, planYears: number): PlannedTask[] {
  if (!a.due_date) return [];
  const recurrence = a.recurrence ?? "none";
  const times =
    recurrence === "none" ? 1 : (a.occurrences ?? defaultOccurrences(recurrence, planYears));
  const step = STEP_MONTHS[recurrence];

  const out: PlannedTask[] = [];
  for (let k = 0; k < Math.min(times, 60); k++) {
    const due = step === 0 ? a.due_date : addMonths(a.due_date, step * k);
    // 成果物の期限は、絶対日付があればそれ、無ければ実施期限からの相対
    const docDeadline = a.document_required
      ? (a.document_offset_days != null
          ? addDays(due, a.document_offset_days)
          : (step === 0 ? a.document_deadline : null))
      : null;
    out.push({
      activity_id: a.id,
      // 繰り返しは回数を添える。スケジュール画面で同名が並ぶと見分けが付かない
      title: times > 1 ? `${a.title}（${k + 1}回目）` : a.title,
      due_date: due,
      document_required: a.document_required,
      document_deadline: docDeadline,
      owner_department: a.owner_department,
      occurrence: k + 1,
    });
  }
  return out;
}

/** 反映の結果を画面に返す形 */
export interface SchedulePlan {
  tasks: PlannedTask[];
  /** 期限が無くて反映できなかったもの */
  skipped: { id: string; title: string }[];
}

export function planSchedule(activities: MeasureActivity[], planYears: number): SchedulePlan {
  const tasks: PlannedTask[] = [];
  const skipped: { id: string; title: string }[] = [];
  for (const a of activities) {
    const planned = planTasks(a, planYears);
    if (planned.length === 0) skipped.push({ id: a.id, title: a.title });
    else tasks.push(...planned);
  }
  return { tasks, skipped };
}
