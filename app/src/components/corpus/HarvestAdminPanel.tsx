"use client";

/**
 * 「🛰 自動収集」タブ — X7a
 *
 * 上段: ソース一覧（有効トグル・頻度・最終/次回収集・直近の成績・今すぐ収集・編集）
 * 下段: 収集履歴（フィルタ・行クリックで明細ドロワー）
 * ヘッダ: 30日サマリー（新規候補・検収待ち残・推定APIコスト・失敗run数）
 *
 * 原則: enabled の有効化は license_note（許諾・利用規約の確認）が最終防衛線。
 * 収集は pending 投入まで — 承認は既存の検収タブで行う。
 */

import { useCallback, useEffect, useState } from "react";
import {
  CRAWL_FREQUENCIES,
  HARVEST_RUN_STATUS_META,
  HARVEST_SOURCE_KINDS,
  estimateTokenCostYen,
  nextCrawlDue,
  type CrawlFrequency,
  type HarvestRunStatus,
} from "@/lib/corpus/harvest/types";
import { HARVEST_ADAPTERS, HARVEST_ADAPTER_KEYS } from "@/lib/corpus/harvest/adapters";

// ─── 型（APIの返す形） ───────────────────────────────────

interface LastRun {
  id: string;
  status: HarvestRunStatus;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  items_found: number;
  items_new: number;
  items_duplicate: number;
  items_rejected_by_sanitize: number;
  error_summary: string | null;
}

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  adapter: string;
  crawl_frequency: CrawlFrequency;
  license_note: string;
  enabled: boolean;
  last_crawled_at: string | null;
  last_run: LastRun | null;
}

interface LogEntry {
  kind: "new" | "known" | "rejected" | "error" | "info";
  title: string;
  url?: string;
  note?: string;
}

interface RunRow extends LastRun {
  source_id: string;
  source_name: string;
  pages_fetched: number;
  input_tokens: number;
  output_tokens: number;
  log: LogEntry[];
}

export interface HarvestSummaryData {
  total_new: number;
  failed_runs: number;
  input_tokens: number;
  output_tokens: number;
  pending_review: { evidence: number; measures: number; context: number };
}

const card: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
};
const inputClass =
  "rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

const KIND_LABEL = Object.fromEntries(HARVEST_SOURCE_KINDS.map((k) => [k.key, k.label]));
const FREQ_LABEL = Object.fromEntries(CRAWL_FREQUENCIES.map((f) => [f.key, f.label]));

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const LOG_KIND_META: Record<LogEntry["kind"], { label: string; color: string }> = {
  new: { label: "新規", color: "#10b981" },
  known: { label: "既知", color: "#94a3b8" },
  rejected: { label: "却下", color: "#f59e0b" },
  error: { label: "失敗", color: "#ef4444" },
  info: { label: "情報", color: "#818cf8" },
};

interface EditState {
  name: string;
  base_url: string;
  crawl_frequency: CrawlFrequency;
  license_note: string;
}

