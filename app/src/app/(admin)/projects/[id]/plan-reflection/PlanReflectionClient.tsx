"use client";

/**
 * 次期計画への反映 — タブ: H1 評価総括表 → G1 対応表 → G4 諮問事項整理書（＋H4）→ G2 反映状況報告書 → H3 未反映事項台帳
 * H1 は全様式の最上流（転記元）。表は実データ（reflectionData）から組み、判定は保存値を写すだけ。
 */

import { useState } from "react";
import { ROUTE_META } from "@/lib/evaluation/judgment";
import { fiscalYearLabel } from "@/lib/measure/indicators";
import type { H1Data, H1IndicatorCell, H1Row } from "@/lib/evaluation/reflectionData";

const TABS = [
  { id: "h1", label: "H1 評価総括表", stage: "段階1" },
  { id: "g1", label: "G1 評価・計画対応表", stage: "段階1〜4" },
  { id: "g4", label: "G4 諮問事項整理書", stage: "段階2" },
  { id: "g2", label: "G2 反映状況報告書", stage: "段階5" },
  { id: "h3", label: "H3 未反映事項台帳", stage: "段階6" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const card: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

function Cell({ c, primary }: { c: H1IndicatorCell | null; primary?: boolean }) {
  if (!c) return <span className="text-slate-600">－（未設定）</span>;
  const color = c.achieved === "○" ? "#34d399" : c.achieved === "×" ? "#f87171" : "#94a3b8";
  return (
    <span>
      {primary && <span className="text-indigo-400 mr-1" title="主たる中間アウトカム">◎</span>}
      <span className="text-slate-300">{c.label}</span>
      <span className="text-slate-500">: {c.target} → </span>
      <span className="text-slate-100 font-semibold">{c.result}</span>
      <span className="ml-1 font-bold" style={{ color }}>{c.achieved}</span>
      {c.shared && <span className="ml-1 text-[10px]" style={{ color: "#fbbf24" }}>共有</span>}
    </span>
  );
}

function JudgmentCell({ r }: { r: H1Row }) {
  const j = r.judgment;
  if (!j) return <span className="text-slate-600">－（データなし）</span>;
  return (
    <span>
      <span className="font-mono text-slate-200">{j.path}</span>
      <span className="text-slate-500"> → </span>
      {j.report_no ? (
        <span style={{ color: "#818cf8" }}>No.{j.report_no} {j.report_title}{j.route && `（${j.route} ${ROUTE_META[j.route].name}）`}</span>
      ) : (
        <span style={{ color: "#fbbf24" }}>判定保留</span>
      )}
      {!j.frozen && <span className="ml-1 text-[10px]" style={{ color: "#fbbf24" }}>【暫定】</span>}
      <span className="block text-[10px] text-slate-500">
        {j.fiscal_year != null ? fiscalYearLabel(j.fiscal_year) : ""} {j.status === "approved" ? "承認済み" : j.status === "in_review" ? "レビュー中" : "下書き"}
      </span>
    </span>
  );
}

export default function PlanReflectionClient({ projectId, h1 }: { projectId: string; h1: H1Data }) {
  const [tab, setTab] = useState<TabId>("h1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async (path: string, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-reflection/${path}`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "出力に失敗しました");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] ? decodeURIComponent(m[1]) : fallback;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-100">次期計画への反映（収束工程）</h2>
        <p className="text-xs text-slate-500 mt-1">
          期末評価の結果を次期計画へ流し込む工程。判定・処遇は主要施策評価が保存した値をそのまま写し、
          手で起こすのは理由書（H4）・G4⑧〜⑫・反映箇所・注記だけです（転記ゼロ）。現行計画の施策データは書き換えません。
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{
                background: active ? "#6366f118" : "var(--bg-secondary)",
                border: `1px solid ${active ? "#6366f1" : "var(--border)"}`,
                color: active ? "#818cf8" : "#94a3b8",
              }}
            >
              {t.label} <span className="text-[10px] opacity-70">{t.stage}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {tab === "h1" && (
        <section className="rounded-2xl border" style={card}>
          <header className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-semibold text-slate-200">様式H1 評価総括表</h3>
            <span className="text-[11px] text-slate-500">
              {h1.plan_period} ／ 指標セット {h1.rows.length}件 ／ 判定あり {h1.judged_count}施策・保留 {h1.pending_count}施策・未評価 {h1.measures.length - h1.judged_count - h1.pending_count}施策
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void download("h1", "様式H1_評価総括表.docx")}
              className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: "#6366f1", color: "#fff" }}
            >
              {busy ? "作成中…" : "📄 H1をWordで出力"}
            </button>
          </header>
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-slate-500">
              1行1指標セット（アウトプット No.6 → 初期 No.7 → 中間 No.8）。達否は最新実績と目標値から（○達成 ×未達 －判定不能）。
              判定は主要施策評価の保存値（承認済み＞レビュー中＞下書き）。事業費・財政効果率は施策計。
            </p>
            {h1.rows.length === 0 ? (
              <p className="text-xs text-slate-500">施策がまだありません。施策構築（EBPM）で施策と指標を設定すると、ここに並びます。</p>
            ) : (
              <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-[11px]" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left px-2 py-1 font-medium w-10">No.</th>
                      <th className="text-left px-2 py-1 font-medium">施策・取組</th>
                      <th className="text-left px-2 py-1 font-medium">アウトプット</th>
                      <th className="text-left px-2 py-1 font-medium">初期アウトカム</th>
                      <th className="text-left px-2 py-1 font-medium">中間アウトカム</th>
                      <th className="text-left px-2 py-1 font-medium">評価過程→報告書</th>
                      <th className="text-right px-2 py-1 font-medium">事業費／効果率</th>
                      <th className="text-left px-2 py-1 font-medium w-10">段</th>
                      <th className="text-left px-2 py-1 font-medium">注記</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h1.rows.map((r) => (
                      <tr key={r.set_no} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                        <td className="px-2 py-1.5 font-mono text-slate-500">{r.set_no}</td>
                        <td className="px-2 py-1.5">
                          <span className="text-slate-200">{r.measure_title}</span>
                          {r.work_code && <span className="block text-slate-400"><span className="font-mono text-slate-500">{r.work_code}</span> {r.work_title}</span>}
                        </td>
                        <td className="px-2 py-1.5"><Cell c={r.output} /></td>
                        <td className="px-2 py-1.5"><Cell c={r.initial} /></td>
                        <td className="px-2 py-1.5">
                          <Cell c={r.intermediate} primary={r.primary} />
                          {r.intermediate && <span className="block text-[10px] text-slate-500">基準値 {r.intermediate.baseline}</span>}
                        </td>
                        <td className="px-2 py-1.5"><JudgmentCell r={r} /></td>
                        <td className="px-2 py-1.5 text-right text-slate-300">
                          {r.cost_total != null ? `¥${r.cost_total.toLocaleString()}` : "—"}
                          <span className="block" style={{ color: r.fiscal_mark === "J" ? "#34d399" : r.fiscal_mark === "K" ? "#fbbf24" : "#64748b" }}>
                            {r.fiscal_rate != null ? `${r.fiscal_rate}%（${r.fiscal_mark}）` : "算定不能"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-300">{r.comparison_grade ?? "—"}</td>
                        <td className="px-2 py-1.5 text-slate-500">
                          {r.auto_notes.map((n, i) => <span key={i} className="block">{n}</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-300 mb-1">施策単位の集約（主たる中間アウトカム／最重ルート B&gt;D&gt;C&gt;A）</p>
              <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-[11px]" style={{ minWidth: 800 }}>
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left px-2 py-1 font-medium">施策</th>
                      <th className="text-right px-2 py-1 font-medium">セット</th>
                      <th className="text-left px-2 py-1 font-medium">判定→報告書</th>
                      <th className="text-left px-2 py-1 font-medium">ルート</th>
                      <th className="text-left px-2 py-1 font-medium">標準処遇</th>
                      <th className="text-left px-2 py-1 font-medium">決定処遇（事務局案）</th>
                      <th className="text-left px-2 py-1 font-medium">理由書</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h1.measures.map((m) => (
                      <tr key={m.measure_id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                        <td className="px-2 py-1.5 text-slate-200">{m.measure_title}</td>
                        <td className="px-2 py-1.5 text-right text-slate-400">{m.sets}</td>
                        <td className="px-2 py-1.5">
                          {m.judgment ? (
                            <span>
                              <span className="font-mono text-slate-200">{m.judgment.path}</span>
                              <span className="text-slate-500"> → </span>
                              {m.judgment.report_no ? <span style={{ color: "#818cf8" }}>No.{m.judgment.report_no} {m.judgment.report_title}</span> : <span style={{ color: "#fbbf24" }}>判定保留</span>}
                            </span>
                          ) : (
                            <span className="text-slate-600">－（データなし）</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-300">
                          {m.judgment?.route ? `${m.judgment.route} ${ROUTE_META[m.judgment.route].name}` : m.exemption ? "適用除外" : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-slate-300">{m.judgment?.standard_treatment ?? "—"}</td>
                        <td className="px-2 py-1.5 text-slate-300">{m.judgment?.decided_treatment ?? "—"}</td>
                        <td className="px-2 py-1.5">{m.judgment?.rationale_required ? <span style={{ color: "#fbbf24" }}>○ 要</span> : <span className="text-slate-600">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab !== "h1" && (
        <section className="rounded-2xl border p-6" style={card}>
          <p className="text-sm text-slate-300 font-semibold">{TABS.find((t) => t.id === tab)?.label}</p>
          <p className="text-xs text-slate-500 mt-1">
            この様式は次のフェーズで実装します（G1 → G4（＋H4）→ G2 → H3 の順）。転記元となるH1の判定が揃っていることが前提です。
          </p>
        </section>
      )}
    </div>
  );
}
