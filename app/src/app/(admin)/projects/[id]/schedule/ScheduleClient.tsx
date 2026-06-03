"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UpgradeModal from "@/components/UpgradeModal";

export interface PhaseRow {
  id: string;
  phase: "preparation" | "implementation" | "evaluation" | "reporting";
  title: string;
  start_date: string;
  end_date: string;
  status: "pending" | "in_progress" | "done";
}

export interface TaskRow {
  id: string;
  schedule_id: string;
  title: string;
  due_date: string | null;
  document_required: boolean;
  document_deadline: string | null;
  gcal_event_id: string | null;
  completed_at: string | null;
}

interface Kpi {
  label: string;
  target: number;
  unit: string;
}

interface Props {
  projectId: string;
  projectTitle: string;
  projectDescription: string;
  kpis: Kpi[];
  phases: PhaseRow[];
  tasks: TaskRow[];
}

const PHASE_META = {
  preparation:    { label: "準備期",   color: "#6366f1", bg: "bg-indigo-500/20",  text: "text-indigo-300",  border: "#6366f140" },
  implementation: { label: "実施期",   color: "#10b981", bg: "bg-emerald-500/20", text: "text-emerald-300", border: "#10b98140" },
  evaluation:     { label: "評価期",   color: "#f59e0b", bg: "bg-amber-500/20",   text: "text-amber-300",   border: "#f59e0b40" },
  reporting:      { label: "報告期",   color: "#a855f7", bg: "bg-purple-500/20",  text: "text-purple-300",  border: "#a855f740" },
} as const;

