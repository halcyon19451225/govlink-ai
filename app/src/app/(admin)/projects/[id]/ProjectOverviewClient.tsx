"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import KnowledgePanel from "@/components/KnowledgePanel";

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
  vision: string | null;
  created_at: string;
}

interface Goal {
  id: string;
  goal_number: number;
  title: string;
  description: string | null;
  sort_order: number;
}

interface Kpi {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  goal_id: string | null;
  indicator_type: string;
  previous_value: number | null;
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
  initialGoals: Goal[];
  initialKpis: Kpi[];
  logicModel: LogicModel | null;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const STATUS_CYCLE: Project["status"][] = ["draft", "active", "completed", "archived"];

const STATUS_LABEL: Record<Project["status"], string> = {
  draft: "計画中", active: "実施中", completed: "完了", archived: "アーカイブ",
};

const STATUS_STYLE: Record<Project["status"], React.CSSProperties> = {
  draft:    { background: "#64748b20", color: "#94a3b8", border: "1px solid #64748b40" },
  active:   { background: "#6366f120", color: "#a5b4fc", border: "1px solid #6366f140" },
  completed:{ background: "#10b98120", color: "#34d399", border: "1px solid #10b98140" },
  archived: { background: "#f59e0b20", color: "#fbbf24", border: "1px solid #f59e0b40" },
};

const LOGIC_COLS = [
  { key: "inputs",                label: "投入資源", color: "#6366f1" },
  { key: "activities",            label: "実施活動", color: "#8b5cf6" },
  { key: "outputs",               label: "産出物",   color: "#06b6d4" },
  { key: "initial_outcomes",      label: "初期成果", color: "#10b981" },
  { key: "intermediate_outcomes", label: "中期成果", color: "#0d9488" },
] as const;

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function fmtDateShort(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

// ─── SaveFeedback フック ──────────────────────────────────────────────────────

function useSaveFeedback() {
  const [msg, setMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text = "✓ 保存しました") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMsg(text);
    timerRef.current = setTimeout(() => setMsg(null), 2000);
  }, []);
  return { msg, show };
}

// ─── 共通スタイル定数 ─────────────────────────────────────────────────────────

const INP     = "neu-input w-full text-sm";
const INP_S: React.CSSProperties = { color: "var(--text-primary)" };
const BORDER_S: React.CSSProperties = { borderColor: "var(--border)" };

// ─── SaveButton ──────────────────────────────────────────────────────────────

function SaveButton({
  saving, onClick, disabled,
}: { saving: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="neu-button-wrap">
      <button
        type="button"
        onClick={onClick}
        disabled={saving || disabled}
        className="text-white text-xs font-semibold px-4 py-1.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed neu-button-primary"
        style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
      >
        {saving ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            保存中...
          </span>
        ) : "保存"}
      </button>
    </div>
  );
}

// ─── メインコンポーネント ──────────────────────────────────────────────────────

