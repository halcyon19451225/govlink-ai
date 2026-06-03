"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ─── 型 ──────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department_name: string | null;
  municipality_name: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
  purpose: string | null;
  major_policy: string | null;
  created_at: string;
}

interface Goal {
  id: string;
  goal_number: number;
  title: string;
  description: string | null;
  sort_order: number;
}

interface LogicModel {
  id: string;
  inputs: string[];
  activities: string[];
  outputs: string[];
  initial_outcomes: string[] | null;
  intermediate_outcomes: string[] | null;
  name: string | null;
  status: string;
  generated_at: string | null;
}

interface Props {
  project: Project;
  goals: Goal[];
  logicModel: LogicModel | null;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const STATUS_CYCLE: Project["status"][] = ["draft", "active", "completed", "archived"];

const STATUS_LABEL: Record<Project["status"], string> = {
  draft:    "計画中",
  active:   "実施中",
  completed: "完了",
  archived: "アーカイブ",
};

const STATUS_STYLE: Record<Project["status"], React.CSSProperties> = {
  draft:    { background: "#64748b20", color: "#94a3b8", border: "1px solid #64748b40" },
  active:   { background: "#6366f120", color: "#a5b4fc", border: "1px solid #6366f140" },
  completed:{ background: "#10b98120", color: "#34d399", border: "1px solid #10b98140" },
  archived: { background: "#f59e0b20", color: "#fbbf24", border: "1px solid #f59e0b40" },
};

const LOGIC_MODEL_COLS = [
  { key: "inputs",                 label: "投入資源",  color: "#6366f1" },
  { key: "activities",             label: "実施活動",  color: "#8b5cf6" },
  { key: "outputs",                label: "産出物",    color: "#06b6d4" },
  { key: "initial_outcomes",       label: "初期成果",  color: "#10b981" },
  { key: "intermediate_outcomes",  label: "中期成果",  color: "#0d9488" },
] as const;

// ─── 日付フォーマット ─────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
}

// ─── メインコンポーネント ──────────────────────────────────────────────────────

