/**
 * Libera ブリッジの送信ペイロード組み立て（S3）— 純粋・テスト可能
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * Coe のスケジュールタスク・PDCAチェックポイント・実績報告依頼を、
 * Libera 側 coeBridge の入力（events / tasks）へ変換する規約はここに集約する。
 *
 * 冪等性の要: sourceId は Coe 側の行UUIDから決定的に作る
 * （Libera 側で `coe_<sourceId>` のレコードIDになり、再送は上書きになる）。
 * sourceId は英数ハイフン・80字以内（coeBridge の検証と同一制約）。
 */

export interface BridgeEvent {
  sourceId: string;
  ownerSub: string;
  title: string;
  description?: string;
  start: string; // ISO8601
  end?: string;
  allDay?: boolean;
  color?: string;
}

export interface BridgeTask {
  sourceId: string;
  ownerSub: string;
  title: string;
  note?: string;
  dueAt?: string; // ISO8601
  priority?: "HIGH" | "MEDIUM" | "LOW";
}

export interface ScheduleTaskInput {
  id: string;
  title: string;
  due_date: string | null; // YYYY-MM-DD
  owner_department: string | null;
  measure_title: string | null;
  completed: boolean;
}

export interface CheckpointInput {
  id: string;
  name: string;
  phase: string;
  scheduled_date: string | null; // YYYY-MM-DD
  completed: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → その日の 00:00 JST を ISO8601 で（終日イベント用） */
export function dateToIso(dateStr: string): string | null {
  if (!DATE_RE.test(dateStr)) return null;
  return `${dateStr}T00:00:00+09:00`;
}

/**
 * スケジュールタスク＋チェックポイント → カレンダー予定。
 * 完了済みも送る（消すと予定が消えて混乱する — ICSフィードと同じ判断）。
 * 完了はタイトルの「✓」で表す。
 */
export function buildScheduleEvents(
  ownerSub: string,
  tasks: ScheduleTaskInput[],
  checkpoints: CheckpointInput[],
  projectTitle: string,
): BridgeEvent[] {
  const out: BridgeEvent[] = [];
  for (const t of tasks) {
    if (!t.due_date) continue;
    const start = dateToIso(t.due_date);
    if (!start) continue;
    out.push({
      sourceId: `task-${t.id}`,
      ownerSub,
      title: `${t.completed ? "✓ " : ""}${t.title}`.slice(0, 180),
      description: [
        t.measure_title ? `施策: ${t.measure_title}` : null,
        t.owner_department ? `担当: ${t.owner_department}` : null,
        `プロジェクト: ${projectTitle}`,
      ]
        .filter(Boolean)
        .join("\n"),
      start,
      allDay: true,
      color: "#6366f1",
    });
  }
  for (const c of checkpoints) {
    if (!c.scheduled_date) continue;
    const start = dateToIso(c.scheduled_date);
    if (!start) continue;
    out.push({
      sourceId: `cp-${c.id}`,
      ownerSub,
      title: `${c.completed ? "✓ " : ""}[${c.phase}] ${c.name}`.slice(0, 180),
      description: `PDCAチェックポイント（${c.phase}工程）\nプロジェクト: ${projectTitle}`,
      start,
      allDay: true,
      color: "#f59e0b",
    });
  }
  return out;
}

/** 未完了タスクを Libera の To-Do として送る（期限つき・完了済みは送らない） */
export function buildScheduleTasks(
  ownerSub: string,
  tasks: ScheduleTaskInput[],
  projectTitle: string,
): BridgeTask[] {
  return tasks
    .filter((t) => !t.completed && t.due_date && DATE_RE.test(t.due_date))
    .map((t) => {
      const dueAt = dateToIso(t.due_date!);
      return {
        sourceId: `task-${t.id}`,
        ownerSub,
        title: t.title.slice(0, 180),
        note: [
          t.measure_title ? `施策: ${t.measure_title}` : null,
          t.owner_department ? `担当: ${t.owner_department}` : null,
          `プロジェクト: ${projectTitle}`,
        ]
          .filter(Boolean)
          .join("\n"),
        ...(dueAt ? { dueAt } : {}),
        priority: "MEDIUM" as const,
      };
    });
}

export interface ReportNotifyInput {
  requestId: string;
  requestTitle: string;
  dueDate: string | null; // YYYY-MM-DD
  targets: { target_key: string; measure_title: string; url: string }[];
}

/**
 * 実績報告依頼 → 回答URL入りの Libera タスク（C①のLibera経路 — タスク通知方式）。
 * sourceId は 依頼×対象 で決定的（再送しても増えない）。
 */
export function buildReportTasks(ownerSub: string, input: ReportNotifyInput): BridgeTask[] {
  const dueAt = input.dueDate ? dateToIso(input.dueDate) : null;
  return input.targets.map((t) => ({
    sourceId: `report-${input.requestId}-${t.target_key}`.slice(0, 80),
    ownerSub,
    title: `実績報告: ${t.measure_title}`.slice(0, 180),
    note: `${input.requestTitle}\n回答フォーム（ログイン不要）:\n${t.url}`,
    ...(dueAt ? { dueAt } : {}),
    priority: "HIGH" as const,
  }));
}
