"use client";

// 施策構築（EBPM）の対話パネル — E2
//
// 課題仮説（真因）を起点に、アプローチの導出 → エビデンス探索を対話で進める。
// 現状整理・課題仮説・改善提案と同じ作法:
//   回答ヒントの常時表示 / 対話履歴の保持 / AiThinkingIndicator / 工程スキップのサーバ側ガード
//
// E4 で全フェーズ（アプローチ → エビデンス → 実験設計 → 指標 → コスト → 完了）が動く。
// 書き出しでアウトカムKPIが kpis テーブルに実体化され、
// 短期→中間の寄与連鎖・スコアボード・整合検査がそのまま効く。

import { useEffect, useRef, useState } from "react";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import {
  EVIDENCE_LEVELS,
  EVIDENCE_STATUS_META,
  EXPERIMENT_DESIGN_META,
  MEASURE_STEP_HINT,
  MEASURE_STEP_LABEL,
  MEASURE_STEP_ORDER,
  type ApproachCost,
  type ApproachEvidence,
  type ApproachExperiment,
  type ApproachIndicators,
  type ApproachItem,
  type MeasureMessage,
  type MeasureStep,
} from "@/lib/measure/types";

interface DialogueListItem {
  id: string;
  issue_hypothesis_id: string | null;
  title: string;
  status: "in_progress" | "completed";
  current_step: MeasureStep;
  messages: MeasureMessage[];
  approaches: ApproachItem[];
  evidence: ApproachEvidence[];
  experiments: ApproachExperiment[];
  indicators: ApproachIndicators[];
  costs: ApproachCost[];
  committed_at: string | null;
  hypothesis_title: string | null;
}

interface HypOption {
  id: string;
  title: string;
  root_cause: string | null;
}

