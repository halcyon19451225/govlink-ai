"use client";

/**
 * 主要施策評価（計画期間・図7v2）の一覧と起動 — CA2-3。
 *
 * 施策ごとに、取組評価の状況・未消化の委任・評価履歴・処遇を出す。
 * 承認すると指標スナップショットが凍結される（サーバー側）。
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MeasureEvaluationWizard from "@/components/program-eval/MeasureEvaluationWizard";
import DueSchedulePanel from "@/components/program-eval/DueSchedulePanel";
import type { DueItem } from "@/lib/evaluation/duecheck";
import { fiscalYearLabel } from "@/lib/measure/indicators";
import type { DelegationRow, MeasureEvalRow, MeasureRow, WorkEvalSummary } from "./page";

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "下書き", color: "#94a3b8" },
  in_review: { label: "レビュー中", color: "#fbbf24" },
  approved: { label: "承認済み", color: "#34d399" },
};

const DIRECTION_LABEL: Record<string, { label: string; color: string }> = {
  continue: { label: "継続", color: "#818cf8" },
  revise: { label: "改変", color: "#fbbf24" },
  merge: { label: "統合", color: "#fbbf24" },
  abolish: { label: "廃止", color: "#f87171" },
};

function currentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

export default function MeasureEvaluationClient({
  project,
  measures,
  evaluations,
  workEvals,
  delegations,
  benchmarkCounts,
  dueItems,
}: {
  project: { id: string; title: string; plan_start_date: string | null; plan_end_date: string | null };
  measures: MeasureRow[];
  evaluations: MeasureEvalRow[];
  workEvals: WorkEvalSummary[];
  delegations: DelegationRow[];
  benchmarkCounts: { measure_design_id: string; n: number }[];
  dueItems: DueItem[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<MeasureRow | null>(null);
  const [busyEval, setBusyEval] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fiscalYear = useMemo(() => {
    const fy = currentFiscalYear();
    const start = project.plan_start_date ? Number(project.plan_start_date.slice(0, 4)) : fy;
    return Math.max(fy, start);
  }, [project.plan_start_date]);

  const evalsByMeasure = useMemo(() => {
    const m = new Map<string, MeasureEvalRow[]>();
    for (const e of evaluations) {
      if (!e.measure_design_id) continue;
      const list = m.get(e.measure_design_id);
      if (list) list.push(e);
      else m.set(e.measure_design_id, [e]);
    }
    return m;
  }, [evaluations]);

  const openDelegationsFor = (measureId: string) =>
    delegations.filter(
      (d) => d.status === "open" && d.level === "to_measure" && d.measure_design_id === measureId,
    );
  const carriedOverFor = (measureId: string) =>
    delegations.filter((d) => d.status === "carried_over" && d.measure_design_id === measureId);

  /** 評価報告書（docx）をダウンロードする — CA2-5 */
  const downloadReport = async (evalId: string) => {
    if (reportBusy) return;
    setReportBusy(evalId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/evaluations/${evalId}/report`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "報告書の出力に失敗しました");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const name = m?.[1] ? decodeURIComponent(m[1]) : "評価報告書.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setReportBusy(null);
    }
  };

  const advanceStatus = async (evalRow: MeasureEvalRow, next: "in_review" | "approved") => {
    if (busyEval) return;
    if (
      next === "approved" &&
      !confirm("この評価を承認しますか？\n承認すると、判定に使った指標の実績が凍結されます。")
    )
      return;
    setBusyEval(evalRow.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/evaluations/${evalRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) setError(json.error ?? "更新に失敗しました");
      else router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusyEval(null);
    }
  };

  if (active) {
    return (
      <div className="p-6 max-w-4xl">
        <MeasureEvaluationWizard
          projectId={project.id}
          measure={active}
          fiscalYear={fiscalYear}
          workEvals={workEvals.filter((w) => w.measure_design_id === active.id)}
          openDelegations={openDelegationsFor(active.id)}
          onClose={() => setActive(null)}
          onSaved={() => {
            setActive(null);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">主要施策評価（計画期間）</h2>
        <p className="text-xs text-slate-500 mt-1">
          主要施策毎に、一計画期間の評価（図7）を回します。中間アウトカム指標が確定したタイミングで、
          取組評価から委任された課題を踏まえて実施します。目的は次期計画における処遇
          （廃止・改変・統合・継続）の決定と、次期計画の主要施策形成での効果性向上、
          そして計画全体の見直しが要る課題を次期のニーズ評価・セオリー評価へ引き継ぐことです。
        </p>
      </div>

      {/* 評価予定（CA2-4）— 中間アウトカム指標の評価時点が実施タイミングの正本 */}
      <DueSchedulePanel
        items={dueItems}
        level="measure"
        onStart={(item) => {
          const m = measures.find((x) => x.id === item.measure_design_id);
          if (m) setActive(m);
        }}
      />

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {measures.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm text-slate-500">
            評価できる主要施策がまだありません。施策構築（EBPM）で施策を確定すると、ここに並びます。
          </p>
        </div>
      )}

      {measures.map((m) => {
        const evals = evalsByMeasure.get(m.id) ?? [];
        const works = workEvals.filter((w) => w.measure_design_id === m.id);
        const approvedWorks = works.filter((w) => w.status === "approved").length;
        const open = openDelegationsFor(m.id);
        const carried = carriedOverFor(m.id);
        const bm = benchmarkCounts.find((b) => b.measure_design_id === m.id)?.n ?? 0;
        const latestDirection = evals
          .map((e) => e.flow_decision_path?.answers?.find((a) => a.step_id === "policy_direction"))
          .find(Boolean);

        return (
          <section
            key={m.id}
            className="rounded-2xl border"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <header className="px-4 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold text-slate-200">{m.title}</h3>
              <div className="flex items-center gap-2">
                {latestDirection && DIRECTION_LABEL[latestDirection.value] && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      background: `${DIRECTION_LABEL[latestDirection.value]!.color}18`,
                      color: DIRECTION_LABEL[latestDirection.value]!.color,
                      border: `1px solid ${DIRECTION_LABEL[latestDirection.value]!.color}40`,
                    }}
                  >
                    次期の処遇: {DIRECTION_LABEL[latestDirection.value]!.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setActive(m)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ background: "#6366f1", color: "#fff" }}
                >
                  ▶ 図7評価を開始
                </button>
              </div>
            </header>
            <div className="p-4 space-y-2">
              <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                <span>取組評価 {works.length}件（承認済み {approvedWorks}件）</span>
                <span style={{ color: open.length > 0 ? "#fbbf24" : undefined }}>
                  未消化の委任 {open.length}件
                </span>
                {carried.length > 0 && <span>次期へ引き継ぎ {carried.length}件</span>}
                <span>比較先 {bm}件{bm === 0 && "（他団体比較の工程は飛ばされます）"}</span>
              </div>

              {open.length > 0 && (
                <div className="rounded-lg border px-3 py-2" style={{ borderColor: "#f59e0b50", background: "#f59e0b0d" }}>
                  <p className="text-[11px] font-semibold" style={{ color: "#fbbf24" }}>
                    取組評価から委任された課題
                  </p>
                  {open.map((d) => (
                    <p key={d.id} className="text-[11px] text-slate-300 mt-0.5">
                      ・{d.work_code && <span className="font-mono text-slate-500">{d.work_code} </span>}{d.title}
                    </p>
                  ))}
                </div>
              )}

              {evals.map((e) => {
                const meta = STATUS_META[e.status] ?? STATUS_META.draft!;
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 text-[11px] flex-wrap rounded-lg border px-2.5 py-1.5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span className="text-slate-400 shrink-0">
                      {e.fiscal_year != null ? fiscalYearLabel(e.fiscal_year) : "年度なし"}
                    </span>
                    <span
                      className="px-1.5 rounded-full font-semibold shrink-0"
                      style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}40` }}
                    >
                      {meta.label}
                      {e.approved_snapshot_at && " ・凍結"}
                    </span>
                    <span className="text-slate-500 truncate flex-1" title={e.result ?? ""}>
                      {e.result ?? ""}
                    </span>
                    {e.status === "draft" && (
                      <button
                        type="button"
                        disabled={busyEval === e.id}
                        onClick={() => void advanceStatus(e, "in_review")}
                        className="text-indigo-400 shrink-0 disabled:opacity-50"
                      >
                        レビューへ
                      </button>
                    )}
                    {e.status === "in_review" && (
                      <button
                        type="button"
                        disabled={busyEval === e.id}
                        onClick={() => void advanceStatus(e, "approved")}
                        className="shrink-0 disabled:opacity-50"
                        style={{ color: "#34d399" }}
                      >
                        承認する
                      </button>
                    )}
                    {/* 報告書（CA2-5）— 未承認でも出せるが本文に「暫定」と刷られる */}
                    <button
                      type="button"
                      disabled={reportBusy === e.id}
                      onClick={() => void downloadReport(e.id)}
                      className="text-slate-400 shrink-0 disabled:opacity-50"
                      title="この評価の報告書をWordで出力"
                    >
                      {reportBusy === e.id ? "作成中…" : "📄 報告書"}
                    </button>
                  </div>
                );
              })}
              {evals.length === 0 && (
                <p className="text-[11px] text-slate-500">この施策の計画期間評価はまだありません。</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
