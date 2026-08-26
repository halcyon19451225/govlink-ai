"use client";

/**
 * 実績報告依頼の管理画面 — S2 C①
 *
 * 流れ:
 *   1. 依頼の作成 … 種別（年次/計画期間）・対象施策を選ぶと設問をAIが自動組成（下書き）
 *   2. 下書きの確認 … 設問・依頼文を編集 → 「送信」で対象ごとの回答URLを発行
 *      （無確認の自動送信をしない — 送信ボタンが人の確認）
 *   3. 回答状況ボード … 未回答/回答済/差し戻し/受領。URLコピー・督促記録
 *   4. 回答の確認 … 受領 or 差し戻し（理由必須）→ 受領後にKPI実績をワンクリック取り込み
 */

import { useCallback, useEffect, useState } from "react";
import { RESPONSE_STATUS, type ReportQuestion, type ReportTarget } from "@/lib/report/types";

interface MeasureRow {
  id: string;
  title: string;
  owner_department: string | null;
  status: string;
}

interface RequestSummary {
  id: string;
  kind: "annual" | "period_end";
  fiscal_year: number | null;
  due_date: string | null;
  title: string;
  status: "draft" | "sent" | "closed";
  created_at: string;
  target_count: number;
  answered_count: number;
  accepted_count: number;
}

interface ResponseRow {
  id: string;
  target_key: string;
  token: string;
  status: "pending" | "answered" | "returned" | "accepted";
  answers: Record<string, string | number>;
  answered_at: string | null;
  reviewed_note: string | null;
  imported_at: string | null;
  reminded_at: string | null;
}

interface RequestDetail {
  request: {
    id: string;
    kind: "annual" | "period_end";
    fiscal_year: number | null;
    due_date: string | null;
    title: string;
    instruction: string | null;
    form_def: ReportQuestion[];
    targets: ReportTarget[];
    status: "draft" | "sent" | "closed";
    sent_at: string | null;
  };
  responses: ResponseRow[];
}

const card: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
};

const KIND_LABEL = { annual: "年次報告", period_end: "計画期間報告" } as const;
const REQ_STATUS_LABEL = { draft: "下書き", sent: "受付中", closed: "締切" } as const;

const statusMeta = (key: string) => RESPONSE_STATUS.find((s) => s.key === key) ?? RESPONSE_STATUS[0];

