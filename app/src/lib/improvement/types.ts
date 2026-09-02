// 改善アクション（A工程）の共有型・定数
//
// 改善を「文章」ではなく「追跡可能なオブジェクト」として扱うための定義。
// 出所（どの評価から生まれたか）と反映先（どこへ効かせたか）を持ち、
// 状態で追跡できるようにする。

export type ImprovementSource =
  | "program_evaluation"
  | "self_evaluation"
  | "ai_suggestion"
  | "improvement_dialogue"
  | "checkpoint"
  | "manual"
  | "handover"
  | "precondition"; // 前提条件（H2）の不成立から自動起票（062）

export type ImprovementStatus =
  | "proposed"
  | "adopted"
  | "in_progress"
  | "done"
  | "dropped";

export const SOURCE_META: Record<ImprovementSource, { label: string; color: string }> = {
  program_evaluation: { label: "プログラム評価", color: "#818cf8" },
  self_evaluation: { label: "自己評価", color: "#2dd4bf" },
  ai_suggestion: { label: "AI提案", color: "#a78bfa" },
  improvement_dialogue: { label: "改善対話", color: "#a78bfa" },
  checkpoint: { label: "チェックポイント", color: "#60a5fa" },
  manual: { label: "直接起票", color: "#94a3b8" },
  handover: { label: "前期引き継ぎ", color: "#fbbf24" },
  precondition: { label: "前提条件の不成立", color: "#f87171" },
};

export const STATUS_META: Record<
  ImprovementStatus,
  { label: string; color: string; note: string }
> = {
  proposed: { label: "起票", color: "#94a3b8", note: "改善として挙がった段階" },
  adopted: { label: "採用", color: "#818cf8", note: "実施すると決めた" },
  in_progress: { label: "実施中", color: "#f59e0b", note: "反映作業を進めている" },
  done: { label: "反映済", color: "#10b981", note: "反映先へ反映が完了した" },
  dropped: { label: "見送り", color: "#64748b", note: "実施しないと判断した" },
};

/** 状態の進行順。UIの「次へ進める」ボタンで使う */
export const STATUS_FLOW: ImprovementStatus[] = [
  "proposed",
  "adopted",
  "in_progress",
  "done",
];

export function nextStatus(s: ImprovementStatus): ImprovementStatus | null {
  const i = STATUS_FLOW.indexOf(s);
  if (i < 0 || i >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1] ?? null;
}

/** 反映先の5系統（E5 で施策を追加） */
export type ReflectTarget =
  | "schedule_task"
  | "kpi"
  | "measure_design"
  | "logic_model"
  | "issue_hypothesis";

export const REFLECT_META: Record<
  ReflectTarget,
  { label: string; desc: string; column: string }
> = {
  schedule_task: {
    label: "実行タスク",
    desc: "スケジュールにタスクとして起こす",
    column: "reflect_schedule_task_id",
  },
  kpi: {
    label: "KPIの見直し",
    desc: "目標値・指標そのものを見直す",
    column: "reflect_kpi_id",
  },
  measure_design: {
    label: "施策の見直し",
    desc: "施策データセット（対象・介入・指標・実験設計）を見直す",
    column: "reflect_measure_design_id",
  },
  logic_model: {
    label: "ロジックモデルの改訂",
    desc: "因果仮説を書き換える",
    column: "reflect_logic_model_id",
  },
  issue_hypothesis: {
    label: "課題仮説の再設定",
    desc: "真因の捉え直しから始める",
    column: "reflect_issue_hypothesis_id",
  },
};

export const REFLECT_ORDER: ReflectTarget[] = [
  "schedule_task",
  "kpi",
  "measure_design",
  "logic_model",
  "issue_hypothesis",
];

export interface ImprovementAction {
  id: string;
  project_id: string;
  source: ImprovementSource;
  program_evaluation_id: string | null;
  self_evaluation_entry_id: string | null;
  policy_suggestion_id: string | null;
  checkpoint_id: string | null;
  title: string;
  detail: string | null;
  root_cause: string | null;
  owner_department: string | null;
  owner_name: string | null;
  due_date: string | null;
  fiscal_year: number | null;
  status: ImprovementStatus;
  priority: number | null;
  reflect_schedule_task_id: string | null;
  reflect_kpi_id: string | null;
  reflect_measure_design_id?: string | null;
  reflect_logic_model_id: string | null;
  reflect_issue_hypothesis_id: string | null;
  reflected_at: string | null;
  reflection_note: string | null;
  carry_over: boolean;
  created_at: string;
  updated_at: string;
}

/** この改善に設定されている反映先を列挙する */
export function reflectTargetsOf(a: ImprovementAction): ReflectTarget[] {
  const out: ReflectTarget[] = [];
  if (a.reflect_schedule_task_id) out.push("schedule_task");
  if (a.reflect_kpi_id) out.push("kpi");
  if (a.reflect_measure_design_id) out.push("measure_design");
  if (a.reflect_logic_model_id) out.push("logic_model");
  if (a.reflect_issue_hypothesis_id) out.push("issue_hypothesis");
  return out;
}

export function isOverdue(a: ImprovementAction, asOf: Date = new Date()): boolean {
  if (!a.due_date || a.status === "done" || a.status === "dropped") return false;
  const d = new Date(a.due_date);
  return !Number.isNaN(d.getTime()) && d < asOf;
}

// ─── 対話型AI改善提案 ────────────────────────────
export interface ImprovementMessage {
  role: "user" | "assistant";
  content: string;
  step?: string;
  suggestions?: string[];
}

/** 対話の中で組み立てる改善案。commit で improvement_actions に変換される */
export interface ImprovementProposal {
  id: string;
  title: string;
  detail: string;
  root_cause: string;
  expected_effect: string;
  evidence: string[];
  owner_department: string;
  /** 「2027年度上半期」のような時期の目安。日付が確定していない段階で使う */
  due_hint: string;
  priority: number | null;
  carry_over: boolean;
  reflect_target?: ReflectTarget;
}

export interface ImprovementDialogue {
  id: string;
  project_id: string;
  program_evaluation_id: string | null;
  title: string;
  status: "in_progress" | "completed";
  current_step: string;
  messages: ImprovementMessage[];
  proposals: ImprovementProposal[];
  /** AIターンの状態（migration 055・非同期化）。processing の間は画面がポーリングで待つ */
  turn_status?: "idle" | "processing" | "error" | null;
  turn_error?: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
}
