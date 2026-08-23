"use client";

// 改善アクション管理
//
// 評価・自己評価・AI提案から生まれた改善を、状態と反映先を持つオブジェクトとして
// 追跡する。「改善が次に還る回路」の中核で、ここで反映先を指定することで
// タスク・KPI・ロジックモデル・課題仮説のどれに効かせたかが記録される。

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PermissionGate from "@/components/PermissionGate";
import ImprovementDialoguePanel from "@/components/improvement/ImprovementDialoguePanel";
import HandoverPanel from "@/components/improvement/HandoverPanel";
import {
  REFLECT_META,
  REFLECT_ORDER,
  SOURCE_META,
  STATUS_META,
  isOverdue,
  nextStatus,
  reflectTargetsOf,
  type ImprovementAction,
  type ImprovementStatus,
  type ReflectTarget,
} from "@/lib/improvement/types";

export interface ReflectOption {
  id: string;
  label: string;
}

interface Props {
  project: { id: string; title: string };
  projectId: string;
  initialActions: ImprovementAction[];
  reflectOptions: Record<ReflectTarget, ReflectOption[]>;
  evaluations: ReflectOption[];
  otherProjects: { id: string; title: string }[];
}

type PanelTab = "list" | "dialogue" | "handover";

const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: "list", label: "改善アクション一覧" },
  { key: "dialogue", label: "🤖 AI改善提案（対話）" },
  { key: "handover", label: "📦 次期計画への引き継ぎ" },
];

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  borderColor: "var(--border)",
};
const cardStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  borderColor: "var(--border)",
};

const FILTERS: { key: "open" | "all" | ImprovementStatus; label: string }[] = [
  { key: "open", label: "未完了" },
  { key: "all", label: "すべて" },
  { key: "proposed", label: "起票" },
  { key: "adopted", label: "採用" },
  { key: "in_progress", label: "実施中" },
  { key: "done", label: "反映済" },
  { key: "dropped", label: "見送り" },
];

