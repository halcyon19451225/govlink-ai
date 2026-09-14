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
import Link from "next/link";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import { proposalBlockers, type ProposalRow } from "@/lib/dialogue/types";
import {
  isAcceptedTurn,
  requestTurnStep,
  isTurnProcessing,
  waitForTurn,
  type TurnStatus,
} from "@/lib/ai/turnClient";
import {
  EVIDENCE_LEVELS,
  EVIDENCE_STATUS_META,
  EXPERIMENT_DESIGN_META,
  MEASURE_STEP_HINT,
  MEASURE_STEP_LABEL,
  MEASURE_STEP_ORDER,
  activeApproaches,
  duplicateApproachTitles,
  measureCommitGaps,
  describeMeasureGaps,
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
  /** AIターンの状態（migration 055・非同期化）。processing の間はポーリングで待つ */
  turn_status?: TurnStatus | null;
  turn_error?: string | null;
  committed_at: string | null;
  hypothesis_title: string | null;
  /** D6: 承認した箱にデータが上がるのを待っているか（待機はブロックではない） */
  data_state?: "none" | "waiting_for_data" | null;
  /** D6: 未決の提案の件数（一覧のバッジ用） */
  pending_proposals?: number | null;
  /** D6: 提案（承認カード）。単体 GET のときだけ入る */
  proposals?: ProposalRow[];
}

interface HypOption {
  id: string;
  title: string;
  root_cause: string | null;
  /** どの指標の課題仮説か。計画横断で並ぶので、これが無いと選び分けられない */
  kpi_label?: string | null;
  /** 対話ごとの優先順位（選別スコアの降順） */
  priority_rank?: number | null;
}