export default function HarvestAdminPanel(props: {
  onError: (msg: string | null) => void;
  onInfo: (msg: string | null) => void;
}) {
  const { onError, onInfo } = props;
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [summary, setSummary] = useState<HarvestSummaryData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, EditState>>({});
  const [confirmEnable, setConfirmEnable] = useState<SourceRow | null>(null);
  const [openRun, setOpenRun] = useState<RunRow | null>(null);
  const [runSourceFilter, setRunSourceFilter] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    kind: "structured_db",
    base_url: "",
    adapter: HARVEST_ADAPTER_KEYS[0] ?? "",
    crawl_frequency: "monthly" as CrawlFrequency,
    license_note: "",
  });

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/ordo-admin/corpus/sources");
      const json = (await res.json()) as { data: SourceRow[] | null; error: string | null };
      if (res.ok && json.data) setSources(json.data);
      else {
        setSources([]);
        onError(json.error ?? "ソース一覧の読み込みに失敗しました");
      }
    } catch {
      setSources([]);
      onError("通信エラーが発生しました");
    }
  }, [onError]);

  const loadRuns = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (runSourceFilter) q.set("sourceId", runSourceFilter);
      if (runStatusFilter) q.set("status", runStatusFilter);
      const res = await fetch(`/api/ordo-admin/corpus/harvest-runs?${q.toString()}`);
      const json = (await res.json()) as {
        data: { runs: RunRow[]; summary: HarvestSummaryData } | null;
        error: string | null;
      };
      if (res.ok && json.data) {
        setRuns(json.data.runs);
        setSummary(json.data.summary);
      } else {
        setRuns([]);
        onError(json.error ?? "収集履歴の読み込みに失敗しました");
      }
    } catch {
      setRuns([]);
      onError("通信エラーが発生しました");
    }
  }, [onError, runSourceFilter, runStatusFilter]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // ── ソース操作 ─────────────────────────────────

  const patchSource = async (id: string, body: Record<string, unknown>, doneMsg?: string) => {
    setBusy(id);
    onError(null);
    try {
      const res = await fetch(`/api/ordo-admin/corpus/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        onError(json.error ?? "更新に失敗しました");
        return false;
      }
      if (doneMsg) onInfo(doneMsg);
      await loadSources();
      return true;
    } catch {
      onError("通信エラーが発生しました");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = (s: SourceRow) => {
    if (s.enabled) {
      void patchSource(s.id, { enabled: false }, `${s.name} を無効化しました`);
    } else {
      // 有効化はライセンス注意の確認ダイアログを挟む
      setConfirmEnable(s);
    }
  };

  const runNow = async (s: SourceRow) => {
    setBusy(`run:${s.id}`);
    onError(null);
    onInfo(`${s.name} の収集を実行中…（数分かかることがあります）`);
    try {
      const res = await fetch("/api/ordo-admin/corpus/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: s.id }),
      });
      const json = (await res.json()) as {
        data: { status: string; itemsFound: number; itemsNew: number; itemsDuplicate: number; itemsRejected: number } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        onInfo(null);
        onError(json.error ?? "収集に失敗しました");
        return;
      }
      const d = json.data;
      onInfo(
        `${s.name}: 収集${d.status === "succeeded" ? "完了" : d.status === "partial" ? "完了（一部失敗）" : "失敗"} — 候補${d.itemsFound}件 / 新規${d.itemsNew}件（検収待ちへ）/ 既知${d.itemsDuplicate}件 / 機械防御で却下${d.itemsRejected}件`,
      );
      await loadSources();
      await loadRuns();
    } catch {
      onInfo(null);
      onError("通信エラーが発生しました（収集はサーバー側で継続している可能性があります）");
    } finally {
      setBusy(null);
    }
  };

  const createSource = async () => {
    setBusy("create");
    onError(null);
    try {
      const res = await fetch("/api/ordo-admin/corpus/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...createForm, enabled: false }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        onError(json.error ?? "追加に失敗しました");
        return;
      }
      onInfo("ソースを追加しました（enabled=false。ライセンス確認のうえ有効化してください）");
      setShowCreate(false);
      setCreateForm({ ...createForm, name: "", base_url: "", license_note: "" });
      await loadSources();
    } catch {
      onError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 描画 ───────────────────────────────────────

  const pendingTotal = summary
    ? summary.pending_review.evidence + summary.pending_review.measures + summary.pending_review.context
    : 0;

  return (
    <div className="space-y-6">
      {/* ── 30日サマリー ── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["新規候補（30日）", `${summary.total_new}件`],
            ["検収待ち残", `${pendingTotal}件`],
            ["推定APIコスト（30日）", `約${estimateTokenCostYen(summary.input_tokens, summary.output_tokens).toLocaleString()}円`],
            ["失敗run（30日）", `${summary.failed_runs}件`],
          ].map(([label, value], i) => (
            <div key={label} className="rounded-xl p-3" style={card}>
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {label}
              </p>
              <p
                className="text-lg font-bold"
                style={{
                  color:
                    i === 3 && summary.failed_runs > 0 ? "#f87171" : "var(--text-primary)",
                }}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── ソース一覧 ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            収集ソース
          </h2>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {showCreate ? "閉じる" : "＋ ソースを追加"}
          </button>
        </div>

        {showCreate && (
          <div className="rounded-xl p-4 space-y-2" style={card}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="ソース名"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="一覧ページURL（https://…）"
                value={createForm.base_url}
                onChange={(e) => setCreateForm({ ...createForm, base_url: e.target.value })}
              />
              <select
                className={inputClass}
                style={inputStyle}
                value={createForm.adapter}
                onChange={(e) => setCreateForm({ ...createForm, adapter: e.target.value })}
              >
                {HARVEST_ADAPTER_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {HARVEST_ADAPTERS[k]?.label ?? k}（{k}）
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                style={inputStyle}
                value={createForm.kind}
                onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value })}
              >
                {HARVEST_SOURCE_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                style={inputStyle}
                value={createForm.crawl_frequency}
                onChange={(e) =>
                  setCreateForm({ ...createForm, crawl_frequency: e.target.value as CrawlFrequency })
                }
              >
                {CRAWL_FREQUENCIES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="ライセンス・許諾の注記（空だと有効化できません）"
                value={createForm.license_note}
                onChange={(e) => setCreateForm({ ...createForm, license_note: e.target.value })}
              />
            </div>
            <button
              onClick={() => void createSource()}
              disabled={busy === "create" || !createForm.name || !createForm.base_url}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: "#6366f1", color: "#fff" }}
            >
              追加する（enabled=false で登録）
            </button>
          </div>
        )}

        {sources === null ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            ソースが登録されていません（042_corpus_harvest.sql の実行で初期ソースが入ります）
          </p>
        ) : (
          sources.map((s) => {
            const ed = editing[s.id];
            const due = nextCrawlDue(
              s.crawl_frequency,
              s.last_crawled_at ? new Date(s.last_crawled_at) : null,
              new Date(),
            );
            const lr = s.last_run;
            const lrMeta = lr ? HARVEST_RUN_STATUS_META[lr.status] : null;
            return (
              <div key={s.id} className="rounded-xl p-4 space-y-2" style={card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold break-words" style={{ color: "var(--text-primary)" }}>
                      {s.name}
                      <span
                        className="text-[10px] font-normal px-1.5 py-0.5 rounded ml-2"
                        style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                      >
                        {KIND_LABEL[s.kind] ?? s.kind} / {s.adapter}
                      </span>
                    </p>
                    <p className="text-[11px] mt-0.5 break-all" style={{ color: "var(--text-secondary)" }}>
                      {s.base_url}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {FREQ_LABEL[s.crawl_frequency]} / 最終収集: {fmtDate(s.last_crawled_at)} / 次回予定:{" "}
                      {s.crawl_frequency === "manual" ? "（手動のみ）" : s.enabled ? fmtDate(due?.toISOString() ?? null) : "（無効）"}
                    </p>
                    {lr && lrMeta && (
                      <p className="text-[11px] mt-0.5">
                        <span style={{ color: lrMeta.color }}>●</span>{" "}
                        <span style={{ color: "var(--text-secondary)" }}>
                          直近: {lrMeta.label}（{fmtDate(lr.started_at)}）新規{lr.items_new}件・既知{lr.items_duplicate}件・却下
                          {lr.items_rejected_by_sanitize}件
                          {lr.error_summary ? ` — ${lr.error_summary}` : ""}
                        </span>
                      </p>
                    )}
                    <p className="text-[11px] mt-0.5" style={{ color: s.license_note.trim() ? "var(--text-secondary)" : "#f59e0b" }}>
                      📜 {s.license_note.trim() || "ライセンス注記なし（有効化できません）"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleEnabled(s)}
                      disabled={busy != null || (!s.enabled && !s.license_note.trim())}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                      style={
                        s.enabled
                          ? { background: "#10b98122", color: "#34d399", border: "1px solid #10b98155" }
                          : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
                      }
                    >
                      {s.enabled ? "有効" : "無効"}
                    </button>
                    <button
                      onClick={() => void runNow(s)}
                      disabled={busy != null || !s.enabled}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                      style={{ background: "#6366f1", color: "#fff" }}
                    >
                      {busy === `run:${s.id}` ? "収集中…" : "▶ 今すぐ収集"}
                    </button>
                    <button
                      onClick={() =>
                        setEditing((prev) =>
                          ed
                            ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== s.id))
                            : {
                                ...prev,
                                [s.id]: {
                                  name: s.name,
                                  base_url: s.base_url,
                                  crawl_frequency: s.crawl_frequency,
                                  license_note: s.license_note,
                                },
                              },
                        )
                      }
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                    >
                      {ed ? "閉じる" : "編集"}
                    </button>
                  </div>
                </div>

                {ed && (
                  <div className="pt-2 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={ed.name}
                        onChange={(e) => setEditing({ ...editing, [s.id]: { ...ed, name: e.target.value } })}
                      />
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={ed.base_url}
                        onChange={(e) => setEditing({ ...editing, [s.id]: { ...ed, base_url: e.target.value } })}
                      />
                      <select
                        className={inputClass}
                        style={inputStyle}
                        value={ed.crawl_frequency}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            [s.id]: { ...ed, crawl_frequency: e.target.value as CrawlFrequency },
                          })
                        }
                      >
                        {CRAWL_FREQUENCIES.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        style={inputStyle}
                        placeholder="ライセンス・許諾の注記"
                        value={ed.license_note}
                        onChange={(e) =>
                          setEditing({ ...editing, [s.id]: { ...ed, license_note: e.target.value } })
                        }
                      />
                    </div>
                    <button
                      onClick={() =>
                        void patchSource(s.id, { ...ed }, "ソースを更新しました").then((ok) => {
                          if (ok) setEditing((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== s.id)));
                        })
                      }
                      disabled={busy != null}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ background: "#6366f1", color: "#fff" }}
                    >
                      保存
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── 収集履歴 ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold mr-2" style={{ color: "var(--text-primary)" }}>
            収集履歴（30日）
          </h2>
          <select
            className={inputClass}
            style={inputStyle}
            value={runSourceFilter}
            onChange={(e) => setRunSourceFilter(e.target.value)}
          >
            <option value="">全ソース</option>
            {(sources ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            style={inputStyle}
            value={runStatusFilter}
            onChange={(e) => setRunStatusFilter(e.target.value)}
          >
            <option value="">全状態</option>
            {Object.entries(HARVEST_RUN_STATUS_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {runs === null ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            収集履歴がありません（「▶ 今すぐ収集」または cron で実行されるとここに入ります）
          </p>
        ) : (
          <div className="rounded-xl overflow-hidden" style={card}>
            {runs.map((r) => {
              const m = HARVEST_RUN_STATUS_META[r.status];
              return (
                <button
                  key={r.id}
                  onClick={() => setOpenRun(r)}
                  className="w-full text-left px-4 py-2.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 hover:opacity-80"
                  style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}
                >
                  <span style={{ color: m.color }}>● {m.label}</span>
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {r.source_name}
                  </span>
                  <span>{fmtDate(r.started_at)}</span>
                  <span>{r.trigger === "manual" ? "手動" : "定期"}</span>
                  <span>
                    候補{r.items_found} / 新規{r.items_new} / 既知{r.items_duplicate} / 却下{r.items_rejected_by_sanitize}
                  </span>
                  {(r.input_tokens > 0 || r.output_tokens > 0) && (
                    <span>約{estimateTokenCostYen(r.input_tokens, r.output_tokens).toLocaleString()}円</span>
                  )}
                  {r.error_summary && <span style={{ color: "#f87171" }}>⚠ {r.error_summary}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 明細ドロワー ── */}
      {openRun && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: "#00000088" }}
          onClick={() => setOpenRun(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto p-5 space-y-3"
            style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                収集明細 — {openRun.source_name}
              </h3>
              <button
                onClick={() => setOpenRun(null)}
                className="px-2 py-1 rounded text-xs"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                閉じる
              </button>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {fmtDate(openRun.started_at)} 〜 {fmtDate(openRun.finished_at)} / ページ取得{openRun.pages_fetched} /
              tokens {openRun.input_tokens.toLocaleString()} in・{openRun.output_tokens.toLocaleString()} out
            </p>
            {openRun.error_summary && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: "#ef444418", color: "#f87171" }}>
                ⚠ {openRun.error_summary}
              </p>
            )}
            {(Array.isArray(openRun.log) ? openRun.log : []).map((entry, i) => {
              const m = LOG_KIND_META[entry.kind] ?? LOG_KIND_META.info;
              return (
                <div key={i} className="rounded-lg px-3 py-2 text-xs" style={card}>
                  <span className="font-semibold mr-2" style={{ color: m.color }}>
                    [{m.label}]
                  </span>
                  <span style={{ color: "var(--text-primary)" }}>{entry.title}</span>
                  {entry.note && (
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {entry.note}
                    </p>
                  )}
                  {entry.url && (
                    <p className="text-[11px] mt-0.5 break-all" style={{ color: "var(--text-secondary)" }}>
                      {entry.url}
                    </p>
                  )}
                </div>
              );
            })}
            {(!Array.isArray(openRun.log) || openRun.log.length === 0) && (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                明細ログはありません
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── 有効化の確認ダイアログ（ライセンス注意） ── */}
      {confirmEnable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#00000088" }}
          onClick={() => setConfirmEnable(null)}
        >
          <div
            className="w-full max-w-md rounded-xl p-5 space-y-3"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              「{confirmEnable.name}」を有効化しますか？
            </h3>
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: "#f59e0b18", color: "#fbbf24" }}>
              📜 ライセンス・許諾の確認: {confirmEnable.license_note}
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              有効化すると、スケジュール（{FREQ_LABEL[confirmEnable.crawl_frequency]}）と「今すぐ収集」の
              対象になります。収集した行は検収待ち（pending）に入り、承認するまで接地には使われません。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmEnable(null)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const s = confirmEnable;
                  setConfirmEnable(null);
                  void patchSource(s.id, { enabled: true }, `${s.name} を有効化しました`);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: "#10b981", color: "#fff" }}
              >
                ライセンスを確認のうえ有効化
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
