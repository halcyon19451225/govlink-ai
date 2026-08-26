"use client";

/**
 * 計画書・評価報告書の調製 — PL2 P③ / PL3 A①
 *
 * 流れ（両文書とも共通）:
 *   1. 「章立てを起こす」… 実データから定型章の下書きをAI生成（locked章は上書きしない）
 *   2. 章ごとに編集・🔒ロック・AIリライト（指示つき）
 *   3. 「確定」でスナップショット固定（確定済み評価報告書は P② 経路1の入力になる）
 *   4. 出力 — 計画書: docx 本編/簡易版/概要版。評価報告書: docx＋印刷ビュー
 *      （window.print → 「送信先: PDFに保存」。jsPDFの日本語化け対策と同方式）
 *   数値の表は出力時に実データから自動挿入（AIに数値を書かせない）
 */

import { useCallback, useEffect, useState } from "react";
import { parseMdLite, type PlanSection } from "@/lib/plan/document";
import { PRINT_BASE_CSS } from "@/lib/print/printCss";

type DocKind = "plan" | "eval";

interface ChapterDef {
  id: string;
  heading: string;
  brief: string;
}

interface DocInfo {
  id: string;
  title: string;
  status: "draft" | "finalized";
  sections: PlanSection[];
  generated_at: string | null;
  finalized_at: string | null;
  updated_at: string | null;
}

interface ExportRow {
  id: string;
  variant: string;
  file_name: string;
  file_size_bytes: number | null;
  created_at: string;
}

interface EvalTables {
  kpis: { label: string; tier: string; unit: string; baseline: number | null; current: number | null; target: number | null; rate: number | null; achieved: boolean }[];
  evaluations: { measure: string; tier: string; fiscal_year: number | null; result: string }[];
  improvements: { title: string; root_cause: string | null; status: string; due_date: string | null }[];
}

const card: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
};

const PLAN_VARIANTS: { key: string; label: string; hint: string }[] = [
  { key: "full", label: "📘 本編", hint: "全章・表紙・目次・ページ番号" },
  { key: "simple", label: "📗 簡易版", hint: "章の要約＋KPI表＋施策一覧" },
  { key: "digest", label: "📙 概要版", hint: "A4見開き2〜4頁（目標・施策マップ・工程表）" },
];

const EVAL_VARIANTS: { key: string; label: string; hint: string }[] = [
  { key: "evaluation_report", label: "📊 評価報告書", hint: "全章・表紙・目次・達成状況表・改善一覧" },
];

const TIER_LABEL: Record<string, string> = {
  outcome_initial: "短期",
  outcome_intermediate: "中間",
  outcome_long: "長期",
  process: "プロセス",
  efficiency: "効率",
};

const IMPROVEMENT_STATUS: Record<string, string> = {
  proposed: "提案",
  adopted: "採用",
  in_progress: "実施中",
  done: "完了",
  dropped: "見送り",
};

const fmtSize = (n: number | null): string =>
  n == null ? "—" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

// ── 印刷ビュー（評価報告書。自己評価シートと同じ window.print 方式・共通CSS） ──

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mdToHtml(md: string): string {
  return parseMdLite(md)
    .map((b) => {
      if (b.kind === "heading") return `<h${b.level}>${escHtml(b.text)}</h${b.level}>`;
      if (b.kind === "bullet") return `<ul>${b.items.map((x) => `<li>${escHtml(x)}</li>`).join("")}</ul>`;
      if (b.kind === "numbered") return `<ol>${b.items.map((x) => `<li>${escHtml(x)}</li>`).join("")}</ol>`;
      return `<p>${escHtml(b.text)}</p>`;
    })
    .join("");
}

function htmlTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  return `<table><thead><tr>${headers.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function printEvalReport(docInfo: DocInfo, tables: EvalTables | null, projectTitle: string) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    alert("ポップアップがブロックされました。ブラウザの設定で許可してください。");
    return;
  }
  const num = (v: number | null): string => (v == null ? "—" : `${v}`);
  const kpiTable = tables
    ? htmlTable(
        ["指標", "層", "基準値", "現在値", "目標値", "到達度", "判定"],
        tables.kpis.map((k) => [
          k.label,
          TIER_LABEL[k.tier] ?? k.tier,
          num(k.baseline),
          `${num(k.current)}${k.unit}`,
          `${num(k.target)}${k.unit}`,
          k.rate == null ? "—" : `${Math.round(k.rate * 10) / 10}%`,
          k.achieved ? "達成" : "未達",
        ]),
      )
    : "";
  const evalTable = tables
    ? htmlTable(
        ["評価対象", "層", "年度", "評価結果（判断経路の要約）"],
        tables.evaluations.map((e) => [e.measure, TIER_LABEL[e.tier] ?? e.tier, e.fiscal_year == null ? "—" : `${e.fiscal_year}`, e.result]),
      )
    : "";
  const impTable = tables
    ? htmlTable(
        ["改善アクション", "真因", "状況", "期限"],
        tables.improvements.map((a) => [a.title, a.root_cause ?? "—", IMPROVEMENT_STATUS[a.status] ?? a.status, a.due_date ?? "—"]),
      )
    : "";

  const chaptersHtml = docInfo.sections
    .map((s, i) => {
      const auto =
        s.id === "kpi_status" ? kpiTable : s.id === "measure_results" ? evalTable : s.id === "improvements" ? impTable : "";
      const src = s.source_refs.length > 0 ? `<p class="src">出典: ${escHtml(s.source_refs.join(" / "))}</p>` : "";
      return `<section class="chapter"><h2>第${i + 1}章 ${escHtml(s.heading)}</h2>${mdToHtml(s.body_md || "（未作成）")}${auto}${src}</section>`;
    })
    .join("");

  win.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>${escHtml(docInfo.title)}</title>
<style>${PRINT_BASE_CSS}</style></head><body>
  <p class="proj">${escHtml(projectTitle)}</p>
  <h1>${escHtml(docInfo.title)}</h1>
  ${chaptersHtml}
  <p class="note">※ 到達度 = 基準値からの前進量（目標の向きを考慮した統一計算）</p>
  <p class="foot">評価結果報告書 ／ ${new Date().toLocaleDateString("ja-JP")} 出力${docInfo.status === "finalized" ? "（確定済み）" : "（下書き）"}</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
  win.document.close();
}

// ── 本体 ──────────────────────────────────────────────────

export default function PlanDocumentClient({
  projectId,
  projectTitle,
  docKind,
}: {
  projectId: string;
  projectTitle: string;
  docKind: DocKind;
}) {
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [chapters, setChapters] = useState<ChapterDef[]>([]);
  const [tables, setTables] = useState<EvalTables | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState<Record<string, string>>({});

  const isEval = docKind === "eval";
  const docLabel = isEval ? "評価報告書" : "計画書";
  const finalized = doc?.status === "finalized";
  const variants = isEval ? EVAL_VARIANTS : PLAN_VARIANTS;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document?doc=${docKind}`);
      const json = (await res.json()) as {
        data: { doc: DocInfo | null; exports: ExportRow[]; chapters: ChapterDef[]; tables: EvalTables | null } | null;
        error: string | null;
      };
      if (res.ok && json.data) {
        setDoc(json.data.doc);
        setExports(json.data.exports);
        setChapters(json.data.chapters);
        setTables(json.data.tables);
        setDirty(false);
      } else {
        setError(json.error ?? "読み込みに失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [projectId, docKind]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── 生成 ─────────────────────────────────────
  const generate = async () => {
    if (dirty && !window.confirm("未保存の編集があります。生成前に破棄されますが続けますか？（🔒ロック済みの章は生成でも守られます）")) return;
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: docKind }),
      });
      const json = (await res.json()) as { data: { generated: number } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "生成に失敗しました");
        return;
      }
      setNotice(`章立ての下書きを生成しました（${json.data.generated}章）。内容を確認し、必要に応じて編集・リライトしてください`);
      await load();
    } catch {
      setError("通信エラーが発生しました（生成には1〜2分かかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  // ── 保存（title / sections） ──────────────────
  const save = async () => {
    if (!doc) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: docKind, title: doc.title, sections: doc.sections }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      setNotice("保存しました");
      setDirty(false);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 確定 / 解除 ───────────────────────────────
  const setFinalize = async (finalize: boolean) => {
    if (finalize && dirty) {
      setError("未保存の編集があります。先に保存してください");
      return;
    }
    const confirmMsg = isEval
      ? "評価報告書を確定します。確定中は編集・生成・リライトができません（解除は可能）。確定済みの報告書は次期計画の引き継ぎ取り込みの入力になります。よろしいですか？"
      : "計画書を確定します。確定中は編集・生成・リライトができません（解除は可能）。よろしいですか？";
    if (finalize && !window.confirm(confirmMsg)) return;
    setBusy("finalize");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: docKind, finalize }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      setNotice(finalize ? `${docLabel}を確定しました` : "確定を解除しました（編集できます）");
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 章の編集ヘルパ ────────────────────────────
  const updateSection = (id: string, patch: Partial<PlanSection>) => {
    setDoc((prev) =>
      prev
        ? { ...prev, sections: prev.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
        : prev,
    );
    setDirty(true);
  };

  // ── リライト ─────────────────────────────────
  const rewrite = async (sectionId: string) => {
    const instruction = (rewriteInstruction[sectionId] ?? "").trim();
    if (!instruction) {
      setError("リライトの指示を入力してください（例: もっと簡潔に / 事実と解釈を分けて）");
      return;
    }
    if (dirty) {
      setError("未保存の編集があります。リライトの前に保存してください");
      return;
    }
    setBusy(`rewrite:${sectionId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: docKind, section_id: sectionId, instruction }),
      });
      const json = (await res.json()) as { data: { sections: PlanSection[] } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "リライトに失敗しました");
        return;
      }
      setDoc((prev) => (prev ? { ...prev, sections: json.data!.sections } : prev));
      setRewriteInstruction((prev) => ({ ...prev, [sectionId]: "" }));
      setNotice("章を書き直しました（内容を確認してください。元に戻す場合は再度指示するか手動で修正）");
      setDirty(false);
    } catch {
      setError("通信エラーが発生しました（リライトには時間がかかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  // ── docx出力 ─────────────────────────────────
  const download = async (variant: string) => {
    if (dirty) {
      setError("未保存の編集があります。出力の前に保存してください");
      return;
    }
    setBusy(`export:${variant}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "出力に失敗しました");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''(.+)$/);
      const fileName = m ? decodeURIComponent(m[1]!) : `${projectTitle}.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`${fileName} をダウンロードしました（出力履歴にも残ります）`);
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const redownload = async (exp: ExportRow) => {
    setBusy(`redownload:${exp.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/exports/${exp.id}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "ファイルの取得に失敗しました");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exp.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 表示 ─────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl p-6 text-sm" style={card}>
        読み込み中…
      </div>
    );
  }

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

      {/* ── 操作バー ── */}
      <div className="rounded-2xl p-4" style={card}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void generate()}
            disabled={busy != null || finalized}
            className="neu-button px-4 py-2 text-sm font-semibold"
            style={{ color: "#6366f1", opacity: busy != null || finalized ? 0.5 : 1 }}
          >
            {busy === "generate" ? "生成中…（1〜2分）" : doc ? "🪄 章立てを起こし直す" : "🪄 章立てを起こす"}
          </button>
          {doc && (
            <>
              <button
                onClick={() => void save()}
                disabled={busy != null || finalized || !dirty}
                className="neu-button px-4 py-2 text-sm font-semibold"
                style={{ color: dirty ? "#0891b2" : "var(--text-secondary)", opacity: busy != null || finalized || !dirty ? 0.5 : 1 }}
              >
                {busy === "save" ? "保存中…" : dirty ? "💾 保存（未保存の編集あり）" : "💾 保存済み"}
              </button>
              {finalized ? (
                <button
                  onClick={() => void setFinalize(false)}
                  disabled={busy != null}
                  className="neu-button px-4 py-2 text-sm font-semibold"
                  style={{ color: "#b45309" }}
                >
                  🔓 確定を解除
                </button>
              ) : (
                <button
                  onClick={() => void setFinalize(true)}
                  disabled={busy != null}
                  className="neu-button px-4 py-2 text-sm font-semibold"
                  style={{ color: "#0f6e56", opacity: busy != null ? 0.5 : 1 }}
                >
                  ✅ 確定する
                </button>
              )}
            </>
          )}
        </div>
        {doc ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span>
              状態:{" "}
              {finalized ? (
                <b style={{ color: "#0f6e56" }}>確定済み（{doc.finalized_at?.slice(0, 10)}）</b>
              ) : (
                <b style={{ color: "#b45309" }}>下書き</b>
              )}
            </span>
            {doc.generated_at && <span>最終生成: {doc.generated_at.slice(0, 16).replace("T", " ")}</span>}
            {doc.updated_at && <span>最終更新: {doc.updated_at.slice(0, 16).replace("T", " ")}</span>}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            {isEval
              ? "まだ評価報告書がありません。「章立てを起こす」を押すと、KPI達成状況（統一計算の到達度）・プログラム評価（図6/7の判断経路）・実験結果・改善アクション・引き継ぎパッケージから定型6章（概要と評価方法 / KPI達成状況 / 施策別評価 / 実験とエビデンス / 課題と改善 / 次期への申し送り）の下書きを生成します。達成状況などの表は出力時に実データから自動挿入されます。"
              : "まだ計画書がありません。「章立てを起こす」を押すと、この計画のKPI・課題仮説・施策・ロジックモデル・工程から定型7章（背景 / 現状と課題 / 基本方針・目標 / 施策 / ロジックモデル / 推進体制 / 評価の方法）の下書きを生成します。数値の表（KPI・施策一覧・工程表）は docx 出力時に実データから自動で挿入されます。"}
          </p>
        )}
        {isEval && doc && finalized && (
          <p className="mt-2 text-xs" style={{ color: "#0f6e56" }}>
            ✅ 確定済みの評価報告書は、次期計画の「前期からの引き継ぎ取り込み」（P②）の入力になります
          </p>
        )}
      </div>

      {/* ── タイトル ── */}
      {doc && (
        <div className="rounded-2xl p-4" style={card}>
          <label className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            {docLabel}の標題（表紙・ファイル名に使用）
          </label>
          <input
            value={doc.title}
            onChange={(e) => {
              setDoc((prev) => (prev ? { ...prev, title: e.target.value } : prev));
              setDirty(true);
            }}
            disabled={finalized}
            className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            maxLength={200}
          />
        </div>
      )}

      {/* ── 章 ── */}
      {doc &&
        doc.sections.map((s, i) => {
          const def = chapters.find((c) => c.id === s.id);
          const open = openId === s.id;
          return (
            <div key={s.id} className="rounded-2xl" style={card}>
              <button
                onClick={() => setOpenId(open ? null : s.id)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  第{i + 1}章 {s.heading}
                </span>
                {s.locked && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#fef3c7", color: "#92400e" }}>
                    🔒 ロック中（AI上書きから保護）
                  </span>
                )}
                {!s.body_md.trim() && (
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    （未作成）
                  </span>
                )}
                <span className="ml-auto text-xs" style={{ color: "var(--text-secondary)" }}>
                  {open ? "▲ 閉じる" : "▼ 開く"}
                </span>
              </button>
              {open && (
                <div className="px-4 pb-4 space-y-3">
                  {def && (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      この章の狙い: {def.brief}
                    </p>
                  )}
                  <textarea
                    value={s.body_md}
                    onChange={(e) => updateSection(s.id, { body_md: e.target.value })}
                    disabled={finalized}
                    rows={14}
                    placeholder="本文（Markdown軽量: ## 小見出し / - 箇条書き / 1. 番号付き / 段落）"
                    className="w-full rounded-xl px-3 py-2 text-sm font-mono"
                    style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  />
                  <div>
                    <label className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      要約{isEval ? "" : "（簡易版・概要版に使用）"}
                    </label>
                    <textarea
                      value={s.summary}
                      onChange={(e) => updateSection(s.id, { summary: e.target.value })}
                      disabled={finalized}
                      rows={2}
                      className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    />
                  </div>
                  {s.source_refs.length > 0 && (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      出典: {s.source_refs.join(" / ")}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={s.locked}
                        onChange={(e) => updateSection(s.id, { locked: e.target.checked })}
                        disabled={finalized}
                      />
                      🔒 この章をロック（生成・リライトで上書きしない）
                    </label>
                  </div>
                  {!finalized && !s.locked && s.body_md.trim() && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={rewriteInstruction[s.id] ?? ""}
                        onChange={(e) => setRewriteInstruction((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder={isEval ? "リライトの指示（例: 事実と解釈を分けて / 議会説明向けに簡潔に）" : "リライトの指示（例: もっと簡潔に / 住民向けにやさしい表現に）"}
                        className="flex-1 min-w-[240px] rounded-xl px-3 py-2 text-sm"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                        maxLength={2000}
                      />
                      <button
                        onClick={() => void rewrite(s.id)}
                        disabled={busy != null}
                        className="neu-button px-3 py-2 text-sm font-semibold"
                        style={{ color: "#6366f1", opacity: busy != null ? 0.5 : 1 }}
                      >
                        {busy === `rewrite:${s.id}` ? "書き直し中…" : "🪄 AIリライト"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

      {/* ── 出力 ── */}
      {doc && (
        <div className="rounded-2xl p-4" style={card}>
          <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            📥 出力
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            {isEval
              ? "KPI達成状況表（統一計算の到達度）・施策別評価表・改善アクション一覧は出力時に最新の実データから自動挿入します。"
              : "KPI表・施策一覧表・工程表は出力時に最新の実データから自動挿入します。ロジックモデル図は別紙（ロジックモデル画面から出力）。"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.key}
                onClick={() => void download(v.key)}
                disabled={busy != null}
                title={v.hint}
                className="neu-button px-4 py-2 text-sm font-semibold"
                style={{ color: "#0891b2", opacity: busy != null ? 0.5 : 1 }}
              >
                {busy === `export:${v.key}` ? "出力中…" : `${v.label}をダウンロード（docx）`}
              </button>
            ))}
            {isEval && (
              <button
                onClick={() => {
                  if (dirty) {
                    setError("未保存の編集があります。印刷の前に保存してください");
                    return;
                  }
                  printEvalReport(doc, tables, projectTitle);
                }}
                disabled={busy != null}
                title="ブラウザの印刷画面で「送信先: PDFに保存」を選ぶと日本語のままPDFになります"
                className="neu-button px-4 py-2 text-sm font-semibold"
                style={{ color: "#0f6e56", opacity: busy != null ? 0.5 : 1 }}
              >
                🖨 印刷 / PDF保存
              </button>
            )}
          </div>
          {exports.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                出力履歴（再ダウンロード可能）
              </h3>
              <div className="mt-2 space-y-1">
                {exports.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span>{exp.created_at.slice(0, 16).replace("T", " ")}</span>
                    <span className="truncate" style={{ color: "var(--text-primary)" }}>
                      {exp.file_name}
                    </span>
                    <span>{fmtSize(exp.file_size_bytes)}</span>
                    <button
                      onClick={() => void redownload(exp)}
                      disabled={busy != null}
                      className="neu-button px-2 py-1"
                      style={{ color: "#0891b2" }}
                    >
                      {busy === `redownload:${exp.id}` ? "取得中…" : "⬇ 再取得"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
