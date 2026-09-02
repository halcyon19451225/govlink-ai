"use client";

/**
 * 取組評価（年次・図6v2）の一覧と起動 — CA2-2。
 *
 * 取組（W-1…）ごとに年度別の評価状況を出し、ウィザードを起動する。
 * 承認は draft → in_review → approved。承認した時点で
 * 指標スナップショットが凍結され、No.5 実施率が実績として実体化し、
 * 該当年度の評価系PDCAチェックポイントが自動完了する（サーバー側）。
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import WorkEvaluationWizard from "@/components/program-eval/WorkEvaluationWizard";
import DueSchedulePanel from "@/components/program-eval/DueSchedulePanel";
import type { DueItem } from "@/lib/evaluation/duecheck";
import { fiscalYearLabel } from "@/lib/measure/indicators";
import type {
  DelegationCountRow,
  MeasureRow,
  WorkEvalRow,
  WorkRow,
} from "./page";

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "下書き", color: "#94a3b8" },
  in_review: { label: "レビュー中", color: "#fbbf24" },
  approved: { label: "承認済み", color: "#34d399" },
};

function currentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

export default function WorkEvaluationClient({
  project,
  measures,
  works,
  evaluations,
  delegationCounts,
  dueItems,
}: {
  project: { id: string; title: string; plan_start_date: string | null; plan_end_date: string | null };
  measures: MeasureRow[];
  works: WorkRow[];
  evaluations: WorkEvalRow[];
  delegationCounts: DelegationCountRow[];
  dueItems: DueItem[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<{ work: WorkRow; measure: MeasureRow } | null>(null);
  const [fiscalYear, setFiscalYear] = useState<number>(() => {
    const fy = currentFiscalYear();
    const start = project.plan_start_date ? Number(project.plan_start_date.slice(0, 4)) : fy;
    const end = project.plan_end_date ? Number(project.plan_end_date.slice(0, 4)) : fy;
    return Math.min(Math.max(fy, start), Math.max(start, end - 1));
  });
  const [busyEval, setBusyEval] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fiscalYears = useMemo(() => {
    const start = project.plan_start_date ? Number(project.plan_start_date.slice(0, 4)) : currentFiscalYear();
    const endRaw = project.plan_end_date ? Number(project.plan_end_date.slice(0, 4)) : start + 2;
    // 終了日が年度末（1〜3月）の年は前年度までが計画年度
    const end = project.plan_end_date && Number(project.plan_end_date.slice(5, 7)) <= 3 ? endRaw - 1 : endRaw;
    const out: number[] = [];
    for (let y = start; y <= Math.max(start, end); y++) out.push(y);
    return out;
  }, [project.plan_start_date, project.plan_end_date]);

  const evalsByWork = useMemo(() => {
    const m = new Map<string, WorkEvalRow[]>();
    for (const e of evaluations) {
      const list = m.get(e.measure_work_id);
      if (list) list.push(e);
      else m.set(e.measure_work_id, [e]);
    }
    return m;
  }, [evaluations]);

  const openDelegations = useMemo(
    () => new Map(delegationCounts.map((d) => [d.measure_work_id, d.open_count])),
    [delegationCounts],
  );

  const advanceStatus = async (evalRow: WorkEvalRow, next: "in_review" | "approved") => {
    if (busyEval) return;
    if (
      next === "approved" &&
      !confirm(
        "この評価を承認しますか？\n承認すると指標スナップショットが凍結され、No.5の実施率が実績として確定します。",
      )
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
        <WorkEvaluationWizard
          projectId={project.id}
          measure={{
            id: active.measure.id,
            title: active.measure.title,
            execution_rate_note: active.measure.execution_rate_note,
            experiment: active.measure.experiment,
          }}
          work={{ id: active.work.id, code: active.work.code, title: active.work.title }}
          fiscalYear={fiscalYear}
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-slate-100">取組評価（年次）</h2>
          <a
            href="/help/flow-fig6.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg shrink-0"
            style={{ background: "var(--bg-input)", color: "#818cf8", border: "1px solid var(--border)" }}
          >
            🗺 フロー全体図を見る
          </a>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          取組毎に、担当者レベルで年次評価（図6）を回します。目的は次年度以降の取組の効果性向上
          （初期アウトカム指標の改善）と、取組の改善だけでは解消できない課題の
          主要施策毎評価への委任です。判定材料は施策データセットの指標と実績、
          実施率はタスク完了実績からの自動集計です。
        </p>
      </div>

      {/* 評価予定（CA2-4）— 期日は指標の評価時点から出す */}
      <DueSchedulePanel
        items={dueItems}
        level="work"
        onStart={(item) => {
          const w = works.find((x) => x.id === item.measure_work_id);
          const m = w ? measures.find((x) => x.id === w.measure_design_id) : undefined;
          if (item.fiscal_year != null) setFiscalYear(item.fiscal_year);
          if (w && m) setActive({ work: w, measure: m });
        }}
      />

      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-400">対象年度</label>
        <select
          value={fiscalYear}
          onChange={(e) => setFiscalYear(Number(e.target.value))}
          className="text-xs rounded-lg border px-3 py-1.5 text-slate-100"
          style={{ background: "var(--bg-input)", borderColor: "var(--border)" }}
        >
          {fiscalYears.map((y) => (
            <option key={y} value={y}>
              {fiscalYearLabel(y)}（{y}年度）
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {measures.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm text-slate-500">
            評価できる取組がまだありません。施策構築（EBPM）でデータセット（取組・指標）を
            整えると、ここに評価の単位が並びます。
          </p>
        </div>
      )}

      {measures.map((m) => {
        const measureWorks = works.filter((w) => w.measure_design_id === m.id);
        return (
          <section
            key={m.id}
            className="rounded-2xl border"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <header className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold text-slate-200">{m.title}</h3>
            </header>
            <div className="p-4 space-y-3">
              {measureWorks.map((w) => {
                const evals = evalsByWork.get(w.id) ?? [];
                const fyEval = evals.find((e) => e.fiscal_year === fiscalYear);
                const open = openDelegations.get(w.id) ?? 0;
                return (
                  <div
                    key={w.id}
                    className="rounded-xl border p-3"
                    style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-100">
                          <span className="font-mono text-slate-500 mr-1.5">{w.code}</span>
                          {w.title}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {w.owner_department ?? "担当課未設定"}
                          {open > 0 && (
                            <span className="ml-2" style={{ color: "#fbbf24" }}>
                              委任中の課題 {open} 件（主要施策毎評価で扱われます）
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActive({ work: w, measure: m })}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
                        style={{ background: "#6366f1", color: "#fff" }}
                      >
                        {fyEval ? "▶ この年度をもう一度評価" : "▶ 図6評価を開始"}
                      </button>
                    </div>

                    {evals.length > 0 && (
                      <div className="mt-2 space-y-1.5">
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
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