export default function ProjectOverviewClient({
  project,
  initialGoals,
  initialKpis,
  logicModel,
}: Props) {
  const router = useRouter();

  // ── モード管理 ──
  const [editMode, setEditMode] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);

  // ── ヘッダー state ──
  const [title, setTitle]       = useState(project.title);
  const [status, setStatus]     = useState<Project["status"]>(project.status);
  const [startDate, setStartDate] = useState(project.plan_start_date ?? "");
  const [endDate, setEndDate]     = useState(project.plan_end_date ?? "");
  const [deptName, setDeptName]   = useState(project.department_name ?? "");
  const [headerDirty, setHeaderDirty] = useState(false);
  const [headerSaving, setHeaderSaving] = useState(false);
  const headerFb = useSaveFeedback();

  const handleStatusCycle = () => {
    const idx = STATUS_CYCLE.indexOf(status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] as Project["status"];
    setStatus(next);
    setHeaderDirty(true);
  };

  const saveHeader = async () => {
    setHeaderSaving(true);
    try {
      await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, status,
          department_name: deptName || null,
          plan_start_date: startDate || null,
          plan_end_date: endDate || null,
        }),
      });
      setHeaderDirty(false);
      headerFb.show();
      router.refresh();
    } finally { setHeaderSaving(false); }
  };

  // ── ビジョン state ──
  const [vision, setVision]         = useState(project.vision ?? "");
  const [visionSaving, setVisionSaving] = useState(false);
  const visionFb = useSaveFeedback();
  const visionDirty = vision !== (project.vision ?? "");

  const saveVision = async () => {
    setVisionSaving(true);
    try {
      await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vision: vision || null }),
      });
      visionFb.show();
      router.refresh();
    } finally { setVisionSaving(false); }
  };

  // ── 概要 state ──
  const [desc, setDesc] = useState(project.description);
  const [descSaving, setDescSaving] = useState(false);
  const descFb = useSaveFeedback();
  const descDirty = desc !== project.description;

  const saveDesc = async () => {
    setDescSaving(true);
    try {
      await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      descFb.show();
      router.refresh();
    } finally { setDescSaving(false); }
  };

  // ── 目的 state ──
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [goalEditMap, setGoalEditMap] = useState<Record<string, { title: string; description: string }>>({});
  const [goalSaving, setGoalSaving]   = useState<Record<string, boolean>>({});
  const [goalAdding, setGoalAdding]   = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc]   = useState("");
  const [goalAddSaving, setGoalAddSaving] = useState(false);
  const goalFb = useSaveFeedback();

  const startEditGoal = (g: Goal) =>
    setGoalEditMap((p) => ({ ...p, [g.id]: { title: g.title, description: g.description ?? "" } }));
  const cancelEditGoal = (id: string) =>
    setGoalEditMap((p) => { const n = { ...p }; delete n[id]; return n; });

  const saveGoal = async (id: string) => {
    const edit = goalEditMap[id];
    if (!edit) return;
    setGoalSaving((p) => ({ ...p, [id]: true }));
    try {
      await fetch(`/api/admin/projects/${project.id}/goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      setGoals((p) => p.map((g) => g.id === id ? { ...g, ...edit } : g));
      cancelEditGoal(id);
      goalFb.show();
    } finally { setGoalSaving((p) => ({ ...p, [id]: false })); }
  };

  const deleteGoal = async (id: string) => {
    if (!confirm("この目的を削除しますか？関連する目標（KPI）も削除されます。")) return;
    await fetch(`/api/admin/projects/${project.id}/goals/${id}`, { method: "DELETE" });
    setGoals((p) => p.filter((g) => g.id !== id));
    setKpis((p) => p.filter((k) => k.goal_id !== id));
    goalFb.show("✓ 削除しました");
  };

  const addGoal = async () => {
    if (!newGoalTitle.trim()) return;
    setGoalAddSaving(true);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newGoalTitle, description: newGoalDesc, sort_order: goals.length }),
      });
      const json = (await res.json()) as { data: { id: string; goal_number: number } | null };
      if (json.data) {
        setGoals((p) => [...p, {
          id: json.data!.id, goal_number: json.data!.goal_number,
          title: newGoalTitle, description: newGoalDesc, sort_order: p.length,
        }]);
        setNewGoalTitle(""); setNewGoalDesc("");
        setGoalAdding(false);
        goalFb.show();
      }
    } finally { setGoalAddSaving(false); }
  };

  // ── KPI state ──
  const [kpis, setKpis] = useState<Kpi[]>(initialKpis);
  const [kpiEditMap, setKpiEditMap] = useState<Record<string, { label: string; target_str: string; unit: string; prev_str: string }>>({});
  const [kpiSaving, setKpiSaving]   = useState<Record<string, boolean>>({});
  const [kpiAddingFor, setKpiAddingFor] = useState<string | null>(null);
  const [newKpi, setNewKpi] = useState({ label: "", target_str: "", unit: "", prev_str: "" });
  const [kpiAddSaving, setKpiAddSaving] = useState(false);
  const kpiFb = useSaveFeedback();

  const startEditKpi = (k: Kpi) =>
    setKpiEditMap((p) => ({
      ...p, [k.id]: {
        label: k.label,
        target_str: String(k.target),
        unit: k.unit,
        prev_str: k.previous_value != null ? String(k.previous_value) : "",
      },
    }));
  const cancelEditKpi = (id: string) =>
    setKpiEditMap((p) => { const n = { ...p }; delete n[id]; return n; });

  const saveKpi = async (id: string) => {
    const edit = kpiEditMap[id];
    if (!edit) return;
    setKpiSaving((p) => ({ ...p, [id]: true }));
    try {
      await fetch(`/api/admin/projects/${project.id}/kpis/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: edit.label,
          target: parseFloat(edit.target_str) || 0,
          unit: edit.unit,
          previous_value: edit.prev_str ? parseFloat(edit.prev_str) : null,
        }),
      });
      setKpis((p) => p.map((k) => k.id === id ? {
        ...k,
        label: edit.label,
        target: parseFloat(edit.target_str) || k.target,
        unit: edit.unit,
        previous_value: edit.prev_str ? parseFloat(edit.prev_str) : null,
      } : k));
      cancelEditKpi(id);
      kpiFb.show();
    } finally { setKpiSaving((p) => ({ ...p, [id]: false })); }
  };

  const deleteKpi = async (id: string) => {
    if (!confirm("このKPIを削除しますか？")) return;
    await fetch(`/api/admin/projects/${project.id}/kpis/${id}`, { method: "DELETE" });
    setKpis((p) => p.filter((k) => k.id !== id));
    kpiFb.show("✓ 削除しました");
  };

  const addKpi = async (goalId: string | null) => {
    if (!newKpi.label.trim()) return;
    setKpiAddSaving(true);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/kpis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newKpi.label,
          target: parseFloat(newKpi.target_str) || 0,
          unit: newKpi.unit,
          goal_id: goalId,
          previous_value: newKpi.prev_str ? parseFloat(newKpi.prev_str) : null,
        }),
      });
      const json = (await res.json()) as { data: { id: string } | null };
      if (json.data) {
        setKpis((p) => [...p, {
          id: json.data!.id, label: newKpi.label,
          target: parseFloat(newKpi.target_str) || 0,
          current: 0, unit: newKpi.unit,
          goal_id: goalId, indicator_type: "outcome_initial",
          previous_value: newKpi.prev_str ? parseFloat(newKpi.prev_str) : null,
        }]);
        setNewKpi({ label: "", target_str: "", unit: "", prev_str: "" });
        setKpiAddingFor(null);
        kpiFb.show();
      }
    } finally { setKpiAddSaving(false); }
  };

  // ── 編集モード終了 ──
  const handleExitEdit = () => {
    const anyDirty = headerDirty || descDirty ||
      Object.keys(goalEditMap).length > 0 || Object.keys(kpiEditMap).length > 0 ||
      goalAdding || kpiAddingFor !== null;
    if (anyDirty && !confirm("未保存の変更があります。編集を終了しますか？")) return;
    setEditMode(false);
    setGoalAdding(false);
    setKpiAddingFor(null);
    setGoalEditMap({});
    setKpiEditMap({});
  };

  // ─── ロジックモデルセクション（共通） ────────────────────────────────────────
  const LogicSection = () => (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-secondary)" }}>
          ロジックモデル
        </h3>
        <Link href={`/projects/${project.id}/logic-model`}
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
          編集する →
        </Link>
      </div>
      {logicModel ? (
        <div className="rounded-2xl border p-5 overflow-x-auto"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <div className="flex gap-4 min-w-max">
            {LOGIC_COLS.map((col) => {
              const items: string[] =
                (logicModel[col.key as keyof LogicModel] as string[] | null) ?? [];
              return (
                <div key={col.key} className="flex-1 min-w-[130px]">
                  <p className="text-xs font-semibold mb-2 pb-1 border-b"
                    style={{ color: col.color, borderColor: col.color + "40" }}>
                    {col.label}
                  </p>
                  {items.length === 0 ? (
                    <p className="text-xs text-slate-600">—</p>
                  ) : (
                    <ul className="space-y-1">
                      {items.map((item, i) => (
                        <li key={i} className="text-xs px-2 py-1 rounded"
                          style={{ background: col.color + "15", color: "var(--text-primary)" }}>
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
        <div className="rounded-2xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)" }}>
          <p className="text-sm text-slate-500 mb-3">ロジックモデルはまだ作成されていません</p>
          <Link href={`/projects/${project.id}/logic-model`}
            className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">
            ロジックモデルを作成する →
          </Link>
        </div>
      )}
    </section>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 通常表示モード
  // ─────────────────────────────────────────────────────────────────────────────
  if (!editMode) {
    return (
      <div className="p-6 max-w-3xl space-y-6">

        {/* メインカード */}
        <div className="neu-card p-6 space-y-4">

          {/* 上段: タイトル + 操作ボタン */}
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-xl font-bold leading-snug"
              style={{ color: "var(--text-primary)" }}>
              {title}
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:border-indigo-400 hover:text-indigo-400"
                style={{ ...BORDER_S, color: "var(--text-secondary)" }}
              >
                ✏️ 編集
              </button>
            </div>
          </div>

          {/* ビジョン（計画名直下） */}
          {vision ? (
            <div style={{
              borderLeft: "3px solid rgba(99, 102, 241, 0.45)",
              paddingLeft: 16,
              paddingTop: 6,
              paddingBottom: 6,
            }}>
              <p style={{
                fontSize: "1.1rem",
                fontWeight: 500,
                fontStyle: "italic",
                lineHeight: 1.6,
                background: "linear-gradient(135deg, #06b6d4, #8b5cf6, #6366f1)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                whiteSpace: "pre-wrap",
              }}>
                &#8220;{vision}&#8221;
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                paddingLeft: 16,
                paddingTop: 6,
                paddingBottom: 6,
                background: "none",
                border: "none",
                borderLeft: "3px solid rgba(99, 102, 241, 0.2)",
                cursor: "pointer",
                fontSize: "0.95rem",
                fontStyle: "italic",
                color: "var(--text-secondary)",
                opacity: 0.5,
              }}
            >
              &#8220; ビジョンを設定する... &#8221;
            </button>
          )}

          {/* ステータス・基本情報バー */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm pt-1">
            {/* ステータスバッジ */}
            <button type="button" onClick={handleStatusCycle}
              className="text-xs px-3 py-1 rounded-full font-medium hover:opacity-80 transition-opacity cursor-pointer shrink-0"
              style={STATUS_STYLE[status]}
              title="クリックでステータスを変更">
              {STATUS_LABEL[status]}
            </button>

            {/* 計画期間 */}
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>📅</span>
              <span style={{ color: "var(--text-primary)" }}>
                {fmtDateShort(startDate || null)} 〜 {fmtDateShort(endDate || null)}
              </span>
            </div>

            {/* 担当課名 */}
            {deptName && (
              <div className="flex items-center gap-1">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>🏢</span>
                <span style={{ color: "var(--text-primary)" }}>{deptName}</span>
              </div>
            )}

            {/* 登録日 */}
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                登録: {new Date(project.created_at).toLocaleDateString("ja-JP")}
              </span>
            </div>
          </div>

          {/* 概要 */}
          <div>
            <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>計画概要</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: desc ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {desc || "概要を入力してください"}
            </p>
          </div>

          {/* アコーディオントグル */}
          <div className="pt-2 border-t" style={BORDER_S}>
            <button
              type="button"
              onClick={() => setAccordionOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-indigo-400"
              style={{ color: "var(--text-secondary)" }}
            >
              <span style={{
                display: "inline-block",
                transition: "transform 0.2s ease",
                transform: accordionOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}>▼</span>
              {accordionOpen ? "目的・目標を閉じる" : "目的・目標を見る"}
            </button>

            {/* アコーディオン本体 */}
            <div style={{
              maxHeight: accordionOpen ? "2000px" : "0px",
              overflow: "hidden",
              transition: "max-height 0.35s ease",
            }}>
              <div className="pt-4 space-y-3">
                {/* ビジョン（設定時のみ） */}
                {vision && (
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                    <span className="font-semibold text-indigo-400 mr-2">🔭 ビジョン:</span>
                    {vision}
                  </div>
                )}
                {goals.length === 0 ? (
                  <p className="text-sm text-slate-500 py-2">まだ設定されていません</p>
                ) : (
                  goals.map((g, gIdx) => {
                    const groupKpis = kpis.filter((k) => k.goal_id === g.id);
                    return (
                      <div key={g.id} className="neu-card-inset p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold text-white"
                            style={{ background: "#6366f1" }}>
                            目的{gIdx + 1}
                          </span>
                          <span className="text-sm font-semibold"
                            style={{ color: "var(--text-primary)" }}>
                            {g.title}
                          </span>
                        </div>
                        {g.description && (
                          <p className="text-xs leading-relaxed ml-1"
                            style={{ color: "var(--text-secondary)" }}>{g.description}</p>
                        )}
                        {groupKpis.length > 0 && (
                          <ul className="ml-2 space-y-1">
                            {groupKpis.map((k) => (
                              <li key={k.id} className="flex items-center gap-2 text-xs"
                                style={{ color: "var(--text-secondary)" }}>
                                <span className="text-cyan-400">└</span>
                                <span style={{ color: "var(--text-primary)" }}>{k.label}</span>
                                <span>目標: {k.target}{k.unit}</span>
                                {k.previous_value != null && (
                                  <span>/ 現状: {k.previous_value}{k.unit}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ロジックモデル */}
        <LogicSection />

        <KnowledgePanel projectId={project.id} open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 編集モード
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl space-y-6"
      style={{ animation: "fadeInUp 0.18s ease both" }}>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* 編集カード */}
      <div className="neu-card p-6 space-y-6">

        {/* 編集モードヘッダーバー */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            ✏️ 編集モード
          </span>
          <button type="button" onClick={handleExitEdit}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:border-red-400 hover:text-red-400"
            style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
            ✕ 編集を終了
          </button>
        </div>

        {/* ① ヘッダー編集 */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}>基本情報</p>

          <div className="flex items-center gap-3">
            <input type="text" value={title}
              onChange={(e) => { setTitle(e.target.value); setHeaderDirty(true); }}
              className={`${INP} text-base font-bold flex-1`} style={INP_S}
              placeholder="計画名を入力" />
            <button type="button" onClick={handleStatusCycle}
              className="shrink-0 text-xs px-3 py-1 rounded-full font-medium hover:opacity-80 cursor-pointer"
              style={STATUS_STYLE[status]} title="クリックでステータスを変更">
              {STATUS_LABEL[status]}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>計画開始日</label>
              <input type="date" value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setHeaderDirty(true); }}
                className={INP} style={INP_S} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>計画終了日</label>
              <input type="date" value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setHeaderDirty(true); }}
                className={INP} style={INP_S} />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>担当課名</label>
            <input type="text" value={deptName}
              onChange={(e) => { setDeptName(e.target.value); setHeaderDirty(true); }}
              className={INP} style={INP_S} placeholder="例: 高齢福祉課" />
          </div>

          <div className="flex items-center gap-3">
            {headerFb.msg && <span className="text-xs text-emerald-400">{headerFb.msg}</span>}
            {headerDirty && <SaveButton saving={headerSaving} onClick={saveHeader} />}
          </div>
        </section>

        <div className="border-t" style={BORDER_S} />

        {/* ② 概要・ビジョンセクション */}
        <section className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}>📋 計画概要 / ビジョン</p>

          {/* ビジョン */}
          <div className="space-y-2">
            <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
              🔭 ビジョン
            </label>
            <textarea value={vision}
              onChange={(e) => setVision(e.target.value)}
              rows={2} className={INP} style={INP_S}
              placeholder="この計画が目指す将来像・ビジョン（任意）" />
            <div className="flex items-center gap-3">
              {visionFb.msg && <span className="text-xs text-emerald-400">{visionFb.msg}</span>}
              {visionDirty && <SaveButton saving={visionSaving} onClick={saveVision} />}
            </div>
          </div>

          {/* 概要 */}
          <div className="space-y-2">
            <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
              計画概要
            </label>
            <textarea value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4} className={INP} style={INP_S}
              placeholder="計画の概要・背景を入力してください" />
            <div className="flex items-center gap-3">
              {descFb.msg && <span className="text-xs text-emerald-400">{descFb.msg}</span>}
              {descDirty && <SaveButton saving={descSaving} onClick={saveDesc} />}
            </div>
          </div>
        </section>

        <div className="border-t" style={BORDER_S} />

        {/* ③ 目的セクション */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}>🎯 目的</p>
            <div className="flex items-center gap-2">
              {goalFb.msg && <span className="text-xs text-emerald-400">{goalFb.msg}</span>}
              <button type="button"
                onClick={() => { setGoalAdding(true); setNewGoalTitle(""); setNewGoalDesc(""); }}
                className="text-xs font-medium px-3 py-1 rounded-lg border transition-colors hover:border-indigo-400 hover:text-indigo-400"
                style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
                ＋ 目的を追加
              </button>
            </div>
          </div>

          {/* 新規追加フォーム */}
          {goalAdding && (
            <div className="neu-card-inset p-3 space-y-2">
              <input type="text" value={newGoalTitle} autoFocus
                onChange={(e) => setNewGoalTitle(e.target.value)}
                className={INP} style={INP_S} placeholder="目的のタイトル（必須）" />
              <textarea value={newGoalDesc} onChange={(e) => setNewGoalDesc(e.target.value)}
                rows={2} className={INP} style={INP_S} placeholder="説明（任意）" />
              <div className="flex gap-2">
                <SaveButton saving={goalAddSaving} onClick={addGoal} disabled={!newGoalTitle.trim()} />
                <button type="button" onClick={() => setGoalAdding(false)}
                  className="text-xs px-3 py-1.5 border rounded-lg"
                  style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {goals.length === 0 && !goalAdding ? (
            <p className="text-sm text-center py-3" style={{ color: "var(--text-secondary)" }}>
              目的が設定されていません
            </p>
          ) : (
            goals.map((g, gIdx) => {
              const editing = goalEditMap[g.id];
              return (
                <div key={g.id} className="neu-card-inset p-3 space-y-2">
                  {editing ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold text-white"
                          style={{ background: "#6366f1" }}>目的{gIdx + 1}</span>
                        <input type="text" value={editing.title} autoFocus
                          onChange={(e) => setGoalEditMap((p) => ({ ...p, [g.id]: { ...p[g.id]!, title: e.target.value } }))}
                          className={`${INP} flex-1`} style={INP_S} placeholder="タイトル" />
                      </div>
                      <textarea value={editing.description}
                        onChange={(e) => setGoalEditMap((p) => ({ ...p, [g.id]: { ...p[g.id]!, description: e.target.value } }))}
                        rows={2} className={INP} style={INP_S} placeholder="説明（任意）" />
                      <div className="flex gap-2">
                        <SaveButton saving={goalSaving[g.id] ?? false} onClick={() => saveGoal(g.id)} disabled={!editing.title.trim()} />
                        <button type="button" onClick={() => cancelEditGoal(g.id)}
                          className="text-xs px-3 py-1.5 border rounded-lg"
                          style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
                          キャンセル
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold text-white mt-0.5"
                        style={{ background: "#6366f1" }}>目的{gIdx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{g.title}</p>
                        {g.description && (
                          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{g.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" onClick={() => startEditGoal(g)}
                          className="text-xs px-2 py-1 rounded border hover:border-indigo-400 hover:text-indigo-400 transition-colors"
                          style={{ ...BORDER_S, color: "var(--text-secondary)" }}>✏️</button>
                        <button type="button" onClick={() => deleteGoal(g.id)}
                          className="text-xs px-2 py-1 rounded border hover:border-red-400 hover:text-red-400 transition-colors"
                          style={{ ...BORDER_S, color: "var(--text-secondary)" }}>✕</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <div className="border-t" style={BORDER_S} />

        {/* ④ KPIセクション */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}>📊 目標（KPI）</p>
            {kpiFb.msg && <span className="text-xs text-emerald-400">{kpiFb.msg}</span>}
          </div>

          {goals.length === 0 ? (
            <p className="text-sm text-center py-3" style={{ color: "var(--text-secondary)" }}>
              まず目的を追加してください
            </p>
          ) : (
            goals.map((g, gIdx) => {
              const groupKpis = kpis.filter((k) => k.goal_id === g.id);
              const isAddingHere = kpiAddingFor === g.id;
              return (
                <div key={g.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ background: "#6366f1" }}>目的{gIdx + 1}</span>
                    <span className="text-xs font-semibold truncate"
                      style={{ color: "var(--text-primary)" }}>{g.title}</span>
                  </div>
                  <div className="ml-4 space-y-2">
                    {groupKpis.map((k) => {
                      const ed = kpiEditMap[k.id];
                      return (
                        <div key={k.id} className="neu-card-inset p-3">
                          {ed ? (
                            <div className="space-y-2">
                              <input type="text" value={ed.label}
                                onChange={(e) => setKpiEditMap((p) => ({ ...p, [k.id]: { ...p[k.id]!, label: e.target.value } }))}
                                className={INP} style={INP_S} placeholder="指標名" />
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-xs" style={{ color: "var(--text-secondary)" }}>目標値</label>
                                  <input type="number" value={ed.target_str}
                                    onChange={(e) => setKpiEditMap((p) => ({ ...p, [k.id]: { ...p[k.id]!, target_str: e.target.value } }))}
                                    className={INP} style={INP_S} />
                                </div>
                                <div>
                                  <label className="text-xs" style={{ color: "var(--text-secondary)" }}>単位</label>
                                  <input type="text" value={ed.unit}
                                    onChange={(e) => setKpiEditMap((p) => ({ ...p, [k.id]: { ...p[k.id]!, unit: e.target.value } }))}
                                    className={INP} style={INP_S} placeholder="%" />
                                </div>
                                <div>
                                  <label className="text-xs" style={{ color: "var(--text-secondary)" }}>現状値</label>
                                  <input type="number" value={ed.prev_str}
                                    onChange={(e) => setKpiEditMap((p) => ({ ...p, [k.id]: { ...p[k.id]!, prev_str: e.target.value } }))}
                                    className={INP} style={INP_S} placeholder="任意" />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <SaveButton saving={kpiSaving[k.id] ?? false} onClick={() => saveKpi(k.id)} />
                                <button type="button" onClick={() => cancelEditKpi(k.id)}
                                  className="text-xs px-3 py-1.5 border rounded-lg"
                                  style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium flex-1"
                                style={{ color: "var(--text-primary)" }}>{k.label}</span>
                              <span className="text-xs whitespace-nowrap"
                                style={{ color: "var(--text-secondary)" }}>
                                目標: {k.target}{k.unit}
                                {k.previous_value != null && ` / 現状: ${k.previous_value}${k.unit}`}
                              </span>
                              <button type="button" onClick={() => startEditKpi(k)}
                                className="text-xs px-2 py-0.5 rounded border hover:border-indigo-400 hover:text-indigo-400"
                                style={{ ...BORDER_S, color: "var(--text-secondary)" }}>✏️</button>
                              <button type="button" onClick={() => deleteKpi(k.id)}
                                className="text-xs px-2 py-0.5 rounded border hover:border-red-400 hover:text-red-400"
                                style={{ ...BORDER_S, color: "var(--text-secondary)" }}>✕</button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* この目的にKPI追加 */}
                    {isAddingHere ? (
                      <div className="neu-card-inset p-3 space-y-2">
                        <input type="text" value={newKpi.label} autoFocus
                          onChange={(e) => setNewKpi((p) => ({ ...p, label: e.target.value }))}
                          className={INP} style={INP_S} placeholder="指標名（例: 要介護認定率）" />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>目標値</label>
                            <input type="number" value={newKpi.target_str}
                              onChange={(e) => setNewKpi((p) => ({ ...p, target_str: e.target.value }))}
                              className={INP} style={INP_S} placeholder="19.8" />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>単位</label>
                            <input type="text" value={newKpi.unit}
                              onChange={(e) => setNewKpi((p) => ({ ...p, unit: e.target.value }))}
                              className={INP} style={INP_S} placeholder="%" />
                          </div>
                          <div>
                            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>現状値</label>
                            <input type="number" value={newKpi.prev_str}
                              onChange={(e) => setNewKpi((p) => ({ ...p, prev_str: e.target.value }))}
                              className={INP} style={INP_S} placeholder="任意" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <SaveButton saving={kpiAddSaving} onClick={() => addKpi(g.id)} disabled={!newKpi.label.trim()} />
                          <button type="button" onClick={() => setKpiAddingFor(null)}
                            className="text-xs px-3 py-1.5 border rounded-lg"
                            style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button"
                        onClick={() => {
                          setKpiAddingFor(g.id);
                          setNewKpi({ label: "", target_str: "", unit: "", prev_str: "" });
                        }}
                        className="w-full text-xs py-1.5 rounded-lg border border-dashed hover:border-cyan-500 hover:text-cyan-400 transition-colors"
                        style={{ ...BORDER_S, color: "var(--text-secondary)" }}>
                        ＋ この目的に目標を追加
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <div className="border-t" style={BORDER_S} />

        {/* ⑤ ナレッジリンク */}
        <button type="button" onClick={() => setKnowledgeOpen(true)}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1.5">
          📚 ナレッジを管理する →
        </button>
      </div>

      {/* ロジックモデル（編集モードでも表示） */}
      <LogicSection />

      <KnowledgePanel projectId={project.id} open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
    </div>
  );
}