export default function ReportRequestsClient({
  projectId,
  measures,
}: {
  projectId: string;
  measures: MeasureRow[];
}) {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 新規作成フォーム
  const [showNew, setShowNew] = useState(false);
  const [kind, setKind] = useState<"annual" | "period_end">("annual");
  const [fiscalYear, setFiscalYear] = useState<string>(String(new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1));
  const [dueDate, setDueDate] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 回答詳細の開閉・差し戻し理由
  const [openResponse, setOpenResponse] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/report-requests`);
      const json = (await res.json()) as { data: RequestSummary[] | null; error: string | null };
      if (res.ok && json.data) setRequests(json.data);
      else setError(json.error ?? "読み込みに失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDetail = async (requestId: string) => {
    setBusy(`open:${requestId}`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/report-requests/${requestId}`);
      const json = (await res.json()) as { data: RequestDetail | null; error: string | null };
      if (res.ok && json.data) {
        setDetail(json.data);
        setOpenResponse(null);
      } else setError(json.error ?? "読み込みに失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!title.trim()) {
      setError("依頼の標題を入力してください");
      return;
    }
    if (selected.size === 0) {
      setError("対象の施策を1つ以上選択してください");
      return;
    }
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/report-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          fiscal_year: fiscalYear ? Number(fiscalYear) : null,
          due_date: dueDate || null,
          title: title.trim(),
          measure_ids: Array.from(selected),
        }),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data?.id) {
        setError(json.error ?? "作成に失敗しました");
        return;
      }
      setNotice("設問の下書きを作成しました。内容を確認・編集してから「送信」してください");
      setShowNew(false);
      setTitle("");
      setSelected(new Set());
      await loadList();
      await openDetail(json.data.id);
    } catch {
      setError("通信エラーが発生しました（設問の組成には1分ほどかかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  const patchRequest = async (body: Record<string, unknown>, okMsg: string) => {
    if (!detail) return;
    setBusy("patch");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/report-requests/${detail.request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      setNotice(okMsg);
      await loadList();
      await openDetail(detail.request.id);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const reviewResponse = async (responseId: string, action: string, note?: string) => {
    if (!detail) return;
    setBusy(`resp:${responseId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/report-requests/${detail.request.id}/responses/${responseId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...(note ? { note } : {}) }),
        },
      );
      const json = (await res.json()) as { data: { imported?: number } | null; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "操作に失敗しました");
        return;
      }
      if (action === "import_kpi") setNotice(`KPI実績値を ${json.data?.imported ?? 0} 件取り込みました（KPI報告に登録・現在値を更新）`);
      if (action === "accept") setNotice("回答を受領しました（KPI取り込みができます）");
      if (action === "return") setNotice("差し戻しました（回答者は同じURLから再回答できます）");
      if (action === "remind") setNotice("督促日を記録しました（URLをコピーして再送してください）");
      setReturnNote("");
      await openDetail(detail.request.id);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const responseUrl = (token: string): string =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/report/${token}`;

  const copyUrl = async (token: string) => {
    try {
      await navigator.clipboard.writeText(responseUrl(token));
      setNotice("回答URLをコピーしました");
    } catch {
      setError("コピーできませんでした（URLを選択して手動でコピーしてください）");
    }
  };

  const updateQuestion = (qid: string, patch: Partial<ReportQuestion>) => {
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            request: {
              ...prev.request,
              form_def: prev.request.form_def.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
            },
          }
        : prev,
    );
  };

  const removeQuestion = (qid: string) => {
    setDetail((prev) =>
      prev
        ? { ...prev, request: { ...prev.request, form_def: prev.request.form_def.filter((q) => q.id !== qid) } }
        : prev,
    );
  };

  const targetOf = (key: string): ReportTarget | undefined => detail?.request.targets.find((t) => t.target_key === key);
  const questionsFor = (measureId: string): ReportQuestion[] =>
    (detail?.request.form_def ?? []).filter((q) => !q.measure_design_id || q.measure_design_id === measureId);

  // ── 表示 ─────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}>
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}>
          ✅ {notice}
        </div>
      )}

      {/* ── 依頼一覧＋新規 ── */}
      <div className="rounded-2xl p-4" style={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            依頼一覧
          </h2>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="neu-button px-3 py-1.5 text-sm font-semibold"
            style={{ color: "#6366f1" }}
          >
            {showNew ? "閉じる" : "＋ 依頼を作成"}
          </button>
        </div>

        {showNew && (
          <div className="mt-3 rounded-xl p-3 space-y-3" style={{ border: "1px solid var(--border)" }}>
            <div className="flex flex-wrap gap-4 text-sm" style={{ color: "var(--text-primary)" }}>
              <label className="flex items-center gap-1">
                <input type="radio" checked={kind === "annual"} onChange={() => setKind("annual")} />
                年次報告（図6の年次評価の入力）
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={kind === "period_end"} onChange={() => setKind("period_end")} />
                計画期間報告（図7の計画期間評価の入力）
              </label>
            </div>
            <div className="flex flex-wrap gap-3 items-end text-xs" style={{ color: "var(--text-secondary)" }}>
              <div>
                <label className="block mb-1">年度</label>
                <input
                  type="number"
                  value={fiscalYear}
                  onChange={(e) => setFiscalYear(e.target.value)}
                  className="w-24 rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="block mb-1">回答期限</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="block mb-1">標題</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`例: ${fiscalYear}年度 実績報告のお願い`}
                  maxLength={200}
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                対象の施策（担当課に1件ずつ回答URLを発行します）
              </p>
              <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                {measures.length === 0 && <span>（施策が未登録です）</span>}
                {measures.map((m) => (
                  <label key={m.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })
                      }
                    />
                    {m.title}
                    {m.owner_department && `（${m.owner_department}）`}
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={() => void create()}
              disabled={busy != null}
              className="neu-button px-4 py-2 text-sm font-semibold"
              style={{ color: "#6366f1", opacity: busy != null ? 0.5 : 1 }}
            >
              {busy === "create" ? "設問を組成中…（1分ほど）" : "🪄 設問をAIで組成して下書きを作成"}
            </button>
          </div>
        )}

        <div className="mt-3 space-y-1.5">
          {loading && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>}
          {!loading && requests.length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              まだ依頼がありません。「＋ 依頼を作成」から始めてください。
            </p>
          )}
          {requests.map((r) => (
            <button
              key={r.id}
              onClick={() => void openDetail(r.id)}
              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs"
              style={{
                border: "1px solid var(--border)",
                background: detail?.request.id === r.id ? "var(--bg-secondary)" : "transparent",
                cursor: "pointer",
              }}
            >
              <span
                className="px-2 py-0.5 rounded-full shrink-0"
                style={{
                  background: r.status === "sent" ? "#06b6d418" : r.status === "closed" ? "#64748b18" : "#f59e0b18",
                  color: r.status === "sent" ? "#22d3ee" : r.status === "closed" ? "#94a3b8" : "#fbbf24",
                }}
              >
                {REQ_STATUS_LABEL[r.status]}
              </span>
              <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {r.title}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>
                {KIND_LABEL[r.kind]}
                {r.fiscal_year && ` / ${r.fiscal_year}年度`}
                {r.due_date && ` / 期限 ${r.due_date}`}
              </span>
              <span className="ml-auto shrink-0" style={{ color: "var(--text-secondary)" }}>
                回答 {r.answered_count}/{r.target_count}（受領 {r.accepted_count}）
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 依頼の詳細 ── */}
      {detail && (
        <div className="rounded-2xl p-4 space-y-3" style={card}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {detail.request.title}
            </h2>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {KIND_LABEL[detail.request.kind]}
              {detail.request.fiscal_year && ` / ${detail.request.fiscal_year}年度`}
              {detail.request.due_date && ` / 期限 ${detail.request.due_date}`}
              {` / ${REQ_STATUS_LABEL[detail.request.status]}`}
            </span>
            <div className="ml-auto flex gap-2">
              {detail.request.status === "draft" && (
                <>
                  <button
                    onClick={() =>
                      void patchRequest(
                        { instruction: detail.request.instruction ?? "", form_def: detail.request.form_def },
                        "下書きを保存しました",
                      )
                    }
                    disabled={busy != null}
                    className="neu-button px-3 py-1.5 text-xs font-semibold"
                    style={{ color: "#0891b2" }}
                  >
                    💾 下書き保存
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`送信すると対象${detail.request.targets.length}件の回答URLが発行され、設問は変更できなくなります。よろしいですか？`))
                        void patchRequest({ action: "send" }, "送信しました。各対象の回答URLをコピーして担当者に共有してください");
                    }}
                    disabled={busy != null}
                    className="neu-button px-3 py-1.5 text-xs font-semibold"
                    style={{ color: "#0f6e56" }}
                  >
                    📮 送信（回答URLを発行）
                  </button>
                </>
              )}
              {detail.request.status === "sent" && (
                <button
                  onClick={() => {
                    if (window.confirm("受付を締め切ります。以降、回答フォームは受付終了の表示になります。よろしいですか？"))
                      void patchRequest({ action: "close" }, "受付を締め切りました");
                  }}
                  disabled={busy != null}
                  className="neu-button px-3 py-1.5 text-xs font-semibold"
                  style={{ color: "#b45309" }}
                >
                  ⏹ 受付を締め切る
                </button>
              )}
              {detail.request.status === "closed" && (
                <button
                  onClick={() => void patchRequest({ action: "reopen" }, "受付を再開しました")}
                  disabled={busy != null}
                  className="neu-button px-3 py-1.5 text-xs font-semibold"
                  style={{ color: "#0891b2" }}
                >
                  ▶ 受付を再開
                </button>
              )}
            </div>
          </div>

          {/* 依頼文 */}
          <div>
            <label className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              依頼文（回答フォームの冒頭に表示）
            </label>
            <textarea
              value={detail.request.instruction ?? ""}
              onChange={(e) =>
                setDetail((prev) => (prev ? { ...prev, request: { ...prev.request, instruction: e.target.value } } : prev))
              }
              disabled={detail.request.status !== "draft"}
              rows={3}
              className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
          </div>

          {/* 設問（draft中のみ編集可） */}
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              設問（{detail.request.form_def.length}問）
              {detail.request.status === "draft" ? " — 文言の修正・不要な設問の削除ができます" : ""}
            </p>
            <div className="mt-1 space-y-1">
              {detail.request.form_def.map((q) => (
                <div key={q.id} className="flex items-center gap-2 text-xs">
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded"
                    style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                  >
                    {q.type === "number" ? "数値" : q.type === "textarea" ? "記述" : "短文"}
                    {q.kpi_id ? "・KPI" : ""}
                  </span>
                  <input
                    value={q.label}
                    onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                    disabled={detail.request.status !== "draft"}
                    className="flex-1 rounded-lg px-2 py-1"
                    style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                  <span className="shrink-0 max-w-[140px] truncate" style={{ color: "var(--text-secondary)" }}>
                    {q.measure_design_id
                      ? targetOf(q.measure_design_id)?.measure_title ?? "施策"
                      : "共通"}
                    {q.unit ? ` / ${q.unit}` : ""}
                  </span>
                  {detail.request.status === "draft" && (
                    <button onClick={() => removeQuestion(q.id)} className="shrink-0" style={{ color: "#f87171" }}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 回答状況ボード（送信後） */}
          {detail.request.status !== "draft" && (
            <div>
              <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                回答状況
              </p>
              <div className="mt-1 space-y-1.5">
                {detail.responses.map((resp) => {
                  const t = targetOf(resp.target_key);
                  const meta = statusMeta(resp.status);
                  const open = openResponse === resp.id;
                  const qs = questionsFor(t?.measure_design_id ?? resp.target_key);
                  return (
                    <div key={resp.id} className="rounded-xl" style={{ border: "1px solid var(--border)" }}>
                      <div className="flex items-center gap-2 px-3 py-2 text-xs">
                        <span className="px-2 py-0.5 rounded-full shrink-0" style={{ background: `${meta.color}22`, color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {t?.measure_title ?? resp.target_key}
                        </span>
                        <span style={{ color: "var(--text-secondary)" }}>{t?.owner_department ?? ""}</span>
                        {resp.imported_at && <span style={{ color: "#34d399" }}>📊 KPI取込済</span>}
                        {resp.reminded_at && resp.status === "pending" && (
                          <span style={{ color: "var(--text-secondary)" }}>督促 {resp.reminded_at.slice(5, 10)}</span>
                        )}
                        <div className="ml-auto flex gap-1.5 shrink-0">
                          <button onClick={() => void copyUrl(resp.token)} className="neu-button px-2 py-0.5" style={{ color: "#0891b2" }}>
                            URLコピー
                          </button>
                          {resp.status === "pending" && (
                            <button
                              onClick={() => void reviewResponse(resp.id, "remind")}
                              disabled={busy != null}
                              className="neu-button px-2 py-0.5"
                              style={{ color: "#b45309" }}
                            >
                              ⏰ 督促記録
                            </button>
                          )}
                          {(resp.status === "answered" || resp.status === "accepted" || resp.status === "returned") && (
                            <button
                              onClick={() => setOpenResponse(open ? null : resp.id)}
                              className="neu-button px-2 py-0.5"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {open ? "▲ 閉じる" : "▼ 回答を見る"}
                            </button>
                          )}
                        </div>
                      </div>
                      {open && (
                        <div className="px-3 pb-3 space-y-2">
                          <div className="rounded-lg p-2 space-y-1" style={{ background: "var(--bg-secondary)" }}>
                            {qs.map((q) => (
                              <div key={q.id} className="text-xs">
                                <span style={{ color: "var(--text-secondary)" }}>{q.label}: </span>
                                <span style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                                  {resp.answers?.[q.id] !== undefined ? String(resp.answers[q.id]) : "（未回答）"}
                                  {q.unit && resp.answers?.[q.id] !== undefined ? ` ${q.unit}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                          {resp.status === "answered" && (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => void reviewResponse(resp.id, "accept")}
                                disabled={busy != null}
                                className="neu-button px-3 py-1.5 text-xs font-semibold"
                                style={{ color: "#0f6e56" }}
                              >
                                ✅ 受領する
                              </button>
                              <input
                                value={returnNote}
                                onChange={(e) => setReturnNote(e.target.value)}
                                placeholder="差し戻し理由（回答者に表示・必須）"
                                maxLength={2000}
                                className="flex-1 min-w-[200px] rounded-lg px-2 py-1.5 text-xs"
                                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                              />
                              <button
                                onClick={() => void reviewResponse(resp.id, "return", returnNote)}
                                disabled={busy != null}
                                className="neu-button px-3 py-1.5 text-xs font-semibold"
                                style={{ color: "#b45309" }}
                              >
                                🔁 差し戻す
                              </button>
                            </div>
                          )}
                          {resp.status === "accepted" && !resp.imported_at && (
                            <button
                              onClick={() => void reviewResponse(resp.id, "import_kpi")}
                              disabled={busy != null}
                              className="neu-button px-3 py-1.5 text-xs font-semibold"
                              style={{ color: "#6366f1" }}
                            >
                              📊 KPI実績値を取り込む（KPI報告に登録・現在値を更新）
                            </button>
                          )}
                          {resp.status === "returned" && resp.reviewed_note && (
                            <p className="text-xs" style={{ color: "#f59e0b" }}>
                              差し戻し理由: {resp.reviewed_note}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                回答URLは担当者・事業者にメール等で共有してください（ログイン不要）。受領した所見・課題は
                プログラム評価の参考情報にも表示されます。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
