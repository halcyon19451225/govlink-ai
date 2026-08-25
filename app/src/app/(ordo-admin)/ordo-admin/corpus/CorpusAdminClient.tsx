"use client";

/**
 * コーパス管理画面 — X3
 *
 * タブ:
 *  - 検収: 自治体から供出された行（pending）を承認・却下する。
 *    承認された行だけが横断参照（X4のコーパス接地）の対象になる。
 *  - ナレッジ抽出: Tier1ナレッジ文書からAIで施策・エビデンスを拾い上げ、
 *    担当者が確認・選別して取り込む（無確認の自動登録はしない）。
 *  - 自動収集（X7a）: 収集ソースの稼働状況・履歴。収集は pending 投入まで。
 *  - 同意管理: 自治体ごとのオプトイン。オプトアウトは供出済み行を全削除する。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import HarvestAdminPanel from "@/components/corpus/HarvestAdminPanel";
import CorpusBrowsePanel from "@/components/corpus/CorpusBrowsePanel";
import { CONTEXT_KINDS } from "@/lib/corpus/harvest/types";
import {
  CORPUS_STATUS_META,
  POPULATION_BANDS,
  type CorpusStatus,
  type ExtractionProposals,
} from "@/lib/corpus/types";
import { EVIDENCE_LEVELS } from "@/lib/measure/types";

// ─── 型（APIの返す形） ───────────────────────────────────

interface CorpusRow {
  id: string;
  status: CorpusStatus;
  field_category: string | null;
  population_band: string | null;
  title: string;
  source_kind?: string;
  source_note: string | null;
  contributor_key?: string | null;
  review_note: string | null;
  created_at: string;
  // X7a/X7c
  dup_of?: string | null;
  dup_score?: number | null;
  harvest_run_id?: string | null;
  // measures
  approach?: string | null;
  intervention?: string | null;
  evidence_status?: string;
  effect_note?: string | null;
  total_budget?: number | null;
  // evidence
  source?: string;
  design?: string;
  evidence_level?: number;
  effect_summary?: string;
  year?: number | null;
  output_summary?: string | null;
  outcome_summary?: string | null;
  effect_size_type?: string | null;
  effect_size_value?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
  p_value?: number | null;
  fiscal_effect_rate?: number | null;
  fiscal_effect_amount?: number | null;
  // context
  kind?: string;
  pestle_tag?: string;
  seven_s_tag?: string | null;
  swot_hint?: string;
  body?: string;
  source_org?: string;
  source_url?: string | null;
  region_scope?: string;
  effective_until?: string | null;
}

type ReviewKind = "measures" | "evidence" | "context";

interface SourceOption {
  id: string;
  name: string;
}

interface ConsentRow {
  municipality_id: string;
  name: string;
  opted_in: boolean;
  note: string | null;
  decided_by: string | null;
  updated_at: string | null;
  contributed_measures: number;
  contributed_evidence: number;
}

interface DocRow {
  id: string;
  title: string;
  status: string;
}

interface ExtractionState {
  extraction_id: string;
  proposals: ExtractionProposals;
  includeMeasures: boolean[];
  includeEvidence: boolean[];
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

const SOURCE_KIND_LABEL: Record<string, string> = {
  measure_design: "自治体の確定施策",
  knowledge_extract: "ナレッジ抽出",
  evidence_item: "施策のエビデンス欄",
  experiment_result: "自治体の実験結果",
  harvest: "自動収集",
};

const CONTEXT_KIND_LABEL: Record<string, string> = Object.fromEntries(
  CONTEXT_KINDS.map((k) => [k.key, k.label]),
);

export default function CorpusAdminClient() {
  const [tab, setTab] = useState<"review" | "extract" | "harvest" | "browse" | "consents">("review");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // 自動収集の失敗run有無（タブの⚠バッジ用・軽量呼び出し）
  const [harvestAlert, setHarvestAlert] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/ordo-admin/corpus/harvest-runs?lite=1");
        const json = (await res.json()) as {
          data: { summary?: { failed_runs?: number } } | null;
        };
        setHarvestAlert(Boolean(res.ok && (json.data?.summary?.failed_runs ?? 0) > 0));
      } catch {
        // バッジは装飾。取得失敗で画面を汚さない
      }
    })();
  }, []);

  // ── 検収 ─────────────────────────────────────
  const [kind, setKind] = useState<ReviewKind>("measures");
  const [statusFilter, setStatusFilter] = useState<CorpusStatus | "all">("pending");
  const [rows, setRows] = useState<CorpusRow[] | null>(null);
  const [edits, setEdits] = useState<Record<string, { field_category: string; population_band: string; review_note: string }>>({});

  // X7c: 絞り込み（収集ソース・Lv・分野・重複疑いのみ）
  const [fSourceId, setFSourceId] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fDupOnly, setFDupOnly] = useState(false);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[] | null>(null);

  // X7c: 一括検収
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState<{ action: "approve" | "reject"; dupCount: number } | null>(null);

  // X7c: 重複比較ドロワー
  const [dupCompare, setDupCompare] = useState<{ row: CorpusRow; partner: CorpusRow | null; loading: boolean } | null>(null);

  const loadRows = useCallback(async () => {
    setRows(null);
    setSelected(new Set());
    try {
      const q = new URLSearchParams({ kind });
      if (statusFilter !== "all") q.set("status", statusFilter);
      if (fSourceId) q.set("sourceId", fSourceId);
      if (fCategory.trim()) q.set("category", fCategory.trim());
      if (fDupOnly) q.set("dupOnly", "1");
      if (kind === "evidence" && fLevel) q.set("level", fLevel);
      const res = await fetch(`/api/ordo-admin/corpus?${q.toString()}`);
      const json = (await res.json()) as { data: { rows: CorpusRow[] } | null; error: string | null };
      if (res.ok && json.data) setRows(json.data.rows);
      else {
        setRows([]);
        setError(json.error ?? "読み込みに失敗しました");
      }
    } catch {
      setRows([]);
      setError("通信エラーが発生しました");
    }
  }, [kind, statusFilter, fSourceId, fCategory, fDupOnly, fLevel]);

  useEffect(() => {
    if (tab === "review") void loadRows();
  }, [tab, loadRows]);

  useEffect(() => {
    if (tab !== "review" || sourceOptions !== null) return;
    void (async () => {
      try {
        const res = await fetch("/api/ordo-admin/corpus/sources");
        const json = (await res.json()) as { data: SourceOption[] | null };
        setSourceOptions(res.ok && json.data ? json.data.map((s) => ({ id: s.id, name: s.name })) : []);
      } catch {
        setSourceOptions([]);
      }
    })();
  }, [tab, sourceOptions]);

  const pendingRows = useMemo(() => (rows ?? []).filter((r) => r.status === "pending"), [rows]);
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: "approve" | "reject") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy("bulk");
    setError(null);
    try {
      const res = await fetch("/api/ordo-admin/corpus/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, action, ids, note: bulkNote.trim() || null }),
      });
      const json = (await res.json()) as {
        data: { updated: number; skipped: number } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "一括検収に失敗しました");
        return;
      }
      setInfo(
        `${json.data.updated}件を${action === "approve" ? "承認" : "却下"}しました` +
          (json.data.skipped > 0 ? `（pending以外の${json.data.skipped}件はスキップ）` : ""),
      );
      setBulkNote("");
      await loadRows();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
      setBulkConfirm(null);
    }
  };

  const requestBulk = (action: "approve" | "reject") => {
    // 安全弁: 一括対象に重複疑い行が含まれる場合は件数を明示して確認（§3-2）
    const dupCount = (rows ?? []).filter((r) => selected.has(r.id) && r.dup_of).length;
    if (action === "approve" && dupCount > 0) {
      setBulkConfirm({ action, dupCount });
      return;
    }
    void runBulk(action);
  };

  const openDupCompare = async (r: CorpusRow) => {
    if (!r.dup_of) return;
    setDupCompare({ row: r, partner: null, loading: true });
    try {
      const res = await fetch(`/api/ordo-admin/corpus/${kind}/${r.dup_of}`);
      const json = (await res.json()) as { data: { row: CorpusRow } | null };
      setDupCompare({ row: r, partner: res.ok && json.data ? json.data.row : null, loading: false });
    } catch {
      setDupCompare({ row: r, partner: null, loading: false });
    }
  };

  const decideDup = async (r: CorpusRow, asDuplicate: boolean) => {
    setBusy(r.id);
    setError(null);
    try {
      const body = asDuplicate
        ? { status: "rejected", review_note: `重複として却下（類似行 ${r.dup_of} と同一内容）` }
        : { status: "approved", review_note: `類似行 ${r.dup_of} とは別物と判断して承認` };
      const res = await fetch(`/api/ordo-admin/corpus/${kind}/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      setDupCompare(null);
      await loadRows();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const patchRow = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/ordo-admin/corpus/${kind}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      await loadRows();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const editOf = (r: CorpusRow) =>
    edits[r.id] ?? {
      field_category: r.field_category ?? "",
      population_band: r.population_band ?? "",
      review_note: r.review_note ?? "",
    };

  const decide = (r: CorpusRow, status: CorpusStatus) => {
    const e = editOf(r);
    void patchRow(r.id, {
      status,
      field_category: e.field_category.trim() || null,
      population_band: e.population_band || null,
      review_note: e.review_note.trim() || null,
    });
  };

  // ── ナレッジ抽出 ──────────────────────────────
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [docId, setDocId] = useState("");
  const [extraction, setExtraction] = useState<ExtractionState | null>(null);

  useEffect(() => {
    if (tab !== "extract" || docs !== null) return;
    void (async () => {
      try {
        const res = await fetch("/api/ordo-admin/knowledge/documents");
        const json = (await res.json()) as { data: DocRow[] | null };
        setDocs(res.ok && json.data ? json.data : []);
      } catch {
        setDocs([]);
      }
    })();
  }, [tab, docs]);

  const runExtract = async () => {
    if (!docId) return;
    setBusy("extract");
    setError(null);
    setInfo(null);
    setExtraction(null);
    try {
      const res = await fetch(`/api/ordo-admin/corpus/extract/${docId}`, { method: "POST" });
      const json = (await res.json()) as {
        data: { extraction_id: string; proposals: ExtractionProposals } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "抽出に失敗しました");
        return;
      }
      setExtraction({
        extraction_id: json.data.extraction_id,
        proposals: json.data.proposals,
        includeMeasures: json.data.proposals.measures.map(() => true),
        includeEvidence: json.data.proposals.evidence.map(() => true),
      });
      const n = json.data.proposals.measures.length + json.data.proposals.evidence.length;
      setInfo(
        n === 0
          ? "この文書からは施策・エビデンス情報を拾えませんでした"
          : `施策${json.data.proposals.measures.length}件・エビデンス${json.data.proposals.evidence.length}件を拾い上げました。内容を確認・選別して取り込んでください`,
      );
    } catch {
      setError("通信エラーが発生しました（大きな文書は時間がかかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  const intake = async (action: "intake" | "dismiss") => {
    if (!extraction || !docId) return;
    setBusy("intake");
    setError(null);
    try {
      const body =
        action === "intake"
          ? {
              action,
              extraction_id: extraction.extraction_id,
              measures: extraction.proposals.measures.filter((_, i) => extraction.includeMeasures[i]),
              evidence: extraction.proposals.evidence.filter((_, i) => extraction.includeEvidence[i]),
            }
          : { action, extraction_id: extraction.extraction_id };
      const res = await fetch(`/api/ordo-admin/corpus/extract/${docId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        data: { measures?: number; evidence?: number; dismissed?: boolean } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "処理に失敗しました");
        return;
      }
      setExtraction(null);
      setInfo(
        json.data.dismissed
          ? "提案を破棄しました"
          : `コーパスへ取り込みました（施策${json.data.measures ?? 0}件・エビデンス${json.data.evidence ?? 0}件・検収済みとして登録）`,
      );
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 同意管理 ─────────────────────────────────
  const [consents, setConsents] = useState<ConsentRow[] | null>(null);
  const [optoutArm, setOptoutArm] = useState<string | null>(null);
  const [consentNotes, setConsentNotes] = useState<Record<string, string>>({});

  const loadConsents = useCallback(async () => {
    setConsents(null);
    try {
      const res = await fetch("/api/ordo-admin/corpus/consents");
      const json = (await res.json()) as { data: ConsentRow[] | null; error: string | null };
      if (res.ok && json.data) setConsents(json.data);
      else {
        setConsents([]);
        setError(json.error ?? "読み込みに失敗しました");
      }
    } catch {
      setConsents([]);
      setError("通信エラーが発生しました");
    }
  }, []);

  useEffect(() => {
    if (tab === "consents") void loadConsents();
  }, [tab, loadConsents]);

  const setConsent = async (m: ConsentRow, optedIn: boolean) => {
    setBusy(m.municipality_id);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/ordo-admin/corpus/consents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          municipality_id: m.municipality_id,
          opted_in: optedIn,
          note: (consentNotes[m.municipality_id] ?? m.note ?? "").trim() || null,
        }),
      });
      const json = (await res.json()) as {
        data: { removed: { measures: number; evidence: number } | null } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      if (json.data.removed) {
        setInfo(
          `${m.name} をオプトアウトし、供出済みデータを削除しました（施策${json.data.removed.measures}件・エビデンス${json.data.removed.evidence}件）`,
        );
      } else {
        setInfo(`${m.name} をオプトインにしました（契約根拠は備考に残してください）`);
      }
      setOptoutArm(null);
      await loadConsents();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ─── 描画 ───────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          🌐 コーパス管理
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          自治体横断の学習データ（施策・エビデンス）の検収・抽出・同意管理。
          承認された行だけが横断参照・独自AIの根拠に使われます
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            ["review", "🧐 検収"],
            ["extract", "📄 ナレッジ抽出"],
            ["harvest", harvestAlert ? "🛰 自動収集 ⚠" : "🛰 自動収集"],
            ["browse", "📚 コーパス一覧"],
            ["consents", "🤝 同意管理"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setError(null);
              setInfo(null);
            }}
            className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={
              tab === key
                ? { background: "#6366f1", color: "#fff" }
                : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: "#ef444418", color: "#f87171" }}>
          ⚠ {error}
        </p>
      )}
      {info && !error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: "#10b98118", color: "#6ee7b7" }}>
          {info}
        </p>
      )}

      {/* ── 検収タブ ── */}
      {tab === "review" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["measures", "施策"],
                ["evidence", "エビデンス"],
                ["context", "コンテキスト"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={
                  kind === k
                    ? { background: "#6366f130", color: "#818cf8", border: "1px solid #6366f160" }
                    : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
                }
              >
                {label}
              </button>
            ))}
            <span className="mx-1" />
            {(["pending", "approved", "rejected", "all"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={
                  statusFilter === st
                    ? { background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }
                    : { color: "var(--text-secondary)", border: "1px solid transparent" }
                }
              >
                {st === "all" ? "すべて" : CORPUS_STATUS_META[st].label}
              </button>
            ))}
          </div>

          {/* ── X7c: 絞り込み ── */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={inputClass}
              style={inputStyle}
              value={fSourceId}
              onChange={(e) => setFSourceId(e.target.value)}
            >
              <option value="">全収集ソース（手動シード含む）</option>
              {(sourceOptions ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {kind === "evidence" && (
              <select className={inputClass} style={inputStyle} value={fLevel} onChange={(e) => setFLevel(e.target.value)}>
                <option value="">全レベル</option>
                {[5, 4, 3, 2, 1].map((lv) => (
                  <option key={lv} value={lv}>
                    Lv{lv}
                  </option>
                ))}
              </select>
            )}
            <input
              className={inputClass}
              style={inputStyle}
              placeholder="分野で絞り込み"
              value={fCategory}
              onChange={(e) => setFCategory(e.target.value)}
            />
            <button
              onClick={() => setFDupOnly((v) => !v)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={
                fDupOnly
                  ? { background: "#f59e0b22", color: "#fbbf24", border: "1px solid #f59e0b55" }
                  : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
              }
            >
              ⚠ 重複疑いのみ
            </button>
          </div>

          {/* ── X7c: 一括検収バー ── */}
          {pendingRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={card}>
              <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && pendingRows.every((r) => selected.has(r.id))}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(pendingRows.map((r) => r.id)) : new Set())
                  }
                />
                検収待ちを全選択
              </label>
              <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                {selected.size}件選択中
              </span>
              <input
                className={`${inputClass} flex-1 min-w-[160px]`}
                style={inputStyle}
                placeholder="一括検収メモ（全行に共通で記録）"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
              />
              <button
                disabled={selected.size === 0 || busy != null}
                onClick={() => requestBulk("approve")}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "#10b981" }}
              >
                選択した{selected.size}件を承認
              </button>
              <button
                disabled={selected.size === 0 || busy != null}
                onClick={() => requestBulk("reject")}
                className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                style={{ color: "#f87171", border: "1px solid #ef444440" }}
              >
                却下
              </button>
            </div>
          )}

          {rows === null ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              対象の行がありません（自治体からの供出・ナレッジ抽出の取り込みでここに入ります）
            </p>
          ) : (
            rows.map((r) => {
              const sm = CORPUS_STATUS_META[r.status];
              const e = editOf(r);
              return (
                <div key={r.id} className="rounded-xl p-4 space-y-2" style={card}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex items-start gap-2">
                      {r.status === "pending" && (
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                      )}
                      <div className="min-w-0">
                      <p className="text-sm font-semibold break-words" style={{ color: "var(--text-primary)" }}>
                        {kind === "evidence" && r.evidence_level != null && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5"
                            style={{
                              background: (EVIDENCE_LEVELS[r.evidence_level as 1 | 2 | 3 | 4 | 5]?.color ?? "#94a3b8") + "22",
                              color: EVIDENCE_LEVELS[r.evidence_level as 1 | 2 | 3 | 4 | 5]?.color ?? "#94a3b8",
                            }}
                          >
                            Lv{r.evidence_level}
                          </span>
                        )}
                        {r.title}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {kind === "context"
                          ? `${CONTEXT_KIND_LABEL[r.kind ?? ""] ?? r.kind} / ${r.source_org ?? ""}`
                          : `${SOURCE_KIND_LABEL[r.source_kind ?? ""] ?? r.source_kind}${
                              r.contributor_key ? "（匿名化供出）" : "（Tier1資料由来）"
                            }`}
                        {r.source ? ` / 出典: ${r.source}${r.year ? `・${r.year}` : ""}` : ""}
                        {r.source_note ? ` / ${r.source_note}` : ""}
                      </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {r.dup_of && (
                        <button
                          onClick={() => void openDupCompare(r)}
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={{ background: "#f59e0b22", color: "#fbbf24", border: "1px solid #f59e0b55" }}
                          title="類似行と並べて比較する"
                        >
                          ⚠ 類似あり{r.dup_score != null ? ` ${Math.round(Number(r.dup_score) * 100)}%` : ""}
                        </button>
                      )}
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={{ background: sm.color + "22", color: sm.color }}
                      >
                        {sm.label}
                      </span>
                    </div>
                  </div>

                  {kind === "measures" ? (
                    <div className="text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
                      {r.approach && <p>作用機序: {r.approach}</p>}
                      {r.intervention && <p>介入: {r.intervention}</p>}
                      {r.effect_note && <p style={{ color: "#6ee7b7" }}>実績: {r.effect_note}</p>}
                      {r.total_budget != null && <p>事業費: {Number(r.total_budget).toLocaleString("ja-JP")}円</p>}
                    </div>
                  ) : kind === "context" ? (
                    <div className="text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
                      {r.body && <p className="break-words">{r.body}</p>}
                      <p>
                        {r.pestle_tag && `PESTLE: ${r.pestle_tag}`}
                        {r.seven_s_tag && ` / 7S: ${r.seven_s_tag}`}
                        {r.swot_hint && r.swot_hint !== "neutral" && ` / SWOT: ${r.swot_hint}`}
                        {r.region_scope && ` / 範囲: ${r.region_scope}`}
                        {r.effective_until && ` / 適用期限: ${r.effective_until}`}
                      </p>
                    </div>
                  ) : (
                    <div className="text-xs space-y-1" style={{ color: "var(--text-secondary)" }}>
                      {r.effect_summary && <p>効果: {r.effect_summary}</p>}
                      {(r.output_summary || r.outcome_summary) && (
                        <p>
                          {r.output_summary && `アウトプット: ${r.output_summary}`}
                          {r.output_summary && r.outcome_summary && " → "}
                          {r.outcome_summary && `アウトカム: ${r.outcome_summary}`}
                        </p>
                      )}
                      {r.effect_size_value != null && (
                        <p style={{ color: "#93c5fd" }}>
                          効果量: {r.effect_size_type ?? ""} {r.effect_size_value}
                          {r.ci_low != null && r.ci_high != null && `（95%CI ${r.ci_low}〜${r.ci_high}）`}
                          {r.p_value != null && ` p=${r.p_value}`}
                        </p>
                      )}
                      {(r.fiscal_effect_rate != null || r.fiscal_effect_amount != null) && (
                        <p style={{ color: "#6ee7b7" }}>
                          財政効果:
                          {r.fiscal_effect_amount != null && ` ${Number(r.fiscal_effect_amount).toLocaleString("ja-JP")}円`}
                          {r.fiscal_effect_rate != null && ` / 効果率 ${r.fiscal_effect_rate}`}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      className={inputClass}
                      style={inputStyle}
                      placeholder="分野（介護予防 等）"
                      value={e.field_category}
                      onChange={(ev) =>
                        setEdits((prev) => ({ ...prev, [r.id]: { ...e, field_category: ev.target.value } }))
                      }
                    />
                    <select
                      className={inputClass}
                      style={inputStyle}
                      value={e.population_band}
                      onChange={(ev) =>
                        setEdits((prev) => ({ ...prev, [r.id]: { ...e, population_band: ev.target.value } }))
                      }
                    >
                      <option value="">規模帯未設定</option>
                      {POPULATION_BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${inputClass} flex-1 min-w-[160px]`}
                      style={inputStyle}
                      placeholder="検収メモ（却下理由・注意点）"
                      value={e.review_note}
                      onChange={(ev) =>
                        setEdits((prev) => ({ ...prev, [r.id]: { ...e, review_note: ev.target.value } }))
                      }
                    />
                    {r.status !== "approved" && (
                      <button
                        disabled={busy === r.id}
                        onClick={() => decide(r, "approved")}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                        style={{ background: "#10b981" }}
                      >
                        承認
                      </button>
                    )}
                    {r.status !== "rejected" && (
                      <button
                        disabled={busy === r.id}
                        onClick={() => decide(r, "rejected")}
                        className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                        style={{ color: "#f87171", border: "1px solid #ef444440" }}
                      >
                        却下
                      </button>
                    )}
                    {r.status !== "pending" && (
                      <button
                        disabled={busy === r.id}
                        onClick={() => decide(r, "pending")}
                        className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                        style={{ color: "#94a3b8", border: "1px solid var(--border)" }}
                      >
                        検収待ちに戻す
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── ナレッジ抽出タブ ── */}
      {tab === "extract" && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 space-y-3" style={card}>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Tier1ナレッジ文書（計画書・報告書・実証結果）から、施策とエビデンスの情報をAIが拾い上げます。
              AIは文書の記載の構造化だけを行い、<b>担当者（あなた）が確認・選別したものだけ</b>がコーパスに入ります。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${inputClass} min-w-[280px]`}
                style={inputStyle}
                value={docId}
                onChange={(e) => {
                  setDocId(e.target.value);
                  setExtraction(null);
                  setInfo(null);
                }}
              >
                <option value="">文書を選択してください</option>
                {(docs ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <button
                disabled={!docId || busy === "extract"}
                onClick={() => void runExtract()}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "#6366f1" }}
              >
                {busy === "extract" ? "抽出中…（数十秒かかります）" : "🔍 施策・エビデンスを抽出"}
              </button>
            </div>
          </div>

          {extraction && (
            <div className="space-y-3">
              {extraction.proposals.measures.length > 0 && (
                <div className="rounded-xl p-4 space-y-2" style={card}>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    施策の提案（{extraction.proposals.measures.length}件）
                  </p>
                  {extraction.proposals.measures.map((m, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={extraction.includeMeasures[i] ?? true}
                        onChange={(e) =>
                          setExtraction((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  includeMeasures: prev.includeMeasures.map((v, j) =>
                                    j === i ? e.target.checked : v,
                                  ),
                                }
                              : prev,
                          )
                        }
                      />
                      <span className="text-xs min-w-0" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {m.title}
                        </span>
                        {m.field_category && `［${m.field_category}］`}
                        {m.intervention && <><br />介入: {m.intervention}</>}
                        {m.effect_note && <><br />実績: {m.effect_note}</>}
                        {m.total_budget != null && <><br />事業費: {m.total_budget.toLocaleString("ja-JP")}円</>}
                        <br />
                        <span className="text-[10px]">出典: {m.source_note}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {extraction.proposals.evidence.length > 0 && (
                <div className="rounded-xl p-4 space-y-2" style={card}>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    エビデンスの提案（{extraction.proposals.evidence.length}件）
                  </p>
                  {extraction.proposals.evidence.map((ev, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={extraction.includeEvidence[i] ?? true}
                        onChange={(e) =>
                          setExtraction((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  includeEvidence: prev.includeEvidence.map((v, j) =>
                                    j === i ? e.target.checked : v,
                                  ),
                                }
                              : prev,
                          )
                        }
                      />
                      <span className="text-xs min-w-0" style={{ color: "var(--text-secondary)" }}>
                        <span
                          className="text-[10px] font-bold px-1 rounded mr-1"
                          style={{
                            background: (EVIDENCE_LEVELS[ev.evidence_level]?.color ?? "#94a3b8") + "22",
                            color: EVIDENCE_LEVELS[ev.evidence_level]?.color ?? "#94a3b8",
                          }}
                        >
                          Lv{ev.evidence_level}
                        </span>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {ev.title}
                        </span>
                        （{ev.source}
                        {ev.year ? `・${ev.year}` : ""}）
                        <br />
                        効果: {ev.effect_summary}
                        <br />
                        <span className="text-[10px]">出典: {ev.source_note}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  disabled={busy === "intake"}
                  onClick={() => void intake("intake")}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: "#10b981" }}
                >
                  ✓ 選択した項目をコーパスへ取り込む
                </button>
                <button
                  disabled={busy === "intake"}
                  onClick={() => void intake("dismiss")}
                  className="px-4 py-2 rounded-lg text-xs disabled:opacity-40"
                  style={{ color: "#f87171", border: "1px solid #ef444440" }}
                >
                  すべて破棄
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 自動収集タブ（X7a） ── */}
      {tab === "harvest" && <HarvestAdminPanel onError={setError} onInfo={setInfo} />}

      {/* ── コーパス一覧タブ（X7c・承認済みの閲覧専用） ── */}
      {tab === "browse" && <CorpusBrowsePanel onError={setError} />}

      {/* ── X7c: 重複比較ドロワー ── */}
      {dupCompare && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: "#00000088" }}
          onClick={() => setDupCompare(null)}
        >
          <div
            className="h-full w-full max-w-2xl overflow-y-auto p-5 space-y-3"
            style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                ⚠ 重複疑いの比較
                {dupCompare.row.dup_score != null &&
                  `（類似度 ${Math.round(Number(dupCompare.row.dup_score) * 100)}%）`}
              </h3>
              <button
                onClick={() => setDupCompare(null)}
                className="px-2 py-1 rounded text-xs"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                閉じる
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { label: "この行（検収対象）", row: dupCompare.row },
                { label: "類似行", row: dupCompare.partner },
              ].map(({ label, row }) => (
                <div key={label} className="rounded-xl p-3 space-y-1.5" style={card}>
                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {label}
                  </p>
                  {row ? (
                    <>
                      <p className="text-xs font-semibold break-words" style={{ color: "var(--text-primary)" }}>
                        {row.title}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {CORPUS_STATUS_META[row.status]?.label ?? row.status}
                        {row.evidence_level != null && ` / Lv${row.evidence_level}`}
                        {row.source && ` / ${row.source}`}
                        {row.year && `・${row.year}`}
                      </p>
                      {row.effect_summary && (
                        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                          効果: {row.effect_summary}
                        </p>
                      )}
                      {row.source_note && (
                        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                          {row.source_note}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {dupCompare.loading ? "読み込み中…" : "類似行を取得できませんでした（削除済みの可能性）"}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              自動では絶対に落とさない設計です。同一内容なら「重複として却下」、別の検証・別の資料なら
              「別物として承認」を選んでください（どちらも検収メモに判断が残ります）。
            </p>
            {dupCompare.row.status === "pending" && (
              <div className="flex gap-2">
                <button
                  disabled={busy != null}
                  onClick={() => void decideDup(dupCompare.row, true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{ color: "#f87171", border: "1px solid #ef444440" }}
                >
                  重複として却下
                </button>
                <button
                  disabled={busy != null}
                  onClick={() => void decideDup(dupCompare.row, false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: "#10b981" }}
                >
                  別物として承認
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── X7c: 一括承認の安全弁（重複疑いを含む場合の確認） ── */}
      {bulkConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#00000088" }}
          onClick={() => setBulkConfirm(null)}
        >
          <div
            className="w-full max-w-md rounded-xl p-5 space-y-3"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              一括承認の確認
            </h3>
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: "#f59e0b18", color: "#fbbf24" }}>
              ⚠ 選択した{selected.size}件のうち<b>{bulkConfirm.dupCount}件に重複の疑い</b>があります。
              重複疑い行は「⚠ 類似あり」から個別に比較・判断することを推奨します。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBulkConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                キャンセル
              </button>
              <button
                disabled={busy != null}
                onClick={() => void runBulk(bulkConfirm.action)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "#10b981" }}
              >
                重複疑いを含めて{selected.size}件を承認
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 同意管理タブ ── */}
      {tab === "consents" && (
        <div className="space-y-3">
          <p className="text-xs rounded-lg px-3 py-2" style={{ background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b40" }}>
            オプトインは契約・覚書に基づいて設定してください（備考に契約根拠を残す）。
            オプトアウトすると、その自治体の供出済みコーパス行は<b>すべて削除</b>されます。
          </p>
          {consents === null ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>
          ) : (
            consents.map((m) => (
              <div key={m.municipality_id} className="rounded-xl p-3 flex flex-wrap items-center gap-3" style={card}>
                <div className="min-w-[160px]">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {m.name}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    供出済み: 施策{m.contributed_measures}件 / エビデンス{m.contributed_evidence}件
                    {m.updated_at && ` / 更新 ${m.updated_at.slice(0, 10)}`}
                  </p>
                </div>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={
                    m.opted_in
                      ? { background: "#10b98122", color: "#10b981" }
                      : { background: "#94a3b822", color: "#94a3b8" }
                  }
                >
                  {m.opted_in ? "オプトイン" : "未同意"}
                </span>
                <input
                  className={`${inputClass} flex-1 min-w-[180px]`}
                  style={inputStyle}
                  placeholder="備考（契約番号・覚書の日付など）"
                  defaultValue={m.note ?? ""}
                  onChange={(e) =>
                    setConsentNotes((prev) => ({ ...prev, [m.municipality_id]: e.target.value }))
                  }
                />
                {m.opted_in ? (
                  optoutArm === m.municipality_id ? (
                    <button
                      disabled={busy === m.municipality_id}
                      onClick={() => void setConsent(m, false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                      style={{ background: "#ef4444" }}
                    >
                      本当に解除（供出済み{m.contributed_measures + m.contributed_evidence}件を削除）
                    </button>
                  ) : (
                    <button
                      onClick={() => setOptoutArm(m.municipality_id)}
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ color: "#f87171", border: "1px solid #ef444440" }}
                    >
                      オプトアウト…
                    </button>
                  )
                ) : (
                  <button
                    disabled={busy === m.municipality_id}
                    onClick={() => void setConsent(m, true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                    style={{ background: "#10b981" }}
                  >
                    オプトインにする
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
