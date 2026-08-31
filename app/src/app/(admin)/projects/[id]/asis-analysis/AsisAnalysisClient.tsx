"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PermissionGate from "@/components/PermissionGate";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import CopyButton from "@/components/CopyButton";
import { formatMessage, formatTranscript } from "@/lib/ai/transcript";
import {
  isAcceptedTurn,
  requestTurnStep,
  isTurnProcessing,
  waitForTurn,
  type TurnStatus,
} from "@/lib/ai/turnClient";
import {
  PESTLE_META,
  PESTLE_ORDER,
  SEVEN_S_META,
  SEVEN_S_ORDER,
  SEVEN_S_HARD_COLOR,
  SEVEN_S_SOFT_COLOR,
  STEP_LABEL,
  type AsisMessage,
  type AsisStep,
  type CrossAnalysis,
  type ExternalItem,
  type InternalItem,
  type PestleKey,
  type SevenSKey,
  type SwotData,
} from "@/lib/asis/types";

export interface AsisRecord {
  id: string;
  kpi_id: string | null;
  kpi_label: string | null;
  title: string;
  status: "in_progress" | "completed";
  current_step: AsisStep;
  messages: AsisMessage[];
  swot: SwotData;
  cross_analysis: CrossAnalysis;
  /** AIターンの状態（migration 055・非同期化）。processing の間はポーリングで待つ */
  turn_status?: TurnStatus | null;
  turn_error?: string | null;
  created_at: string;
  updated_at: string;
}

interface KpiRow {
  id: string;
  label: string;
  unit: string;
}

interface Props {
  project: { id: string; title: string };
  projectId: string;
  initialRecords: AsisRecord[];
  kpis: KpiRow[];
}

// ─── バッジ ──────────────────────────────────
function PestleBadge({ k }: { k: PestleKey }) {
  const m = PESTLE_META[k];
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
      style={{ background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}55` }}
      title={`${m.full}（${m.label}）`}
    >
      {m.key}
    </span>
  );
}

function SevenSBadge({ k }: { k: SevenSKey }) {
  const m = SEVEN_S_META[k];
  const color = m.hard ? SEVEN_S_HARD_COLOR : SEVEN_S_SOFT_COLOR;
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
      style={{ background: `${color}33`, color, border: `1px solid ${color}66` }}
      title={`${m.label}（${m.hard ? "ハードの3S" : "ソフトの4S"}）`}
    >
      {m.label}
    </span>
  );
}

// ─── 対話履歴（読み取り専用）───────────────────────
function TranscriptView({ messages }: { messages: AsisMessage[] }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3 max-h-[600px] overflow-y-auto"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      {messages.length > 0 && (
        <div className="flex justify-end">
          <CopyButton
            variant="outline"
            label="対話全体をコピー"
            text={() =>
              formatTranscript(messages, {
                title: "現状整理（As-Is） — 対話履歴",
                stepLabel: (k) => STEP_LABEL[k as AsisStep] ?? k,
              })
            }
          />
        </div>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-slate-500">対話の記録がありません</p>
      ) : (
        messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[80%]">
              <div
                className={`flex items-center gap-1 mb-0.5 ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <p className="text-[10px] text-slate-500">
                  {m.role === "user" ? "担当者" : "AI"}
                  {m.step ? `・${STEP_LABEL[m.step]}` : ""}
                </p>
                <CopyButton
                  text={() => formatMessage(m, (k) => STEP_LABEL[k as AsisStep] ?? k)}
                  title="この発言をコピー"
                />
              </div>
              <div
                className="rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed"
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
          </div>
        ))
      )}
    </div>
  );
}