export default function ImprovementActionsClient({
  project,
  projectId,
  initialActions,
  reflectOptions,
  evaluations,
  otherProjects,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<PanelTab>("list");
  const [actions, setActions] = useState(initialActions);
  const [filter, setFilter] = useState<"open" | "all" | ImprovementStatus>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  // ロジックモデルの改訂起票（L5）。どの改善から起こすかと、その理由
  const [reviseFor, setReviseFor] = useState<ImprovementAction | null>(null);
  const [reviseReason, setReviseReason] = useState("");
  const [revising, setRevising] = useState(false);
  const [reviseDone, setReviseDone] = useState<{ actionId: string; version: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "",
    detail: "",
    owner_department: "",
    due_date: "",
  });

  const visible = useMemo(() => {
    if (filter === "all") return actions;
    if (filter === "open") {
      return actions.filter((a) => a.status !== "done" && a.status !== "dropped");
    }
    return actions.filter((a) => a.status === filter);
  }, [actions, filter]);

  const counts = useMemo(() => {
    const c = { open: 0, done: 0, overdue: 0, carry: 0 };
    for (const a of actions) {
      if (a.status === "done") c.done++;
      else if (a.status !== "dropped") c.open++;
      if (isOverdue(a)) c.overdue++;
      if (a.carry_over) c.carry++;
    }
    return c;
  }, [actions]);

  /**
   * ロジックモデルの改訂版を起こす（L5）。
   *
   * 「反映先: ロジックモデルの改訂」は、これまで既存の版を指すだけだった。
   * 「因果仮説を書き換える」と決めても書き換える先が無く、
   * 担当者は現行版を直接上書きするしかなかったため、
   * 改善の前後で計画がどう変わったのかが残らなかった。
   * ここで新しい版を起こし、その版に改善アクションを結び付ける。
   */
  const submitRevise = async () => {
    if (!reviseFor || reviseReason.trim() === "") return;
    setRevising(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/logic-model/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          improvement_action_id: reviseFor.id,
          reason: reviseReason.trim(),
        }),
      });
      const json = (await res.json()) as {
        data: { id: string; version: number } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "改訂の作成に失敗しました");
        return;
      }
      setActions((prev) =>
        prev.map((a) =>
          a.id === reviseFor.id
            ? ({
                ...a,
                reflect_logic_model_id: json.data!.id,
                reflected_at: new Date().toISOString(),
              } as ImprovementAction)
            : a,
        ),
      );
      setReviseDone({ actionId: reviseFor.id, version: json.data.version });
      setReviseFor(null);
      setReviseReason("");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setRevising(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/improvement-actions/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { data: Partial<ImprovementAction> | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      setActions((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...json.data } as ImprovementAction : a)),
      );
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!form.title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/improvement-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          title: form.title,
          detail: form.detail || null,
          owner_department: form.owner_department || null,
          due_date: form.due_date || null,
        }),
      });
      const json = (await res.json()) as { data: ImprovementAction | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "起票に失敗しました");
        return;
      }
      setActions((prev) => [json.data!, ...prev]);
      setForm({ title: "", detail: "", owner_department: "", due_date: "" });
      setShowNew(false);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("この改善アクションを削除しますか？")) return;
    const res = await fetch(
      `/api/admin/projects/${projectId}/improvement-actions/${id}`,
      { method: "DELETE" },
    );
    if (res.ok) setActions((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{project.title}</p>
          <h2 className="text-2xl font-bold text-slate-100 mt-1">改善アクション</h2>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            評価から生まれた改善を、反映先（タスク・KPI・ロジックモデル・課題仮説）まで追跡します。
          </p>
        </div>
        <PermissionGate module="self_evaluation" level="edit" projectId={projectId}>
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="shrink-0 text-sm font-medium px-4 py-2 rounded-xl text-white"
            style={{ background: "#6366f1" }}
          >
            ＋ 改善を起票
          </button>
        </PermissionGate>
      </div>

      {/* タブ */}
      <div className="flex gap-1 border-b mb-6 flex-wrap" style={{ borderColor: "var(--border)" }}>
        {PANEL_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
            style={{
              borderBottomColor: tab === t.key ? "#b45309" : "transparent",
              color: tab === t.key ? "#f59e0b" : "#64748b",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dialogue" && (
        <ImprovementDialoguePanel
          projectId={projectId}
          evaluations={evaluations}
          onCommitted={() => router.refresh()}
        />
      )}

      {tab === "handover" && (
        <HandoverPanel projectId={projectId} otherProjects={otherProjects} />
      )}

      {tab === "list" && (
      <>
      {/* サマリー */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}
      >
        {[
          { label: "未完了", value: counts.open, color: "#f59e0b" },
          { label: "反映済", value: counts.done, color: "#10b981" },
          { label: "期限超過", value: counts.overdue, color: "#ef4444" },
          { label: "次期へ引継", value: counts.carry, color: "#818cf8" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border p-4" style={cardStyle}>
            <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>
              {s.value}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {showNew && (
        <div className="rounded-2xl border p-5 mb-6 space-y-3" style={cardStyle}>
          <h3 className="text-sm font-semibold text-slate-200">改善アクションを起票</h3>
          <input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className={inputClass}
            style={inputStyle}
            placeholder="改善の見出し（例: 通いの場の立ち上げ支援を上半期に前倒しする）"
          />
          <textarea
            value={form.detail}
            onChange={(e) => setForm((p) => ({ ...p, detail: e.target.value }))}
            className={inputClass}
            style={inputStyle}
            rows={2}
            placeholder="具体的な内容"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={form.owner_department}
              onChange={(e) => setForm((p) => ({ ...p, owner_department: e.target.value }))}
              className={inputClass}
              style={inputStyle}
              placeholder="担当課"
            />
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating || !form.title.trim()}
              className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-50"
              style={{ background: "#6366f1" }}
            >
              {creating ? "起票中..." : "起票する"}
            </button>
            <button
              type="button"
              onClick={() => setShowNew(false)}
              className="text-sm px-4 py-2 rounded-xl"
              style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          className="rounded-lg border px-4 py-2 text-sm mb-4"
          style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {/* フィルタ */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={
              filter === f.key
                ? { background: "#6366f1", color: "#fff" }
                : { background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed p-10 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm text-slate-500 mb-1">改善アクションがありません</p>
          <p className="text-xs text-slate-600 leading-relaxed">
            プログラム評価の一覧から「改善を起票」で、評価結果を改善アクションに変換できます。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => {
            const st = STATUS_META[a.status];
            const src = SOURCE_META[a.source];
            const next = nextStatus(a.status);
            const targets = reflectTargetsOf(a);
            const overdue = isOverdue(a);
            return (
              <div key={a.id} className="rounded-2xl border p-5" style={cardStyle}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `${st.color}20`, color: st.color, border: `1px solid ${st.color}55` }}
                      >
                        {st.label}
                      </span>
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: `${src.color}18`, color: src.color }}
                      >
                        {src.label}
                      </span>
                      {a.carry_over && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full"
                          style={{ background: "#818cf818", color: "#818cf8" }}
                        >
                          次期へ引継
                        </span>
                      )}
                      {overdue && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                          style={{ background: "#ef444418", color: "#ef4444" }}
                        >
                          期限超過
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 leading-snug">{a.title}</h3>
                    {a.detail && (
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap">
                        {a.detail}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      {a.owner_department ?? "担当未設定"}
                      {a.due_date ? ` ／ 期限 ${a.due_date}` : ""}
                      {a.reflected_at ? ` ／ 反映 ${a.reflected_at.slice(0, 10)}` : ""}
                    </p>
                  </div>

                  <PermissionGate module="self_evaluation" level="edit" projectId={projectId}>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {next && (
                        <button
                          type="button"
                          onClick={() => void patch(a.id, { status: next })}
                          disabled={busy === a.id}
                          className="text-[11px] px-3 py-1.5 rounded-lg font-medium whitespace-nowrap disabled:opacity-50"
                          style={{
                            background: `${STATUS_META[next].color}18`,
                            color: STATUS_META[next].color,
                            border: `1px solid ${STATUS_META[next].color}40`,
                          }}
                        >
                          {STATUS_META[next].label}にする
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void patch(a.id, { carry_over: !a.carry_over })}
                        disabled={busy === a.id}
                        className="text-[11px] px-3 py-1.5 rounded-lg whitespace-nowrap disabled:opacity-50"
                        style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
                      >
                        {a.carry_over ? "引継を外す" : "次期へ引継ぐ"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(a.id)}
                        className="text-[11px] px-3 py-1.5 rounded-lg whitespace-nowrap"
                        style={{ background: "#ef444412", color: "#ef4444", border: "1px solid #ef444430" }}
                      >
                        削除
                      </button>
                    </div>
                  </PermissionGate>
                </div>

                {/* 反映先 */}
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <p className="text-[10px] font-semibold text-slate-500 mb-2">
                    反映先
                    {targets.length === 0 && (
                      <span className="font-normal text-slate-600">
                        {" "}
                        — 未設定。どこに効かせるかを決めると、改善が計画に還ります
                      </span>
                    )}
                  </p>
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}
                  >
                    {REFLECT_ORDER.map((t) => {
                      const meta = REFLECT_META[t];
                      const opts = reflectOptions[t] ?? [];
                      const current = (a as unknown as Record<string, string | null>)[meta.column] ?? "";
                      return (
                        <div key={t}>
                          <label className="text-[10px] text-slate-500 block mb-0.5" title={meta.desc}>
                            {meta.label}
                          </label>
                          <select
                            value={current}
                            disabled={busy === a.id}
                            onChange={(e) =>
                              void patch(a.id, { [meta.column]: e.target.value || null })
                            }
                            className="w-full rounded-lg border px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                            style={inputStyle}
                          >
                            <option value="">（なし）</option>
                            {opts.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>

                  {/* ロジックモデルの改訂起票（L5）。
                      選ぶだけでなく「新しい版を起こす」ための入口。 */}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setReviseFor(a);
                        setReviseReason(a.root_cause ?? a.title ?? "");
                        setReviseDone(null);
                      }}
                      disabled={busy === a.id}
                      className="text-[11px] px-2 py-1 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ color: "#818cf8", border: "1px solid #6366f140" }}
                      title="現行のロジックモデルを複製して、この改善を理由とする新しい版を起こします"
                    >
                      ＋ ロジックモデルの改訂版を起こす
                    </button>
                    {reviseDone?.actionId === a.id && (
                      <span className="text-[11px]" style={{ color: "#10b981" }}>
                        ✓ 第{reviseDone.version}版として起票しました
                      </span>
                    )}
                    {a.reflect_logic_model_id && a.reflected_at && (
                      <span className="text-[11px] text-slate-500">
                        反映済 {new Date(a.reflected_at).toLocaleDateString("ja-JP")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 改訂の理由を入力するダイアログ。
          理由を必須にするのは、版だけ増えて何のための改訂か分からない状態を作らないため。 */}
      {reviseFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#00000090" }}
          onClick={() => !revising && setReviseFor(null)}
        >
          <div
            className="rounded-2xl border w-full max-w-lg p-6 space-y-4"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                ロジックモデルの改訂版を起こす
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                現行のロジックモデルを複製して、新しい版を作ります。
                <strong className="text-slate-400">現行版は上書きされません。</strong>
                過去の評価が前提にしていた版はそのまま残るので、
                「あの評価は改訂前の計画を見ていた」と後から説明できます。
              </p>
            </div>

            <div
              className="rounded-lg px-3 py-2 text-xs text-slate-400"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              起点となる改善: <span className="text-slate-200">{reviseFor.title}</span>
              {reviseFor.root_cause && (
                <span className="block mt-1 text-slate-500">真因: {reviseFor.root_cause}</span>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                改訂の理由（必須）
              </label>
              <textarea
                value={reviseReason}
                onChange={(e) => setReviseReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="何をどう書き換えるのか。例: 参加勧奨が届いていなかったため、活動に個別勧奨を追加する"
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
                style={inputStyle}
              />
              <p className="text-[11px] text-slate-600 mt-1">
                この理由は版の履歴に残り、差分画面に表示されます。
              </p>
            </div>

            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setReviseFor(null)}
                disabled={revising}
                className="text-xs px-3 py-1.5 rounded-lg text-slate-400 disabled:opacity-40"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={() => void submitRevise()}
                disabled={revising || reviseReason.trim() === ""}
                className="text-xs font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-40"
                style={{ background: "#6366f1" }}
              >
                {revising ? "作成中..." : "改訂版を起こす"}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-600 mt-6 leading-relaxed">
        改善アクションは、プログラム評価（図6・図7フロー）や自己評価シートからも起票できます。
        「次期へ引継ぐ」を付けたものは、計画期間評価の引き継ぎパッケージに含まれます。
      </p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="text-[11px] text-slate-500 hover:text-slate-300 mt-2"
      >
        最新の状態に更新
      </button>
      </>
      )}
    </div>
  );
}