const STATUS_META = {
  pending:     { label: "未着手",  badge: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  in_progress: { label: "進行中",  badge: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  done:        { label: "完了",    badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
} as const;

function GanttChart({ phases, tasks }: { phases: PhaseRow[]; tasks: TaskRow[] }) {
  if (phases.length === 0) return null;

  const allDates = phases.flatMap((p) => [new Date(p.start_date), new Date(p.end_date)]);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));

  // 月単位の軸を生成
  const months: Date[] = [];
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
  while (cur < end) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  const totalDays = (maxDate.getTime() - minDate.getTime()) / 86400000 + 1;
  const pct = (date: string) =>
    Math.max(0, Math.min(100,
      ((new Date(date).getTime() - minDate.getTime()) / 86400000 / totalDays) * 100
    ));
  const width = (s: string, e: string) =>
    Math.max(0.5, pct(e) - pct(s));

  return (
    <div
      className="rounded-2xl border p-5 overflow-x-auto"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
        ガントチャート
      </h3>

      {/* 月軸ヘッダー */}
      <div className="min-w-[600px]">
        <div className="flex mb-2 ml-36">
          {months.map((m) => (
            <div
              key={m.toISOString()}
              className="text-xs text-slate-500 text-center"
              style={{ width: `${100 / months.length}%`, flexShrink: 0 }}
            >
              {m.getMonth() + 1}月
            </div>
          ))}
        </div>

        {/* フェーズ行 */}
        {phases.map((phase) => {
          const meta = PHASE_META[phase.phase];
          const phaseTasks = tasks.filter((t) => t.schedule_id === phase.id);

          return (
            <div key={phase.id} className="mb-3">
              {/* フェーズバー */}
              <div className="flex items-center gap-2 mb-1">
                <div className="w-36 flex-shrink-0 text-xs text-slate-300 font-medium truncate">
                  {meta.label}: {phase.title}
                </div>
                <div className="flex-1 relative h-6">
                  <div
                    className="absolute h-full rounded-md flex items-center px-2"
                    style={{
                      left: `${pct(phase.start_date)}%`,
                      width: `${width(phase.start_date, phase.end_date)}%`,
                      background: meta.color,
                      opacity: 0.85,
                    }}
                  >
                    <span className="text-white text-xs font-semibold truncate">{phase.title}</span>
                  </div>
                </div>
              </div>

              {/* タスクバー */}
              {phaseTasks.map((task) => (
                task.due_date && (
                  <div key={task.id} className="flex items-center gap-2 mb-0.5">
                    <div className="w-36 flex-shrink-0 text-xs text-slate-500 pl-3 truncate">
                      {task.completed_at ? "✓ " : ""}{task.title}
                    </div>
                    <div className="flex-1 relative h-4">
                      <div
                        className="absolute h-full rounded-sm"
                        style={{
                          left: `${pct(task.due_date)}%`,
                          width: "1.5%",
                          minWidth: "6px",
                          background: task.completed_at ? "#10b981" : meta.color,
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </div>
                )
              ))}
            </div>
          );
        })}

        {/* 現在日ライン */}
        <div
          className="absolute top-0 bottom-0 w-px pointer-events-none"
          style={{
            left: `calc(9rem + ${pct(new Date().toISOString().slice(0, 10))}% * (100% - 9rem) / 100)`,
            background: "#ef4444",
            opacity: 0.5,
          }}
        />
      </div>
    </div>
  );
}

export default function ScheduleClient({
  projectId,
  projectTitle,
  projectDescription,
  kpis,
  phases: initialPhases,
  tasks: initialTasks,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [phases, setPhases] = useState<PhaseRow[]>(initialPhases);
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const inputStyle = { background: "#12151f", borderColor: "var(--border)" };
  const inputClass =
    "rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";

  const handleGenerate = async () => {
    if (!startDate || !endDate) {
      setGenError("開始日と終了日を入力してください");
      return;
    }
    setGenerating(true);
    setGenError(null);
    setCharCount(0);

    try {
      const res = await fetch("/api/ai/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: projectTitle,
          description: projectDescription,
          startDate,
          endDate,
          kpis,
        }),
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({ error: null }))) as { error: string | null; upgrade_url?: string };
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "AI生成回数の上限に達しました");
        } else {
          setGenError(json.error ?? "生成に失敗しました");
        }
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__ERROR__:")) {
          setGenError(chunk.replace("__ERROR__:", "").trim());
          setGenerating(false);
          return;
        }
        accumulated += chunk;
        setCharCount(accumulated.length);
      }

      // 生成完了 → ページをリフレッシュして最新データを取得
      startTransition(() => router.refresh());
    } catch {
      setGenError("通信エラーが発生しました");
    } finally {
      setGenerating(false);
    }
  };

  const nextStatus = (s: TaskRow["completed_at"]): string =>
    s ? "pending" : "done";

  const handleToggleTask = async (task: TaskRow) => {
    setUpdatingTaskId(task.id);
    try {
      const res = await fetch(`/api/admin/schedule-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: nextStatus(task.completed_at) }),
      });
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, completed_at: task.completed_at ? null : new Date().toISOString() }
              : t,
          ),
        );
      }
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handlePhaseStatus = async (phase: PhaseRow, status: PhaseRow["status"]) => {
    const res = await fetch(`/api/admin/project-schedules/${phase.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setPhases((prev) => prev.map((p) => (p.id === phase.id ? { ...p, status } : p)));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const taskIds = tasks.filter((t) => !t.gcal_event_id).map((t) => t.id);
      if (taskIds.length === 0) {
        setExportMsg("エクスポート済みのタスクのみです");
        return;
      }
      const res = await fetch("/api/integrations/gcal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds }),
      });
      const json = (await res.json()) as { data: { exported: number } | null; error: string | null };
      if (!res.ok) {
        setExportMsg(json.error ?? "エクスポートに失敗しました");
      } else {
        setExportMsg(`${json.data?.exported ?? 0} 件を Google Calendar に登録しました`);
        startTransition(() => router.refresh());
      }
    } catch {
      setExportMsg("通信エラーが発生しました");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
    <div className="space-y-8">
      {/* 生成フォーム */}
      <div
        className="rounded-2xl border p-5 space-y-4"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          AIスケジュール生成
        </h3>

        {genError && (
          <div
            className="rounded-lg border px-4 py-3 text-sm text-red-400"
            style={{ background: "#ef444410", borderColor: "#ef444430" }}
          >
            {genError}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">計画開始日</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">計画終了日</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="neu-button-wrap">
            <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {generating ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                生成中{charCount > 0 && `（${charCount}文字）`}
              </>
            ) : (
              "AIでスケジュールを生成"
            )}
          </button>
          </div>
        </div>
      </div>

      {phases.length > 0 && (
        <>
          {/* ガントチャート */}
          <GanttChart phases={phases} tasks={tasks} />

          {/* タスク一覧テーブル */}
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                タスク一覧
              </h3>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 border rounded-lg px-3 py-1.5 hover:bg-cyan-400/10 disabled:opacity-40 transition-all duration-200"
                style={{ borderColor: "#06b6d430" }}
              >
                {exporting ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    連携中...
                  </>
                ) : (
                  "📅 Google Calendar エクスポート"
                )}
              </button>
            </div>

            {exportMsg && (
              <div className="px-5 py-2 text-xs text-slate-400" style={{ borderBottom: "1px solid var(--border)" }}>
                {exportMsg}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["フェーズ", "タスク名", "期限", "資料要否", "資料期限", "状態", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {phases.map((phase) => {
                    const meta = PHASE_META[phase.phase];
                    const phaseTasks = tasks.filter((t) => t.schedule_id === phase.id);
                    return phaseTasks.map((task, ti) => (
                      <tr
                        key={task.id}
                        style={{ borderBottom: "1px solid var(--border)" }}
                        className="hover:bg-white/2 transition-colors duration-150"
                      >
                        {ti === 0 ? (
                          <td
                            className="px-4 py-3 align-top"
                            rowSpan={phaseTasks.length}
                          >
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.bg} ${meta.text}`}
                              style={{ borderColor: meta.border }}
                            >
                              {meta.label}
                            </span>
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <span
                            className={task.completed_at ? "line-through text-slate-500" : "text-slate-200"}
                          >
                            {task.title}
                          </span>
                          {task.gcal_event_id && (
                            <span className="ml-2 text-xs text-cyan-500">📅</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                          {task.due_date
                            ? new Date(task.due_date).toLocaleDateString("ja-JP")
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {task.document_required ? (
                            <span className="text-amber-400 text-xs">要</span>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                          {task.document_deadline
                            ? new Date(task.document_deadline).toLocaleDateString("ja-JP")
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                              task.completed_at
                                ? STATUS_META.done.badge
                                : STATUS_META.pending.badge
                            }`}
                          >
                            {task.completed_at ? STATUS_META.done.label : STATUS_META.pending.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleTask(task)}
                            disabled={updatingTaskId === task.id}
                            className="text-xs text-slate-500 hover:text-slate-200 border rounded px-2 py-0.5 transition-colors duration-200 disabled:opacity-40"
                            style={{ borderColor: "var(--border)" }}
                          >
                            {updatingTaskId === task.id
                              ? "..."
                              : task.completed_at
                              ? "戻す"
                              : "完了"}
                          </button>
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* フェーズステータス管理 */}
          <div
            className="rounded-2xl border p-5"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              フェーズステータス
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {phases.map((phase) => {
                const meta = PHASE_META[phase.phase];
                return (
                  <div
                    key={phase.id}
                    className="rounded-xl border p-3 space-y-2"
                    style={{ borderColor: meta.border }}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_META[phase.status].badge}`}
                      >
                        {STATUS_META[phase.status].label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 truncate">{phase.title}</p>
                    <div className="flex gap-1 flex-wrap">
                      {(["pending", "in_progress", "done"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => handlePhaseStatus(phase, s)}
                          disabled={phase.status === s}
                          className="text-xs rounded px-2 py-0.5 border transition-colors duration-200 disabled:opacity-30"
                          style={{
                            borderColor: phase.status === s ? meta.color : "var(--border)",
                            color: phase.status === s ? meta.color : "#64748b",
                          }}
                        >
                          {STATUS_META[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}