// ─── SWOT 進捗ボード（左カラム）────────────────
function SwotQuadrant({
  title,
  accent,
  external,
  internal,
}: {
  title: string;
  accent: string;
  external?: ExternalItem[];
  internal?: InternalItem[];
}) {
  const count = external?.length ?? internal?.length ?? 0;
  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "var(--bg-primary)", borderColor: `${accent}40` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: accent }}>
          {title}
        </span>
        <span className="text-[10px] text-slate-500">{count}件</span>
      </div>
      {count === 0 ? (
        <p className="text-[11px] text-slate-600">未整理</p>
      ) : (
        <ul className="space-y-1.5">
          {external?.map((it, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <PestleBadge k={it.pestle} />
              <span className="text-[11px] text-slate-300 leading-snug">{it.text}</span>
            </li>
          ))}
          {internal?.map((it, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <SevenSBadge k={it.seven_s} />
              <span className="text-[11px] text-slate-300 leading-snug">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SwotBoard({ swot, step }: { swot: SwotData; step: AsisStep }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300">SWOT進捗ボード</h2>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{ background: "#6366f120", color: "#818cf8", border: "1px solid #6366f140" }}
        >
          {STEP_LABEL[step]}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SwotQuadrant title="強み (S)" accent="#10b981" internal={swot.strengths} />
        <SwotQuadrant title="弱み (W)" accent="#ef4444" internal={swot.weaknesses} />
        <SwotQuadrant title="機会 (O)" accent="#3b82f6" external={swot.opportunities} />
        <SwotQuadrant title="脅威 (T)" accent="#f59e0b" external={swot.threats} />
      </div>
    </div>
  );
}

// ─── 完了後の結果ビュー ─────────────────────────
function PestleTable({ swot }: { swot: SwotData }) {
  return (
    <div className="space-y-3">
      {PESTLE_ORDER.map((k) => {
        const m = PESTLE_META[k];
        const opp = swot.opportunities.filter((o) => o.pestle === k);
        const thr = swot.threats.filter((t) => t.pestle === k);
        if (opp.length === 0 && thr.length === 0) return null;
        return (
          <div
            key={k}
            className="rounded-lg border p-4"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <PestleBadge k={k} />
              <span className="text-sm font-semibold text-slate-200">
                {m.label}（{m.full}）
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-medium text-blue-400 mb-1">機会</p>
                {opp.length === 0 ? (
                  <p className="text-[11px] text-slate-600">—</p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside">
                    {opp.map((o, i) => (
                      <li key={i}>{o.text}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium text-amber-400 mb-1">脅威</p>
                {thr.length === 0 ? (
                  <p className="text-[11px] text-slate-600">—</p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside">
                    {thr.map((t, i) => (
                      <li key={i}>{t.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SevenSTable({ swot }: { swot: SwotData }) {
  return (
    <div className="space-y-3">
      {SEVEN_S_ORDER.map((k) => {
        const m = SEVEN_S_META[k];
        const str = swot.strengths.filter((s) => s.seven_s === k);
        const wek = swot.weaknesses.filter((w) => w.seven_s === k);
        if (str.length === 0 && wek.length === 0) return null;
        return (
          <div
            key={k}
            className="rounded-lg border p-4"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <SevenSBadge k={k} />
              <span className="text-sm font-semibold text-slate-200">{m.label}</span>
              <span className="text-[10px] text-slate-500">
                {m.hard ? "ハードの3S" : "ソフトの4S"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-medium text-emerald-400 mb-1">強み</p>
                {str.length === 0 ? (
                  <p className="text-[11px] text-slate-600">—</p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside">
                    {str.map((s, i) => (
                      <li key={i}>{s.text}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[11px] font-medium text-red-400 mb-1">弱み</p>
                {wek.length === 0 ? (
                  <p className="text-[11px] text-slate-600">—</p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-300 list-disc list-inside">
                    {wek.map((w, i) => (
                      <li key={i}>{w.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SwotMatrixView({ swot }: { swot: SwotData }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SwotQuadrant title="強み (Strengths)" accent="#10b981" internal={swot.strengths} />
      <SwotQuadrant title="弱み (Weaknesses)" accent="#ef4444" internal={swot.weaknesses} />
      <SwotQuadrant title="機会 (Opportunities)" accent="#3b82f6" external={swot.opportunities} />
      <SwotQuadrant title="脅威 (Threats)" accent="#f59e0b" external={swot.threats} />
    </div>
  );
}

function CrossView({ cross }: { cross: CrossAnalysis }) {
  const cells: { key: keyof CrossAnalysis; title: string; desc: string; accent: string }[] = [
    { key: "so", title: "SO戦略（強み×機会）", desc: "積極化戦略", accent: "#10b981" },
    { key: "wo", title: "WO戦略（弱み×機会）", desc: "改善戦略", accent: "#3b82f6" },
    { key: "st", title: "ST戦略（強み×脅威）", desc: "差別化戦略", accent: "#f59e0b" },
    { key: "wt", title: "WT戦略（弱み×脅威）", desc: "防衛/撤退戦略", accent: "#ef4444" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {cells.map((c) => {
        const items = cross[c.key];
        return (
          <div
            key={c.key}
            className="rounded-lg border p-4"
            style={{ background: "var(--bg-secondary)", borderColor: `${c.accent}40` }}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-semibold" style={{ color: c.accent }}>
                {c.title}
              </span>
              <span className="text-[10px] text-slate-500">{c.desc}</span>
            </div>
            {items.length === 0 ? (
              <p className="text-[11px] text-slate-600">—</p>
            ) : (
              <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                {items.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ResultTab = "pestle" | "seven_s" | "swot" | "cross" | "dialogue";

function ResultView({ record }: { record: AsisRecord }) {
  const [tab, setTab] = useState<ResultTab>("swot");
  const tabs: { key: ResultTab; label: string }[] = [
    { key: "pestle", label: "PESTLE別" },
    { key: "seven_s", label: "7S別" },
    { key: "swot", label: "SWOTマトリクス" },
    { key: "cross", label: "クロス分析" },
    { key: "dialogue", label: "💬 対話履歴" },
  ];
  return (
    <div>
      <div
        className="flex gap-1 mb-4 rounded-lg p-1"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", width: "fit-content" }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={tab === t.key ? { background: "#6366f1", color: "#fff" } : { color: "#94a3b8" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "pestle" && <PestleTable swot={record.swot} />}
      {tab === "seven_s" && <SevenSTable swot={record.swot} />}
      {tab === "swot" && <SwotMatrixView swot={record.swot} />}
      {tab === "cross" && <CrossView cross={record.cross_analysis} />}
      {tab === "dialogue" && <TranscriptView messages={record.messages} />}
    </div>
  );
}

// ─── メインコンポーネント ───────────────────────
export default function AsisAnalysisClient({
  project,
  projectId,
  initialRecords,
  kpis,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kpiIdParam = searchParams.get("kpiId");
  const [records, setRecords] = useState<AsisRecord[]>(initialRecords);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRecords.find((r) => r.status === "in_progress")?.id ?? initialRecords[0]?.id ?? null,
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新規作成
  const [showCreate, setShowCreate] = useState(false);
  const [newKpiId, setNewKpiId] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = records.find((r) => r.id === selectedId) ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const kpiAutoStarted = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [selected?.messages.length, selectedId]);

  // 単一レコードを取得して records に反映（新規/既存どちらも upsert）して選択する
  const loadRecord = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/asis-analysis/${id}`);
      const json = (await res.json()) as { data: AsisRecord | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "現状整理の読み込みに失敗しました");
        return false;
      }
      const rec = json.data;
      setRecords((prev) =>
        prev.some((r) => r.id === rec.id)
          ? prev.map((r) => (r.id === rec.id ? rec : r))
          : [rec, ...prev],
      );
      setSelectedId(rec.id);
      return true;
    } catch {
      setError("通信エラーが発生しました");
      return false;
    }
  };

  // ?kpiId= で来た場合、対象KPIの現状整理を特定（なければ作成）して即対話表示
  useEffect(() => {
    if (!kpiIdParam || kpiAutoStarted.current) return;
    kpiAutoStarted.current = true;

    const existing = records.find((r) => r.kpi_id === kpiIdParam);
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/admin/projects/${projectId}/asis-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kpi_id: kpiIdParam }),
        });
        const json = (await res.json()) as { data: { id: string } | null; error: string | null };
        if (!res.ok || !json.data) {
          setError(json.error ?? "現状整理の開始に失敗しました");
          return;
        }
        await loadRecord(json.data.id);
      } catch {
        setError("通信エラーが発生しました");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiIdParam]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/asis-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpi_id: newKpiId || null }),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "作成に失敗しました");
        return;
      }
      setShowCreate(false);
      setNewKpiId("");
      await loadRecord(json.data.id);
    } finally {
      setCreating(false);
    }
  };

  /** 202 受理後、GET をポーリングして結果を取り込む（再読み込み後の再開にも使う） */
  const awaitTurn = async (asisId: string) => {
    setSending(true);
    try {
      const rec = await waitForTurn<AsisRecord>(
        `/api/admin/projects/${projectId}/asis-analysis/${asisId}`,
      );
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? { ...r, ...rec } : r)));
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

  const handleSend = async () => {
    if (!selected || !input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    // 楽観的にユーザーメッセージを追加
    const optimistic: AsisMessage = { role: "user", content: text, step: selected.current_step };
    setRecords((prev) =>
      prev.map((r) =>
        r.id === selected.id ? { ...r, messages: [...r.messages, optimistic] } : r,
      ),
    );

    let accepted = false;
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/asis-analysis/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );
      const json = (await res.json()) as {
        data: { turn_status?: TurnStatus; messages: AsisMessage[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "送信に失敗しました");
        // 楽観的更新をロールバック
        setRecords((prev) =>
          prev.map((r) =>
            r.id === selected.id
              ? { ...r, messages: r.messages.filter((m) => m !== optimistic) }
              : r,
          ),
        );
        setInput(text);
        return;
      }
      // 発言はサーバーに保存済み。AI処理は非同期なのでポーリングで結果を待つ
      if (isAcceptedTurn(res.status, json.data)) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === selected.id
              ? { ...r, messages: json.data!.messages, turn_status: "processing" }
              : r,
          ),
        );
        accepted = true;
        // AI処理の実体は画面から起動する（サーバーの自己呼び出しは Lambda 凍結で届かない）
        requestTurnStep(`/api/admin/projects/${projectId}/asis-analysis/${selected.id}/chat`);
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
  const handleRetry = async () => {
    if (!selected || sending) return;
    setError(null);
    setSending(true);
    let accepted = false;
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/asis-analysis/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry" }),
        },
      );
      const json = (await res.json()) as {
        data: { turn_status?: TurnStatus; messages: AsisMessage[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "再試行に失敗しました");
        return;
      }
      if (isAcceptedTurn(res.status, json.data)) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === selected.id ? { ...r, turn_status: "processing", turn_error: null } : r,
          ),
        );
        accepted = true;
        // AI処理の実体は画面から起動する（サーバーの自己呼び出しは Lambda 凍結で届かない）
        requestTurnStep(`/api/admin/projects/${projectId}/asis-analysis/${selected.id}/chat`);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      if (!accepted) setSending(false);
    }
    if (accepted) await awaitTurn(selected.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この現状整理を削除しますか？")) return;
    const res = await fetch(`/api/admin/projects/${projectId}/asis-analysis/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (selectedId === id) setSelectedId(null);
    }
  };

  const inputClass =
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    borderColor: "var(--border)",
  };

  // ?kpiId= 付きで来た場合は KPI 確定モード（一覧・プルダウン非表示）
  const kpiMode = !!kpiIdParam;
  const kpiModeLabel =
    kpis.find((k) => k.id === kpiIdParam)?.label ?? selected?.kpi_label ?? null;

  // 直近のAIメッセージに付いた回答ヒント（クリックで入力欄に追加できる）
  const lastAssistant = selected
    ? [...selected.messages].reverse().find((m) => m.role === "assistant")
    : undefined;
  const latestSuggestions = lastAssistant?.suggestions ?? [];

  // 対話パネル / 結果パネル（selected 前提で描画）
  const detailPanel =
    selected == null ? null : selected.status === "completed" ? (
      <div>
        {/* 完了バナー */}
        <div
          className="rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3"
          style={{ background: "#10b98112", borderColor: "#10b98140" }}
        >
          <p className="text-sm font-medium text-emerald-400">
            ✅ 現状整理が完了しました
          </p>
          {selected.kpi_id && (
            <button
              onClick={() => router.push(`/projects/${projectId}/gap-analysis`)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0"
              style={{ background: "#10b98120", color: "#10b981", border: "1px solid #10b98140" }}
            >
              ← ギャップ分析に戻る
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-200">{selected.title} — 整理結果</h2>
          <button
            onClick={() => handleDelete(selected.id)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{ background: "#ef444418", color: "#ef4444", border: "1px solid #ef444440" }}
          >
            削除
          </button>
        </div>
        <ResultView record={selected} />
      </div>
    ) : (
      <div
        className="rounded-xl border flex flex-col"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", height: 600 }}
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p className="text-[11px] text-slate-500">{STEP_LABEL[selected.current_step]}</p>
          {selected.messages.length > 0 && (
            <CopyButton
              variant="outline"
              label="対話全体をコピー"
              text={() =>
                formatTranscript(selected.messages, {
                  title: `現状整理（As-Is）${selected.kpi_label ? ` — ${selected.kpi_label}` : ""}`,
                  stepLabel: (k) => STEP_LABEL[k as AsisStep] ?? k,
                })
              }
            />
          )}
        </div>
        {/* メッセージ */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {selected.messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-[80%]">
                <div
                  className="rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed"
                  style={
                    m.role === "user"
                      ? { background: "#6366f1", color: "#fff" }
                      : { background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }
                  }
                >
                  {m.content}
                </div>
                <div className={`flex mt-0.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <CopyButton
                    text={() => formatMessage(m, (k) => STEP_LABEL[k as AsisStep] ?? k)}
                    title="この発言をコピー"
                  />
                </div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <AiThinkingIndicator
                label="AIが考えています"
                sub="ナレッジとWebを参照しながら次の問いとヒントを準備しています"
              />
            </div>
          )}
        </div>

        {/* 入力 */}
        <PermissionGate module="issue_hypothesis" level="edit" projectId={projectId}>
          <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
            {/* AIからの回答ヒント（仮説提示） */}
            {latestSuggestions.length > 0 && !sending && (
              <div>
                <p className="text-[11px] font-semibold mb-1.5" style={{ color: "#818cf8" }}>
                  💡 回答のヒント — クリックすると入力欄に追加されます
                </p>
                <div className="flex flex-col gap-1.5">
                  {latestSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setInput((prev) => (prev ? `${prev}\n${s}` : s))}
                      className="text-left text-xs leading-snug px-3 py-2 rounded-lg transition-colors hover:brightness-125"
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
            {/* 回答フォーマットの常時ガイド */}
            <p className="text-[11px] leading-relaxed text-slate-500">
              現在: {STEP_LABEL[selected.current_step]}｜ヒントには「はい／いいえ＋実情の補足」で答えるだけでも、
              箇条書きや自由記述でも構いません。分からない項目は「不明」でOKです。
            </p>
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                placeholder="回答を入力（Enterで送信 / Shift+Enterで改行）"
                className={inputClass}
                style={{ ...inputStyle, resize: "none" }}
                disabled={sending}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || sending}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 shrink-0"
                style={{ background: "#6366f1" }}
              >
                送信
              </button>
            </div>
          </div>
        </PermissionGate>
      </div>
    );

  const loadingPanel = (
    <div
      className="rounded-xl border p-12 flex flex-col items-center gap-3"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <AiThinkingIndicator label="対話を準備しています" sub="指標の情報を読み込んでいます" />
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs text-slate-500">{project.title}</p>
            <h1 className="text-xl font-bold text-slate-100">対話型の現状整理（As-Is分析）</h1>
            {kpiMode && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">対象指標</span>
                <span
                  className="text-sm font-semibold px-3 py-1 rounded-lg"
                  style={{ background: "#6366f120", color: "#a5b4fc", border: "1px solid #6366f140" }}
                >
                  📊 {kpiModeLabel ?? "（読み込み中）"}
                </span>
              </div>
            )}
          </div>
          {kpiMode ? (
            <button
              onClick={() => router.push(`/projects/${projectId}/gap-analysis`)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
              style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
            >
              ← ギャップ分析に戻る
            </button>
          ) : (
            <PermissionGate module="issue_hypothesis" level="edit" projectId={projectId}>
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: "#6366f1" }}
              >
                + 新しい現状整理
              </button>
            </PermissionGate>
          )}
        </div>

        {error && (
          <div
            className="rounded-lg border px-4 py-2 text-sm mb-4"
            style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
          >
            {error}
            {selected?.turn_status === "error" && !sending && (
              <button
                onClick={() => void handleRetry()}
                className="ml-3 text-xs px-2 py-0.5 rounded border hover:brightness-125"
                style={{ borderColor: "#ef444480" }}
              >
                🔁 AI処理を再試行
              </button>
            )}
            <button onClick={() => setError(null)} className="ml-3 text-xs opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {kpiMode ? (
          /* KPI確定モード: 一覧・プルダウンを出さず直接対話 */
          <div className="flex gap-4">
            <div className="flex flex-col gap-4" style={{ width: 340, flexShrink: 0 }}>
              {selected && <SwotBoard swot={selected.swot} step={selected.current_step} />}
            </div>
            <div className="flex-1 min-w-0">{selected ? detailPanel : loadingPanel}</div>
          </div>
        ) : records.length === 0 ? (
          <div
            className="rounded-xl border p-12 text-center"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <p className="text-slate-500 text-sm mb-1">現状整理がまだありません</p>
            <p className="text-slate-600 text-xs">
              「新しい現状整理」から、AIとの対話でSWOT・PESTLE・7Sを整理できます
            </p>
          </div>
        ) : (
          <div className="flex gap-4">
            {/* 左: 一覧 + SWOT進捗ボード */}
            <div className="flex flex-col gap-4" style={{ width: 340, flexShrink: 0 }}>
              <div
                className="rounded-xl border p-3"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <h2 className="text-xs font-semibold text-slate-400 mb-2 px-1">整理一覧</h2>
                <div className="space-y-1.5">
                  {records.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left rounded-lg px-3 py-2 transition-colors"
                      style={
                        selectedId === r.id
                          ? { background: "#6366f120", border: "1px solid #6366f140" }
                          : { background: "var(--bg-primary)", border: "1px solid var(--border)" }
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-200 truncate">
                          {r.title}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                          style={
                            r.status === "completed"
                              ? { background: "#10b98120", color: "#10b981" }
                              : { background: "#f59e0b20", color: "#f59e0b" }
                          }
                        >
                          {r.status === "completed" ? "完了" : STEP_LABEL[r.current_step]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {selected && <SwotBoard swot={selected.swot} step={selected.current_step} />}
            </div>

            {/* 右: 対話 or 結果 */}
            <div className="flex-1 min-w-0">
              {!selected ? (
                <div
                  className="rounded-xl border p-12 text-center"
                  style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
                >
                  <p className="text-slate-500 text-sm">左の一覧から選択してください</p>
                </div>
              ) : (
                detailPanel
              )}
            </div>
          </div>
        )}
      </div>

      {/* 新規作成モーダル */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#00000080" }}>
          <div
            className="rounded-xl border w-full max-w-sm mx-4 p-6 neu-card"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <h2 className="text-base font-semibold text-slate-100 mb-1">新しい現状整理</h2>
            <p className="text-xs text-slate-500 mb-4">
              対象のKPIを選ぶと、その指標に絞って対話します（任意）
            </p>
            <label className="text-xs text-slate-400 mb-1 block">対象KPI</label>
            <select
              value={newKpiId}
              onChange={(e) => setNewKpiId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">プロジェクト全体</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: "#6366f1" }}
              >
                {creating ? "作成中..." : "対話を始める"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