export default function ProjectOverviewClient({ project, goals, logicModel }: Props) {
  const router = useRouter();

  // ステータスを楽観的更新
  const [status, setStatus] = useState<Project["status"]>(project.status);
  const [statusSaving, setStatusSaving] = useState(false);

  // 概要編集モーダル
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState(project.title);
  const [editDesc, setEditDesc] = useState(project.description);
  const [editDept, setEditDept] = useState(project.department_name ?? "");
  const [editStartDate, setEditStartDate] = useState(project.plan_start_date ?? "");
  const [editEndDate, setEditEndDate] = useState(project.plan_end_date ?? "");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // 目標編集モーダル
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [editPurpose, setEditPurpose] = useState(project.purpose ?? "");
  const [editGoals, setEditGoals] = useState<{ title: string; description: string }[]>(
    goals.length > 0
      ? goals.map((g) => ({ title: g.title, description: g.description ?? "" }))
      : [{ title: "", description: "" }, { title: "", description: "" }, { title: "", description: "" }]
  );
  const [editMajorPolicy, setEditMajorPolicy] = useState(project.major_policy ?? "");
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [goalsError, setGoalsError] = useState<string | null>(null);

  // ─── ステータス変更 ─────────────────────────────────────────────────────────
  const handleStatusCycle = async () => {
    const idx = STATUS_CYCLE.indexOf(status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] as Project["status"];
    setStatusSaving(true);
    setStatus(next);
    try {
      await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setStatusSaving(false);
    }
  };

  // ─── 概要保存 ───────────────────────────────────────────────────────────────
  const handleEditSave = async () => {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDesc,
          department_name: editDept,
          plan_start_date: editStartDate || null,
          plan_end_date: editEndDate || null,
        }),
      });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok) { setEditError(json.error ?? "保存に失敗しました"); return; }
      setShowEditModal(false);
      router.refresh();
    } catch {
      setEditError("通信エラーが発生しました");
    } finally {
      setEditSaving(false);
    }
  };

  // ─── 目標保存 ───────────────────────────────────────────────────────────────
  const handleGoalsSave = async () => {
    setGoalsSaving(true);
    setGoalsError(null);
    try {
      const goalsPayload = editGoals
        .map((g, i) => ({ goal_number: i + 1, title: g.title, description: g.description, sort_order: i }))
        .filter((g) => g.title.trim().length > 0);

      const res = await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: editPurpose || null,
          major_policy: editMajorPolicy || null,
          goals: goalsPayload,
        }),
      });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok) { setGoalsError(json.error ?? "保存に失敗しました"); return; }
      setShowGoalsModal(false);
      router.refresh();
    } catch {
      setGoalsError("通信エラーが発生しました");
    } finally {
      setGoalsSaving(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--bg-secondary)",
    borderColor: "var(--border)",
    boxShadow: "0 2px 16px rgba(0,0,0,0.15)",
  };

  const inputCls = "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors duration-200";
  const inputSty: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)", color: "var(--text-primary)" };

  return (
    <div className="p-6 max-w-3xl space-y-6">

      {/* ══════════ ヘッダーカード ══════════ */}
      <div className="rounded-2xl border p-6" style={cardStyle}>
        {/* 上段：タイトル + ステータス */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-1">
              {project.municipality_name}
              {project.department_name ? ` / ${project.department_name}` : ""}
            </p>
            <h2 className="text-xl font-bold leading-snug" style={{ color: "var(--text-primary)" }}>
              {project.title}
            </h2>
          </div>

          {/* ステータスバッジ（クリックで変更） */}
          <button
            onClick={handleStatusCycle}
            disabled={statusSaving}
            className="shrink-0 text-xs px-3 py-1 rounded-full font-medium transition-opacity hover:opacity-80 disabled:opacity-50 cursor-pointer"
            style={STATUS_STYLE[status]}
            title="クリックでステータスを変更"
          >
            {STATUS_LABEL[status]}
          </button>
        </div>

        {/* 計画期間 */}
        <div className="flex flex-wrap gap-4 text-sm mb-3">
          <div>
            <span className="text-xs text-slate-500 mr-1">登録日:</span>
            <span style={{ color: "var(--text-primary)" }}>
              {new Date(project.created_at).toLocaleDateString("ja-JP")}
            </span>
          </div>
          <div>
            <span className="text-xs text-slate-500 mr-1">計画期間:</span>
            <span style={{ color: "var(--text-primary)" }}>
              {fmtDate(project.plan_start_date)} 〜 {fmtDate(project.plan_end_date)}
            </span>
          </div>
        </div>

        {/* 概要 */}
        {project.description && (
          <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--text-secondary)" }}>
            {project.description}
          </p>
        )}

        {/* 編集ボタン */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors duration-200 hover:border-indigo-400 hover:text-indigo-400"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            ✏️ 概要を編集
          </button>
        </div>
      </div>

      {/* ══════════ 目的・目標セクション ══════════ */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            計画の目的・目標
          </h3>
          <button
            onClick={() => setShowGoalsModal(true)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors duration-200 hover:border-indigo-400 hover:text-indigo-400"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            ✏️ 編集
          </button>
        </div>

        <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
          {/* 目的 */}
          {project.purpose ? (
            <div>
              <p className="text-xs font-semibold text-indigo-400 mb-1">計画の目的</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                {project.purpose}
              </p>
            </div>
          ) : null}

          {/* 基本目標 */}
          {goals.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-indigo-400 mb-2">基本目標</p>
              <ol className="space-y-1.5">
                {goals.map((g) => (
                  <li key={g.id} className="flex items-start gap-2">
                    <span
                      className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white"
                      style={{ background: "#6366f1" }}
                    >
                      {g.goal_number}
                    </span>
                    <span className="text-sm" style={{ color: "var(--text-primary)" }}>{g.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* 重点施策 */}
          {project.major_policy ? (
            <div>
              <p className="text-xs font-semibold text-cyan-400 mb-1">重点施策の方向性</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                {project.major_policy}
              </p>
            </div>
          ) : null}

          {/* データなし */}
          {!project.purpose && goals.length === 0 && !project.major_policy && (
            <div className="text-center py-4">
              <p className="text-sm text-slate-500 mb-3">目的・目標が設定されていません</p>
              <button
                onClick={() => setShowGoalsModal(true)}
                className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors duration-200 hover:border-indigo-400 hover:text-indigo-400"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                目標を設定する
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ══════════ ロジックモデルセクション ══════════ */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            ロジックモデル
          </h3>
          <Link
            href={`/projects/${project.id}/logic-model`}
            className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
          >
            編集する →
          </Link>
        </div>

        {logicModel ? (
          <div className="rounded-2xl border p-5 overflow-x-auto" style={cardStyle}>
            <div className="flex gap-4 min-w-max">
              {LOGIC_MODEL_COLS.map((col) => {
                const items: string[] = (logicModel[col.key as keyof LogicModel] as string[] | null) ?? [];
                return (
                  <div key={col.key} className="flex-1 min-w-[130px]">
                    <p
                      className="text-xs font-semibold mb-2 pb-1 border-b"
                      style={{ color: col.color, borderColor: col.color + "40" }}
                    >
                      {col.label}
                    </p>
                    {items.length === 0 ? (
                      <p className="text-xs text-slate-600">—</p>
                    ) : (
                      <ul className="space-y-1">
                        {items.map((item, i) => (
                          <li
                            key={i}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: col.color + "15", color: "var(--text-primary)" }}
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            {logicModel.generated_at && (
              <p className="text-xs text-slate-600 mt-3">
                最終更新: {new Date(logicModel.generated_at).toLocaleDateString("ja-JP")}
              </p>
            )}
          </div>
        ) : (
          <div
            className="rounded-2xl border border-dashed p-8 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm text-slate-500 mb-3">ロジックモデルはまだ作成されていません</p>
            <Link
              href={`/projects/${project.id}/logic-model`}
              className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
            >
              ロジックモデルを作成する →
            </Link>
          </div>
        )}
      </section>

      {/* ══════════ 概要編集モーダル ══════════ */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border p-6 space-y-4 neu-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>概要を編集</h3>

            {editError && (
              <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{editError}</p>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">計画名</label>
              <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                className={inputCls} style={inputSty} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">概要</label>
              <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                rows={3} className={inputCls} style={inputSty} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">担当課名</label>
              <input type="text" value={editDept} onChange={(e) => setEditDept(e.target.value)}
                className={inputCls} style={inputSty} placeholder="例: 高齢福祉課" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">計画開始日</label>
                <input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)}
                  className={inputCls} style={inputSty} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">計画終了日</label>
                <input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)}
                  className={inputCls} style={inputSty} />
              </div>
            </div>

            <div className="pt-1">
              <Link
                href={`/projects/${project.id}/knowledge`}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
              >
                📚 ナレッジを管理 →
              </Link>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowEditModal(false)}
                className="text-sm px-4 py-2 rounded-xl border transition-colors duration-200"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <div className="neu-button-wrap">
                <button
                  onClick={handleEditSave}
                  disabled={editSaving || !editTitle.trim()}
                  className="text-white text-sm font-semibold px-5 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed neu-button-primary"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                >
                  {editSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ 目標編集モーダル ══════════ */}
      {showGoalsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowGoalsModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border p-6 space-y-4 neu-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>目的・目標を編集</h3>

            {goalsError && (
              <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{goalsError}</p>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">計画の目的</label>
              <textarea value={editPurpose} onChange={(e) => setEditPurpose(e.target.value)}
                rows={3} className={inputCls} style={inputSty}
                placeholder="この計画が解決しようとする課題や達成すべき目的" />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">基本目標（最大3つ）</label>
              <div className="space-y-2">
                {editGoals.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-400 w-5 shrink-0">#{i + 1}</span>
                    <input
                      type="text"
                      value={g.title}
                      onChange={(e) => {
                        const next: { title: string; description: string }[] = [...editGoals];
                        next[i] = { title: e.target.value, description: next[i]?.description ?? "" };
                        setEditGoals(next);
                      }}
                      className={inputCls}
                      style={inputSty}
                      placeholder={`基本目標 ${i + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">重点施策の方向性</label>
              <textarea value={editMajorPolicy} onChange={(e) => setEditMajorPolicy(e.target.value)}
                rows={3} className={inputCls} style={inputSty}
                placeholder="計画期間中の重点施策・取り組みの方向性" />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowGoalsModal(false)}
                className="text-sm px-4 py-2 rounded-xl border transition-colors duration-200"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <div className="neu-button-wrap">
                <button
                  onClick={handleGoalsSave}
                  disabled={goalsSaving}
                  className="text-white text-sm font-semibold px-5 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed neu-button-primary"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                >
                  {goalsSaving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