/** 長い文はぶつ切りにせず省略記号を付ける */
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
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
        <span
          className="text-xs font-semibold leading-snug flex-1 min-w-0"
          style={
            a.retired
              ? { color: "#64748b", textDecoration: "line-through" }
              : { color: "#f1f5f9" }
          }
        >
          {a.measure_title}
        </span>
        {a.retired && (
          <span
            className="text-[10px] shrink-0 px-1.5 rounded"
            style={{ background: "#64748b20", color: "#94a3b8" }}
            title={a.retired_reason || "取り下げ済み"}
          >
            取り下げ
          </span>
        )}
        {a.measure_design_id && !a.retired && (
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

/**
 * D6: 提案カード（設計 §10-3）。
 * **承認するまで何も作られない。**何が作られて何が作られないかを、押す前に書く。
 */
function ProposalCard({
  projectId,
  p,
  busy,
  onApprove,
  onDecline,
}: {
  projectId: string;
  p: ProposalRow;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const payload = p.payload;
  const isDataset = payload.kind === "dataset";
  const name = payload.kind === "dataset" ? payload.name : payload.label;
  const blockers = proposalBlockers(payload);
  const decided = p.status !== "pending";

  return (
    <div
      className="rounded-xl border px-3 py-2.5"
      style={
        p.status === "pending"
          ? { borderColor: "#818cf860", background: "#6366f110" }
          : { borderColor: "var(--border)", background: "var(--bg-primary)" }
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-200">
            <span className="text-[10px] px-1.5 py-0.5 rounded mr-1.5" style={{ background: "#6366f125", color: "#c7d2fe" }}>
              {isDataset ? "データセット" : "指標"}
            </span>
            {name}
          </p>
          {payload.why && (
            <p className="text-[11px] text-slate-400 leading-snug mt-1">{payload.why}</p>
          )}
        </div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          style={
            p.status === "approved"
              ? { background: "#10b98120", color: "#10b981" }
              : p.status === "declined"
                ? { background: "#64748b25", color: "#94a3b8" }
                : { background: "#f59e0b20", color: "#f59e0b" }
          }
        >
          {p.status === "approved" ? "承認済み" : p.status === "declined" ? "見送り" : "承認待ち"}
        </span>
      </div>

      {/* 承認すると何が起きるか。押す前に書く（設計 §6 の画面上の掲載） */}
      {p.status === "pending" && (
        <div className="mt-2 rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
          <p className="text-[10px] text-slate-400 leading-snug">
            {payload.kind === "dataset" ? (
              <>
                承認すると<strong className="text-slate-300">空の箱（データセット）</strong>が作られます。
                データはまだ入りません — 作られた箱に
                {payload.asOfNeeded ? `${payload.asOfNeeded} 時点の` : ""}
                ファイルを上げると、指標が計算できるようになります。
                <br />
                列: {payload.columns.map((c) => `${c.name}(${c.role})`).join("・")}
              </>
            ) : (
              <>
                承認すると<strong className="text-slate-300">指標の定義</strong>が登録されます。
                値はまだ入りません — 元になるデータが揃うと計算されます。
                {payload.dependsOn && <>（{payload.dependsOn} のデータセットを使います）</>}
              </>
            )}
          </p>
        </div>
      )}

      {blockers.length > 0 && p.status === "pending" && (
        <p className="text-[10px] mt-1.5 leading-snug" style={{ color: "#fbbf24" }}>
          ⚠ このままでは登録できません: {blockers.join("・")}（AIに直してもらってください）
        </p>
      )}

      {p.status === "approved" && isDataset && p.awaiting_upload && (
        <p className="text-[10px] mt-1.5 leading-snug" style={{ color: "#f59e0b" }}>
          ⏳ データのアップロード待ちです。
          <Link href={`/projects/${projectId}/datasets`} className="ml-1 underline" style={{ color: "#818cf8" }}>
            データセット管理で上げる →
          </Link>
          <br />
          上げると、この対話に結果が届きます（対話はそのまま続けられます）。
        </p>
      )}
      {p.status === "approved" && !p.awaiting_upload && p.latest_as_of && (
        <p className="text-[10px] text-slate-500 mt-1.5">最新の版: {p.latest_as_of} 時点</p>
      )}
      {p.status === "declined" && p.decline_reason && (
        <p className="text-[10px] text-slate-500 mt-1.5">見送りの理由: {p.decline_reason}</p>
      )}

      {!decided && (
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || blockers.length > 0}
            className="text-[11px] px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
            style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
          >
            承認して登録
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={busy}
            className="text-[11px] px-3 py-1.5 rounded-lg text-slate-400 disabled:opacity-40"
            style={{ border: "1px solid var(--border)" }}
          >
            見送る
          </button>
        </div>
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
  const [decidingId, setDecidingId] = useState<string | null>(null);
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

  // D6: 選んだ対話の提案（承認カード）を読む。一覧の GET は件数しか返さない
  useEffect(() => {
    if (!selectedId) return;
    void reloadSelected(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /**
   * D6: その対話だけを読み直す（提案カードと待機の状態を最新にする）。
   * 単体 GET は proposals も返すので、承認の直後にこれを呼べばカードが更新される。
   */
  const reloadSelected = async (dialogueId: string) => {
    const res = await fetch(`/api/admin/projects/${projectId}/measure-dialogue/${dialogueId}`);
    const json = (await res.json()) as { data: DialogueListItem | null; error: string | null };
    if (res.ok && json.data) {
      const rec = json.data;
      setList((prev) => prev.map((d) => (d.id === rec.id ? { ...d, ...rec } : d)));
    }
  };

  /** D6: 提案を承認する／見送る。**決めるのは担当者** — AI は決められない */
  const decide = async (proposalId: string, action: "approve" | "decline") => {
    if (!selected || decidingId) return;
    setDecidingId(proposalId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/measure-dialogue/${selected.id}/proposals/${proposalId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? (action === "approve" ? "登録に失敗しました" : "見送りに失敗しました"));
        return;
      }
      await reloadSelected(selected.id);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setDecidingId(null);
    }
  };

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

  /** 202 受理後、GET をポーリングして結果を取り込む（再読み込み後の再開にも使う） */
  const awaitTurn = async (dialogueId: string) => {
    setSending(true);
    try {
      const rec = await waitForTurn<DialogueListItem>(
        `/api/admin/projects/${projectId}/measure-dialogue/${dialogueId}`,
      );
      setList((prev) => prev.map((d) => (d.id === rec.id ? { ...d, ...rec } : d)));
      if (rec.turn_status === "error") {
        setError(rec.turn_error ?? "AI処理に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setSending(false);
    }
  };

  // 画面を開いた時点で処理中（送信後に再読み込みした等）なら、待ち受けを再開する
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || !isTurnProcessing(selected) || sending) return;
    if (resumedFor.current === selected.id) return;
    resumedFor.current = selected.id;
    void awaitTurn(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.turn_status]);

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

    let accepted = false;
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
        data: { turn_status?: TurnStatus; messages: MeasureMessage[] } | null;
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
      // 発言はサーバーに保存済み。AI処理は非同期なのでポーリングで結果を待つ
      if (isAcceptedTurn(res.status, json.data)) {
        setList((prev) =>
          prev.map((d) =>
            d.id === selected.id
              ? { ...d, messages: json.data!.messages, turn_status: "processing" }
              : d,
          ),
        );
        accepted = true;
        // AI処理の実体は画面から起動する（サーバーの自己呼び出しは Lambda 凍結で届かない）
        requestTurnStep(`/api/admin/projects/${projectId}/measure-dialogue/${selected.id}/chat`);
      }
    } catch {
      setError("通信エラーが発生しました。画面を再読み込みすると状態を確認できます");
      setInput(text);
    } finally {
      if (!accepted) setSending(false);
    }
    if (accepted) await awaitTurn(selected.id);
  };

  /** 失敗したターンを、発言を追加せずにやり直す */
  const retry = async () => {
    if (!selected || sending) return;
    setError(null);
    setSending(true);
    let accepted = false;
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/measure-dialogue/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry" }),
        },
      );
      const json = (await res.json()) as {
        data: { turn_status?: TurnStatus; messages: MeasureMessage[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "再試行に失敗しました");
        return;
      }
      if (isAcceptedTurn(res.status, json.data)) {
        setList((prev) =>
          prev.map((d) =>
            d.id === selected.id ? { ...d, turn_status: "processing", turn_error: null } : d,
          ),
        );
        accepted = true;
        // AI処理の実体は画面から起動する（サーバーの自己呼び出しは Lambda 凍結で届かない）
        requestTurnStep(`/api/admin/projects/${projectId}/measure-dialogue/${selected.id}/chat`);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      if (!accepted) setSending(false);
    }
    if (accepted) await awaitTurn(selected.id);
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
  // 区画が欠けたまま書き出すと、下流にKPIの無い活動が並ぶ。
  // サーバー側の 422 と同じ規則で、押す前に何が足りないかを見せる。
  const commitGaps = selected ? measureCommitGaps(selected) : [];

  // 課題仮説を指標ごとに束ねる（優先順位は対話ごとの採番なので、束ねないと 1位 が複数現れる）
  const hypothesisGroups = (() => {
    const byKpi = new Map<string, HypOption[]>();
    for (const h of hypotheses) {
      const key = h.kpi_label?.trim() || "指標の紐付けなし";
      const list = byKpi.get(key);
      if (list) list.push(h);
      else byKpi.set(key, [h]);
    }
    return Array.from(byKpi.entries());
  })();

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
              {/* 課題仮説は計画（指標）ごとに立てるが、この一覧は計画横断で並ぶ。
                  優先順位も対話ごとの採番なので、指標名で束ねないと 1位が複数現れて読めない */}
              {hypothesisGroups.map(([kpiLabel, items]: [string, HypOption[]]) => (
                <optgroup key={kpiLabel} label={kpiLabel}>
                  {items.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.priority_rank != null ? `優先度${h.priority_rank}位  ` : ""}
                      {h.title}
                      {h.root_cause ? ` — 真因: ${truncate(h.root_cause, 40)}` : ""}
                    </option>
                  ))}
                </optgroup>
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
          {selected?.turn_status === "error" && !sending && (
            <button
              onClick={() => void retry()}
              className="ml-3 text-xs px-2 py-0.5 rounded border hover:brightness-125"
              style={{ borderColor: "#ef444480" }}
            >
              🔁 AI処理を再試行
            </button>
          )}
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
                    {/* D6: 未決の提案・データ待ち。開かなくても気づけるように */}
                    {(d.pending_proposals ?? 0) > 0 && (
                      <span className="block text-[10px]" style={{ color: "#818cf8" }}>
                        📋 承認待ちの提案 {d.pending_proposals}件
                      </span>
                    )}
                    {d.data_state === "waiting_for_data" && (
                      <span className="block text-[10px]" style={{ color: "#f59e0b" }}>
                        ⏳ データのアップロード待ち
                      </span>
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
                      アプローチ {activeApproaches(selected.approaches).length}件
                      {selected.approaches.length > activeApproaches(selected.approaches).length && (
                        <span className="text-slate-500 font-normal">
                          （取り下げ {selected.approaches.length - activeApproaches(selected.approaches).length}件）
                        </span>
                      )}
                    </p>
                    {duplicateApproachTitles(selected.approaches).length > 0 && (
                      <div
                        className="rounded-lg border px-2 py-1.5 mb-2"
                        style={{ borderColor: "#fbbf2440", background: "#fbbf2410" }}
                      >
                        <p className="text-[10px] font-semibold" style={{ color: "#fbbf24" }}>
                          ⚠ 同じ施策名のアプローチがあります: {duplicateApproachTitles(selected.approaches).join(" / ")}
                        </p>
                        <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                          画面で見分けが付きません。統合するか名称を分けるようAIに依頼してください
                        </p>
                      </div>
                    )}
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
                  {selected.messages.map((m, i) =>
                    // D6: サーバが差し込んだデータ行。**担当者の発言ではない**ので、
                    // 吹き出しではなく記録として描く（誰が言ったのかを曖昧にしない）
                    m.kind === "data" ? (
                      <div key={i} className="flex justify-center">
                        <div
                          className="max-w-[92%] rounded-lg px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed"
                          style={{
                            background: "#0ea5e910",
                            color: "#7dd3fc",
                            border: "1px dashed #0ea5e950",
                          }}
                        >
                          {m.content}
                        </div>
                      </div>
                    ) : (
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
                    ),
                  )}
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
                  {/* D6: 提案カード（設計 §10-3）。承認するまで何も作られない */}
                  {(selected.proposals ?? []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold" style={{ color: "#818cf8" }}>
                        📋 AIからの提案 — 承認すると登録されます（承認するまで何も作られません）
                      </p>
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {(selected.proposals ?? []).map((p) => (
                          <ProposalCard
                            key={p.id}
                            projectId={projectId}
                            p={p}
                            busy={decidingId !== null}
                            onApprove={() => void decide(p.id, "approve")}
                            onDecline={() => void decide(p.id, "decline")}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {selected.data_state === "waiting_for_data" && (
                    <div
                      className="rounded-lg border px-3 py-2"
                      style={{ borderColor: "#f59e0b40", background: "#f59e0b10" }}
                    >
                      <p className="text-[11px] font-semibold" style={{ color: "#f59e0b" }}>
                        ⏳ データのアップロードを待っています
                      </p>
                      <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                        上げると計算して、この対話に結果が届きます。
                        <strong className="text-slate-300">待っている間も対話は続けられます。</strong>
                        上げたことを伝えてもらっても構いません（どちらでも同じ結果になります）。
                      </p>
                    </div>
                  )}

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
                  {canCommit && commitGaps.length > 0 && (
                    <div
                      className="rounded-lg border px-3 py-2 mb-2"
                      style={{ borderColor: "#f59e0b40", background: "#f59e0b10" }}
                    >
                      <p className="text-[11px] font-semibold" style={{ color: "#f59e0b" }}>
                        書き出しに必要な区画が埋まっていません
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {commitGaps.map((g) => (
                          <li key={g.approach_id} className="text-[10px] text-slate-400 leading-snug">
                            {g.measure_title}: {g.missing.join("・")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {canCommit && (
                      <button
                        type="button"
                        onClick={() => void commit()}
                        disabled={committing || commitGaps.length > 0}
                        title={
                          commitGaps.length > 0
                            ? `未記入の区画があります — ${describeMeasureGaps(commitGaps)}`
                            : "施策データセットとして書き出します"
                        }
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
