"use client";

// 対話型AI改善提案
//
// 評価結果・図6/図7の判定経路・真因・自己評価を読んだうえで、
// 改善策を対話で組み立てる。現状整理・課題仮説と同じ方式。

import { useEffect, useRef, useState } from "react";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import {
  IMPROVEMENT_STEP_HINT,
  IMPROVEMENT_STEP_LABEL,
  IMPROVEMENT_STEP_ORDER,
  type ImprovementStep,
} from "@/lib/improvement/prompt";
import { REFLECT_META } from "@/lib/improvement/types";
import type {
  ImprovementDialogue,
  ImprovementMessage,
  ImprovementProposal,
} from "@/lib/improvement/types";

interface EvalOption {
  id: string;
  label: string;
}

interface Props {
  projectId: string;
  evaluations: EvalOption[];
  onCommitted: () => void;
}

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

function StepProgress({ step }: { step: string }) {
  const idx = IMPROVEMENT_STEP_ORDER.indexOf(step as ImprovementStep);
  return (
    <ol className="space-y-1.5">
      {IMPROVEMENT_STEP_ORDER.filter((s) => s !== "done").map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const color = done ? "#10b981" : active ? "#818cf8" : "#64748b";
        return (
          <li key={s} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                width: 18,
                height: 18,
                marginTop: 1,
                background: done || active ? `${color}25` : "transparent",
                color,
                border: `1.5px solid ${color}`,
              }}
            >
              {done ? "✓" : i + 1}
            </span>
            <span>
              <span
                className="text-[11px] font-semibold"
                style={{ color: active ? "#c7d2fe" : done ? "#10b981" : "#94a3b8" }}
              >
                {IMPROVEMENT_STEP_LABEL[s]}
                {active && <span className="ml-1 text-[10px] font-normal">← 現在</span>}
              </span>
              {active && (
                <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">
                  {IMPROVEMENT_STEP_HINT[s]}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ProposalCard({ p }: { p: ImprovementProposal }) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start gap-2 flex-wrap mb-1">
        {p.priority != null && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "#6366f120", color: "#818cf8" }}
          >
            #{p.priority}
          </span>
        )}
        <span className="text-xs font-semibold text-slate-100 leading-snug">{p.title}</span>
        {p.carry_over && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "#818cf818", color: "#818cf8" }}
          >
            次期へ
          </span>
        )}
      </div>
      {p.detail && (
        <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap">{p.detail}</p>
      )}
      {p.expected_effect && (
        <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
          <span className="text-slate-500">見込む効果: </span>
          {p.expected_effect}
        </p>
      )}
      <p className="text-[10px] text-slate-500 mt-1.5">
        {p.reflect_target ? `反映先: ${REFLECT_META[p.reflect_target].label}` : "反映先未定"}
        {p.owner_department ? ` ／ ${p.owner_department}` : ""}
        {p.due_hint ? ` ／ ${p.due_hint}` : ""}
      </p>
      {p.evidence.length > 0 && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
            根拠 {p.evidence.length}件
          </summary>
          <ul className="mt-1 space-y-0.5">
            {p.evidence.map((e, i) => (
              <li key={i} className="text-[10px] text-slate-400 leading-snug">
                ・{e}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ImprovementDialoguePanel({
  projectId,
  evaluations,
  onCommitted,
}: Props) {
  const [list, setList] = useState<ImprovementDialogue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newEvalId, setNewEvalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selected = list.find((d) => d.id === selectedId) ?? null;

  const load = async () => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/improvement-dialogue`);
      const json = (await res.json()) as { data: ImprovementDialogue[] | null };
      const rows = json.data ?? [];
      setList(rows);
      setSelectedId((prev) => prev ?? rows.find((r) => r.status === "in_progress")?.id ?? rows[0]?.id ?? null);
    } catch {
      setError("読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [selected?.messages.length, selectedId]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/improvement-dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_evaluation_id: newEvalId || null }),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "開始に失敗しました");
        return;
      }
      await load();
      setSelectedId(json.data.id);
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    if (!selected || !input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    const optimistic: ImprovementMessage = { role: "user", content: text, step: selected.current_step };
    setList((prev) =>
      prev.map((d) => (d.id === selected.id ? { ...d, messages: [...d.messages, optimistic] } : d)),
    );

    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/improvement-dialogue/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );
      const json = (await res.json()) as {
        data: {
          current_step: string;
          status: "in_progress" | "completed";
          proposals: ImprovementProposal[];
          messages: ImprovementMessage[];
        } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "送信に失敗しました");
        setList((prev) =>
          prev.map((d) =>
            d.id === selected.id
              ? { ...d, messages: d.messages.filter((m) => m !== optimistic) }
              : d,
          ),
        );
        setInput(text);
        return;
      }
      const r = json.data;
      setList((prev) =>
        prev.map((d) =>
          d.id === selected.id
            ? { ...d, messages: r.messages, proposals: r.proposals, current_step: r.current_step, status: r.status }
            : d,
        ),
      );
    } catch {
      setError("通信エラーが発生しました");
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const commit = async () => {
    if (!selected || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/improvement-dialogue/${selected.id}/commit`,
        { method: "POST" },
      );
      const json = (await res.json()) as { data: { created: number } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "書き出しに失敗しました");
        return;
      }
      await load();
      onCommitted();
    } finally {
      setCommitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border p-8 flex justify-center" style={cardStyle}>
        <AiThinkingIndicator label="改善提案を読み込んでいます" />
      </div>
    );
  }

  const lastAssistant = selected
    ? [...selected.messages].reverse().find((m) => m.role === "assistant")
    : undefined;
  const suggestions = lastAssistant?.suggestions ?? [];

  return (
    <div className="space-y-4">
      {/* 開始 */}
      <div className="rounded-2xl border p-5" style={cardStyle}>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">
          評価結果にもとづく改善策の検討
        </h3>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          評価の到達度・図6／図7の判断経路・課題仮説の真因・自己評価を読み込んだうえで、改善策を対話で組み立てます。
        </p>
        <div className="flex gap-2 flex-wrap items-end">
          <div style={{ minWidth: 260, flex: 1 }}>
            <label className="text-xs text-slate-400 mb-1 block">起点にする評価（任意）</label>
            <select
              value={newEvalId}
              onChange={(e) => setNewEvalId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">プロジェクト全体（直近5件の評価を参照）</option>
              {evaluations.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {creating ? "準備中..." : "検討を始める"}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {list.length > 0 && (
        <div className="flex gap-4 flex-wrap lg:flex-nowrap">
          {/* 左: 一覧と進捗 */}
          <div className="flex flex-col gap-4" style={{ width: 300, flexShrink: 0 }}>
            <div className="rounded-xl border p-3" style={cardStyle}>
              <h4 className="text-xs font-semibold text-slate-400 mb-2 px-1">検討一覧</h4>
              <div className="space-y-1.5">
                {list.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className="w-full text-left rounded-lg px-3 py-2 transition-colors"
                    style={
                      selectedId === d.id
                        ? { background: "#6366f120", border: "1px solid #6366f140" }
                        : { background: "var(--bg-primary)", border: "1px solid var(--border)" }
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-200 truncate">{d.title}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                        style={
                          d.status === "completed"
                            ? { background: "#10b98120", color: "#10b981" }
                            : { background: "#f59e0b20", color: "#f59e0b" }
                        }
                      >
                        {d.status === "completed"
                          ? "完了"
                          : IMPROVEMENT_STEP_LABEL[d.current_step as ImprovementStep] ?? d.current_step}
                      </span>
                    </div>
                    {d.committed_at && (
                      <span className="text-[10px] text-slate-500">書き出し済み</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {selected && (
              <div className="rounded-xl border p-4" style={cardStyle}>
                <h4 className="text-xs font-semibold text-slate-400 mb-3">検討の進捗</h4>
                <StepProgress step={selected.current_step} />
                {selected.proposals.length > 0 && (
                  <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <p className="text-[11px] font-semibold text-slate-400 mb-2">
                      改善案 {selected.proposals.length}件
                    </p>
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {selected.proposals.map((p) => (
                        <ProposalCard key={p.id} p={p} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 右: 対話 */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="rounded-xl border p-10 text-center" style={cardStyle}>
                <p className="text-sm text-slate-500">左の一覧から選択してください</p>
              </div>
            ) : (
              <div
                className="rounded-xl border flex flex-col"
                style={{ ...cardStyle, height: 620 }}
              >
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selected.messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed"
                        style={
                          m.role === "user"
                            ? { background: "#6366f1", color: "#fff" }
                            : {
                                background: "var(--bg-primary)",
                                color: "var(--text-primary)",
                                border: "1px solid var(--border)",
                              }
                        }
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="flex justify-start">
                      <AiThinkingIndicator
                        label="AIが考えています"
                        sub="評価結果・真因・ナレッジ・Webを参照しています"
                      />
                    </div>
                  )}
                </div>

                <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
                  {selected.status === "completed" ? (
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-xs text-emerald-400 font-medium">
                        ✅ 改善策の検討が完了しました（{selected.proposals.length}件）
                      </p>
                      <button
                        type="button"
                        onClick={() => void commit()}
                        disabled={committing}
                        className="text-xs px-4 py-2 rounded-lg font-medium disabled:opacity-50"
                        style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
                      >
                        {committing
                          ? "書き出し中..."
                          : selected.committed_at
                            ? "改善アクションを更新"
                            : "改善アクションとして起票"}
                      </button>
                    </div>
                  ) : (
                    <>
                      {suggestions.length > 0 && !sending && (
                        <div>
                          <p className="text-[11px] font-semibold mb-1.5" style={{ color: "#818cf8" }}>
                            💡 回答のヒント — クリックすると入力欄に追加されます
                          </p>
                          <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                            {suggestions.map((s, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setInput((p) => (p ? `${p}\n${s}` : s))}
                                className="text-left text-xs leading-snug px-3 py-2 rounded-lg hover:brightness-125"
                                style={{
                                  background: "rgba(99,102,241,0.10)",
                                  color: "#c7d2fe",
                                  border: "1px solid rgba(99,102,241,0.35)",
                                }}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        現在: {IMPROVEMENT_STEP_LABEL[selected.current_step as ImprovementStep] ?? selected.current_step}
                        ｜{IMPROVEMENT_STEP_HINT[selected.current_step as ImprovementStep] ?? ""}
                      </p>
                      <div className="flex gap-2">
                        <textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void send();
                            }
                          }}
                          rows={2}
                          placeholder="回答を入力（Enterで送信 / Shift+Enterで改行）"
                          className={inputClass}
                          style={{ ...inputStyle, resize: "none" }}
                          disabled={sending}
                        />
                        <button
                          type="button"
                          onClick={() => void send()}
                          disabled={!input.trim() || sending}
                          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 shrink-0"
                          style={{ background: "#6366f1" }}
                        >
                          送信
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