interface Props {
  projectId: string;
  hypotheses: HypOption[];
  /** 書き出し後に施策一覧を更新してもらう */
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

// 全工程が実装済み（E4）
const IMPLEMENTED: MeasureStep[] = MEASURE_STEP_ORDER.slice();

function StepProgress({ step }: { step: MeasureStep }) {
  const idx = MEASURE_STEP_ORDER.indexOf(step);
  return (
    <ol className="space-y-1.5">
      {MEASURE_STEP_ORDER.filter((s) => s !== "done").map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const future = !IMPLEMENTED.includes(s) && !done;
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
                {MEASURE_STEP_LABEL[s]}
                {active && <span className="ml-1 text-[10px] font-normal">← 現在</span>}
                {future && !active && (
                  <span className="ml-1 text-[10px] font-normal text-slate-600">（次段で追加）</span>
                )}
              </span>
              {active && (
                <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">
                  {MEASURE_STEP_HINT[s]}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ApproachCard({
  a,
  ev,
  exp,
  ind,
  cost,
}: {
  a: ApproachItem;
  ev: ApproachEvidence | null;
  exp: ApproachExperiment | null;
  ind: ApproachIndicators | null;
  cost: ApproachCost | null;
}) {
  const meta = ev ? EVIDENCE_STATUS_META[ev.status] : null;
  const best =
    ev && ev.items.length > 0 ? Math.max(...ev.items.map((i) => i.evidence_level)) : null;
  const expMeta = exp ? EXPERIMENT_DESIGN_META[exp.design] : null;
  const needsExperiment = ev != null && ev.status !== "sufficient";
  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start gap-2 flex-wrap mb-1">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ background: "#6366f120", color: "#818cf8" }}
        >
          {a.id}
        </span>
        <span className="text-xs font-semibold text-slate-100 leading-snug flex-1 min-w-0">
          {a.measure_title}
        </span>
        {a.measure_design_id && (
          <span className="text-[10px] shrink-0" style={{ color: "#10b981" }}>
            書出済
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{a.approach}</p>
      {a.target && <p className="text-[10px] text-slate-500 mt-1">対象: {a.target}</p>}
      {meta && (
        <p className="text-[10px] mt-1.5" style={{ color: meta.color }}>
          {meta.label}
          {best != null && (
            <span style={{ color: EVIDENCE_LEVELS[best as 1 | 2 | 3 | 4 | 5].color }}>
              {" "}
              ・最高 Lv{best}
            </span>
          )}
          {ev && ev.items.length > 0 && (
            <span className="text-slate-500">（{ev.items.length}件）</span>
          )}
        </p>
      )}
      {expMeta && exp && (
        <p className="text-[10px] mt-1" style={{ color: "#818cf8" }}>
          🔬 {expMeta.label}
          <span className="text-slate-500">（得られるLv{expMeta.level}）</span>
        </p>
      )}
      {needsExperiment && !exp && (
        <p className="text-[10px] mt-1" style={{ color: "#f59e0b" }}>
          ⚠ 実験設計が必要（エビデンス不足）
        </p>
      )}
      {ind && (
        <p className="text-[10px] mt-1 text-slate-500">
          指標: 構造{ind.structure.length}・過程{ind.process.length}・
          <span style={{ color: "#9ae6c8" }}>短期KPI{ind.outcome_initial.length}</span>・
          <span style={{ color: "#4cc59d" }}>中間KPI{ind.outcome_intermediate.length}</span>
        </p>
      )}
      {cost && (
        <p className="text-[10px] mt-0.5 text-slate-500">
          💴 {cost.total_budget != null ? `¥${cost.total_budget.toLocaleString("ja-JP")}` : "総額未定"}
          {cost.cost_per_outcome_note ? "・算定式あり" : ""}
        </p>
      )}
    </div>
  );
}

export default function MeasureDialoguePanel({ projectId, hypotheses, onCommitted }: Props) {
  const [list, setList] = useState<DialogueListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [input, setInput] = useState("");
  const [newHypId, setNewHypId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selected = list.find((d) => d.id === selectedId) ?? null;

  const load = async () => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-dialogue`);
      const json = (await res.json()) as { data: DialogueListItem[] | null; error: string | null };
      if (res.ok && json.data) {
        setList(json.data);
        if (json.data.length > 0 && !selectedId) setSelectedId(json.data[0]?.id ?? null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [selected?.messages.length, sending]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_hypothesis_id: newHypId || null }),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "作成に失敗しました");
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

    const optimistic: MeasureMessage = {
      role: "user",
      content: text,
      step: selected.current_step,
    };
    setList((prev) =>
      prev.map((d) => (d.id === selected.id ? { ...d, messages: [...d.messages, optimistic] } : d)),
    );

    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/measure-dialogue/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );
      const json = (await res.json()) as {
        data: {
          current_step: MeasureStep;
          status: "in_progress" | "completed";
          approaches: ApproachItem[];
          evidence: ApproachEvidence[];
          experiments: ApproachExperiment[];
          indicators: ApproachIndicators[];
          costs: ApproachCost[];
          messages: MeasureMessage[];
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
            ? {
                ...d,
                messages: r.messages,
                approaches: r.approaches,
                evidence: r.evidence,
                experiments: r.experiments,
                indicators: r.indicators,
                costs: r.costs,
                current_step: r.current_step,
                status: r.status,
              }
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
        `/api/admin/projects/${projectId}/measure-dialogue/${selected.id}/commit`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        data: { created: number; updated: number } | null;
        error: string | null;
      };
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
        <AiThinkingIndicator label="対話を読み込んでいます" />
      </div>
    );
  }

  const lastAssistant = selected
    ? [...selected.messages].reverse().find((m) => m.role === "assistant")
    : undefined;
  const suggestions = lastAssistant?.suggestions ?? [];
  const done = selected != null && selected.current_step === "done";
  const canCommit = selected != null && selected.approaches.length > 0;

  return (
    <div className="space-y-4">
      {/* 開始 */}
      <div className="rounded-2xl border p-5" style={cardStyle}>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">AIと施策を構築する</h3>
        <p className="text-xs text-slate-500 mb-3 leading-relaxed">
          課題仮説（真因）を起点に、アプローチ → エビデンス（ナレッジ → Web）→
          実験設計（不足時）→ 指標（SPO三層とKPI）→ コスト（効率性の算定式）まで、
          施策データセットの全区画を対話で埋めます。
        </p>
        <div className="flex gap-2 flex-wrap items-end">
          <div style={{ minWidth: 260, flex: 1 }}>
            <label className="text-xs text-slate-400 mb-1 block">起点にする課題仮説</label>
            <select
              value={newHypId}
              onChange={(e) => setNewHypId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">（選択しない — 対話の中で真因を確認します）</option>
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                  {h.root_cause ? ` — 真因: ${h.root_cause.slice(0, 40)}` : ""}
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
            {creating ? "準備中..." : "構築を始める"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
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
              <h4 className="text-xs font-semibold text-slate-400 mb-2 px-1">構築の一覧</h4>
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
                          d.current_step === "done"
                            ? { background: "#10b98120", color: "#10b981" }
                            : { background: "#f59e0b20", color: "#f59e0b" }
                        }
                      >
                        {d.current_step === "done"
                          ? "完了"
                          : MEASURE_STEP_LABEL[d.current_step]}
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
                <h4 className="text-xs font-semibold text-slate-400 mb-3">構築の進捗</h4>
                <StepProgress step={selected.current_step} />
                {selected.approaches.length > 0 && (
                  <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <p className="text-[11px] font-semibold text-slate-400 mb-2">
                      アプローチ {selected.approaches.length}件
                    </p>
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {selected.approaches.map((a) => (
                        <ApproachCard
                          key={a.id}
                          a={a}
                          ev={selected.evidence.find((e) => e.approach_id === a.id) ?? null}
                          exp={selected.experiments.find((e) => e.approach_id === a.id) ?? null}
                          ind={selected.indicators.find((e) => e.approach_id === a.id) ?? null}
                          cost={selected.costs.find((e) => e.approach_id === a.id) ?? null}
                        />
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
              <div className="rounded-xl border flex flex-col" style={{ ...cardStyle, height: 620 }}>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selected.messages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
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
                        sub="真因・ナレッジ・Webのエビデンス・実験設計のはしごを参照しています"
                      />
                    </div>
                  )}
                </div>

                <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
                  {done && (
                    <div
                      className="rounded-lg px-3 py-2 text-xs leading-relaxed"
                      style={{
                        background: "#10b98112",
                        color: "#6ee7b7",
                        border: "1px solid #10b98130",
                      }}
                    >
                      ✅ 施策データセットの構築が完了しました。
                      書き出すと、アウトカムKPIが実体として登録され（短期→中間の寄与も設定）、
                      一覧タブから内容を確認して確定できます。
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {canCommit && (
                      <button
                        type="button"
                        onClick={() => void commit()}
                        disabled={committing}
                        className="text-xs px-4 py-2 rounded-lg font-medium disabled:opacity-50"
                        style={{
                          background: "#10b98118",
                          color: "#10b981",
                          border: "1px solid #10b98140",
                        }}
                      >
                        {committing
                          ? "書き出し中..."
                          : selected.committed_at
                            ? "施策データセットを更新"
                            : "施策データセットとして書き出す"}
                      </button>
                    )}
                    {selected.committed_at && (
                      <span className="text-[10px] text-slate-500">
                        確定済みの施策は上書きされません
                      </span>
                    )}
                  </div>

                  {suggestions.length > 0 && !sending && !done && (
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
                    現在: {MEASURE_STEP_LABEL[selected.current_step]}｜
                    {MEASURE_STEP_HINT[selected.current_step]}
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
                      placeholder={
                        done
                          ? "追加の相談があれば入力できます（内容の修正など）"
                          : "回答を入力（Enterで送信 / Shift+Enterで改行）"
                      }
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
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
