"use client";

/**
 * 主要施策評価（図7v2）のウィザード — CA2-3（設計 claude/coe-ca2-design.md §1・§6）。
 *
 * 一計画期間の単位。中間アウトカム指標（No.8）が確定したタイミングで行う。
 * 入力は取組毎評価（図6v2）から委任された課題。結論は
 *   ①次期計画での処遇（継続・改変・統合・廃止）
 *   ②計画全体のロジックモデルの見直しが要る課題の、次期計画への引き継ぎ
 */

import { useCallback, useEffect, useState } from "react";
import {
  FIG7V2,
  collectTargets,
  needsNote,
  nextAvailableStep,
  resolveNext,
  summarizePath,
  type FlowAnswer,
  type FlowStep,
} from "@/lib/evaluation/flow";
import { isAchieved } from "@/lib/stats/achievement";
import { INDICATOR_BY_NO, fiscalYearLabel } from "@/lib/measure/indicators";
import {
  latestResult,
  resultDisplay,
  type IndicatorBenchmarkRow,
  type IndicatorResultRow,
} from "@/lib/measure/results";
import type { MeasureIndicatorRow, MeasureCostYear } from "@/lib/measure/dataset";
import type { DelegationRow, MeasureRow, WorkEvalSummary } from "@/app/(admin)/projects/[id]/measure-evaluation/page";

interface DelegationDraft {
  title: string;
  detail: string;
  root_cause: string;
}

const TONE: Record<string, { color: string; bg: string }> = {
  good: { color: "#10b981", bg: "#10b98118" },
  warn: { color: "#f59e0b", bg: "#f59e0b18" },
  bad: { color: "#ef4444", bg: "#ef444418" },
  neutral: { color: "#818cf8", bg: "#6366f118" },
};

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
const inputStyle: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };
const cardStyle: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

export default function MeasureEvaluationWizard({
  projectId,
  measure,
  fiscalYear,
  workEvals,
  openDelegations,
  onClose,
  onSaved,
}: {
  projectId: string;
  measure: MeasureRow;
  fiscalYear: number;
  workEvals: WorkEvalSummary[];
  openDelegations: DelegationRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = `/api/admin/projects/${projectId}/measure-design/${measure.id}/dataset`;
  const flow = FIG7V2;

  const [indicators, setIndicators] = useState<MeasureIndicatorRow[] | null>(null);
  const [costYears, setCostYears] = useState<MeasureCostYear[]>([]);
  const [results, setResults] = useState<IndicatorResultRow[]>([]);
  const [benchmarks, setBenchmarks] = useState<IndicatorBenchmarkRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<"intro" | "steps" | "confirm">("intro");
  const [stepId, setStepId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<FlowAnswer[]>([]);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [delegations, setDelegations] = useState<DelegationDraft[]>([]);
  /** 委任されてきた課題の消化（id → addressed / carried_over） */
  const [reviewed, setReviewed] = useState<Record<string, "addressed" | "carried_over">>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [dsRes, resRes, bmRes] = await Promise.all([
        fetch(base, { cache: "no-store" }),
        fetch(`${base}/results`, { cache: "no-store" }),
        fetch(`${base}/benchmarks`, { cache: "no-store" }),
      ]);
      const ds = (await dsRes.json()) as {
        data: { indicators: MeasureIndicatorRow[]; costYears: MeasureCostYear[] } | null;
        error: string | null;
      };
      if (!ds.data) {
        setLoadError(ds.error ?? "データセットを読み込めませんでした");
        return;
      }
      setIndicators(ds.data.indicators);
      setCostYears(ds.data.costYears);
      const rj = (await resRes.json()) as { data: IndicatorResultRow[] | null };
      if (rj.data) setResults(rj.data);
      const bj = (await bmRes.json()) as { data: IndicatorBenchmarkRow[] | null };
      if (bj.data) setBenchmarks(bj.data);
    } catch {
      setLoadError("通信エラーが発生しました");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // 引き継ぎ課題で「ある」を選んだら1件目の記入欄を出す
  useEffect(() => {
    if (choice === "has" && delegations.length === 0) {
      setDelegations([{ title: "", detail: "", root_cause: "" }]);
    }
  }, [choice, delegations.length]);

  if (loadError) {
    return (
      <div className="rounded-2xl border p-6" style={cardStyle}>
        <p className="text-sm text-rose-400">{loadError}</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 mt-3">閉じる</button>
      </div>
    );
  }
  if (!indicators) {
    return (
      <div className="rounded-2xl border p-6" style={cardStyle}>
        <p className="text-sm text-slate-500">指標と実績を読み込んでいます…</p>
      </div>
    );
  }

  // 主要施策レベルの指標（図7の評価単位）
  const measureIndicators = indicators.filter((i) => !i.measure_work_id);
  const presentCats = new Set(measureIndicators.map((i) => i.category_no));
  const skipCtx = { hasBenchmark: benchmarks.length > 0, hasDelegations: openDelegations.length > 0 };

  const resultsByIndicator = new Map<string, IndicatorResultRow[]>();
  for (const r of results) {
    const list = resultsByIndicator.get(r.measure_indicator_id);
    if (list) list.push(r);
    else resultsByIndicator.set(r.measure_indicator_id, [r]);
  }
  const latestFor = (indicatorId: string): IndicatorResultRow | null =>
    latestResult(resultsByIndicator.get(indicatorId) ?? []);

  const categoryVerdict = (categoryNo: number): "met" | "not_met" | null => {
    const targets = measureIndicators.filter(
      (i) => i.category_no === categoryNo && i.target_value != null,
    );
    const judged = targets
      .map((i) => {
        const latest = latestFor(i.id);
        if (!latest || latest.value == null) return null;
        return isAchieved(latest.value, i.target_value as number, i.achievement_condition);
      })
      .filter((v): v is boolean => v != null);
    if (judged.length === 0) return null;
    return judged.every(Boolean) ? "met" : "not_met";
  };

  const systemVerdictFor = (step: FlowStep): string | null =>
    step.autoSource === "indicator" && step.autoIndicator != null
      ? categoryVerdict(step.autoIndicator)
      : null;

  const step: FlowStep | null = stepId ? (flow.steps[stepId] ?? null) : null;

  const startSteps = () => {
    setPhase("steps");
    setAnswers([]);
    setChoice("");
    setNote("");
    setStepId(nextAvailableStep(flow, null, presentCats, skipCtx));
  };

  const goNext = () => {
    if (!step) return;
    const value = step.kind === "text" ? "" : step.kind === "delegation_review" ? "reviewed" : choice;

    if ((step.kind === "choice" || step.kind === "auto" || step.kind === "delegation") && !value) {
      setError("選択してください");
      return;
    }
    if (step.kind === "delegation_review") {
      const undecided = openDelegations.filter((d) => !reviewed[d.id]);
      if (undecided.length > 0) {
        setError("委任された課題すべてに、扱いを選んでください");
        return;
      }
    }
    if (needsNote(step, value) && !note.trim()) {
      setError("補足の記入が必要です");
      return;
    }
    if (step.kind === "delegation" && value === "has" && !delegations.some((d) => d.title.trim())) {
      setError("引き継ぐ課題の名称を1件以上記入してください");
      return;
    }
    setError(null);

    const opt = step.options?.find((o) => o.value === value);
    const sys = step.kind === "auto" ? systemVerdictFor(step) : null;
    const answer: FlowAnswer = {
      step_id: step.id,
      section: step.section,
      question: step.question,
      value,
      label:
        step.kind === "delegation_review"
          ? `委任 ${openDelegations.length} 件を整理（扱った ${
              Object.values(reviewed).filter((v) => v === "addressed").length
            } 件／次期へ ${Object.values(reviewed).filter((v) => v === "carried_over").length} 件）`
          : (opt?.label ?? ""),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(step.kind === "auto" && sys != null ? { system_value: sys, overridden: value !== sys } : {}),
    };
    setAnswers([...answers, answer]);
    setNote("");
    setChoice("");

    const rawNext = resolveNext(step, value);
    const effective = rawNext ? nextAvailableStep(flow, rawNext, presentCats, skipCtx) : null;
    if (effective) setStepId(effective);
    else {
      setStepId(null);
      setPhase("confirm");
    }
  };

  const goBack = () => {
    if (answers.length === 0) {
      setPhase("intro");
      setStepId(null);
      return;
    }
    const prev = answers[answers.length - 1]!;
    setAnswers(answers.slice(0, -1));
    setPhase("steps");
    setStepId(prev.step_id);
    setChoice(prev.value);
    setNote(prev.note ?? "");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const targets = collectTargets(flow, answers);
      const planLevel = answers.find((a) => a.step_id === "plan_level_issues");
      const delegationItems =
        planLevel?.value === "has"
          ? delegations
              .filter((d) => d.title.trim())
              .map((d) => ({
                title: d.title.trim(),
                detail: d.detail.trim() || null,
                root_cause: d.root_cause.trim() || null,
                level: "to_next_plan" as const,
              }))
          : [];
      const updates = Object.entries(reviewed).map(([id, to_status]) => ({ id, to_status }));

      const res = await fetch(`/api/admin/projects/${projectId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: flow.tier,
          fiscal_year: fiscalYear,
          status: "draft",
          result: `【${measure.title}】` + summarizePath(flow, answers),
          findings: targets.findings ?? null,
          barrier_factors: targets.barrier_factors ?? null,
          improvement_actions: targets.improvement_actions ?? null,
          next_steps: targets.next_steps ?? null,
          measure_design_id: measure.id,
          delegations: delegationItems,
          delegation_updates: updates,
          flow_decision_path: {
            flow: flow.key,
            tier: flow.tier,
            answers,
            completed_at: new Date().toISOString(),
          },
        }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      onSaved();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">{flow.label} — {measure.title}</h3>
        <p className="text-xs text-slate-500 mt-1">
          {fiscalYearLabel(fiscalYear)}時点で実施 ／ {flow.cycleNote}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="text-xs px-3 py-1.5 rounded-lg shrink-0"
        style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
      >
        ✕ 閉じる
      </button>
    </div>
  );

  /** 取組評価のロールアップ表（工程2・冒頭で共通利用） */
  const rollupPanel = (
    <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <p className="text-slate-300 font-semibold mb-1">この施策の取組評価（図6）</p>
      {workEvals.length === 0 ? (
        <p className="text-slate-500">取組評価がまだありません（判断材料が不足します）。</p>
      ) : (
        workEvals.map((w, i) => (
          <p key={i} className="text-slate-400">
            <span className="font-mono text-slate-500">{w.work_code}</span>{" "}
            {w.fiscal_year != null ? fiscalYearLabel(w.fiscal_year) : ""}{" "}
            <span style={{ color: w.status === "approved" ? "#34d399" : "#94a3b8" }}>
              [{w.status === "approved" ? "承認済み" : w.status === "in_review" ? "レビュー中" : "下書き"}]
            </span>{" "}
            <span className="text-slate-500">{(w.result ?? "").slice(0, 60)}</span>
          </p>
        ))
      )}
    </div>
  );

  // ─── 冒頭（材料の確認）───────────────────────────────
  if (phase === "intro") {
    const mid = measureIndicators.filter((i) => i.category_no === 8);
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        {header}
        <p className="text-[11px] text-slate-500">
          一計画期間の評価です。中間アウトカム指標が確定したタイミングで行い、
          取組評価から委任された課題を踏まえて、次期計画での処遇を決めます。
        </p>
        <div>
          <p className="text-xs font-semibold text-slate-300 mb-1">中間アウトカム指標（No.8）</p>
          <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
            {mid.length === 0 ? (
              <p className="text-slate-500">
                中間アウトカム指標がまだありません。施策構築（EBPM）で No.8 を設定すると、判定が自動提示されます。
              </p>
            ) : (
              mid.map((i) => (
                <p key={i.id} className="text-slate-300">
                  {i.label}: 実績{" "}
                  <span className="font-semibold text-slate-100">{resultDisplay(latestFor(i.id), i.unit)}</span>
                  {" ／ 目標 "}
                  {i.target_value ?? "—"}{i.unit ?? ""}
                </p>
              ))
            )}
          </div>
        </div>
        {rollupPanel}
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: openDelegations.length ? "#f59e0b50" : "var(--border)", background: "var(--bg-primary)" }}>
          <p className="text-slate-300 font-semibold mb-1">
            取組評価から委任された課題（{openDelegations.length}件）
          </p>
          {openDelegations.length === 0 ? (
            <p className="text-slate-500">未消化の委任はありません。</p>
          ) : (
            openDelegations.map((d) => (
              <p key={d.id} className="text-slate-400">
                ・{d.work_code ? `[${d.work_code}] ` : ""}{d.title}
              </p>
            ))
          )}
        </div>
        <p className="text-[10px] text-slate-500">
          比較先（ベンチマーク）{benchmarks.length}件
          {benchmarks.length === 0 && " — 未登録のため、他団体比較の工程は飛ばされます"}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={startSteps}
            className="text-sm font-semibold px-4 py-2 rounded-lg"
            style={{ background: "#6366f1", color: "#fff" }}
          >
            設問に進む →
          </button>
        </div>
      </div>
    );
  }

  // ─── 確認・保存 ─────────────────────────────────────
  if (phase === "confirm") {
    const planLevel = answers.find((a) => a.step_id === "plan_level_issues");
    const items = planLevel?.value === "has" ? delegations.filter((d) => d.title.trim()) : [];
    const direction = answers.find((a) => a.step_id === "policy_direction");
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        {header}
        <h4 className="text-xs font-semibold text-slate-300">回答の確認</h4>
        <div className="space-y-2">
          {answers.map((a, i) => (
            <div key={i} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <p className="text-[10px] text-slate-500">{a.section}</p>
              <p className="text-xs text-slate-300">{a.question}</p>
              <p className="text-xs font-semibold text-slate-100 mt-0.5">
                {a.label || a.note}
                {a.overridden && (
                  <span className="ml-2 text-[10px]" style={{ color: "#fbbf24" }}>※システム判定を上書き</span>
                )}
              </p>
              {a.label && a.note && <p className="text-[11px] text-slate-400 mt-0.5">{a.note}</p>}
            </div>
          ))}
        </div>
        {direction && (
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "#6366f160", background: "#6366f10d" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#818cf8" }}>
              次期計画での処遇: {direction.label}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              この処遇は、改善メニューの「主要施策の再構築」の出発点になります（現行計画の施策データは書き換えません）。
            </p>
          </div>
        )}
        {items.length > 0 && (
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "#f59e0b60", background: "#f59e0b0d" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#fbbf24" }}>
              次期計画へ引き継ぐ課題（{items.length}件）
            </p>
            {items.map((d, i) => (
              <p key={i} className="text-[11px] text-slate-300 mt-1">・{d.title}</p>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-between">
          <button type="button" onClick={goBack} className="text-xs text-slate-400">← 戻る</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: "#6366f1", color: "#fff" }}
          >
            {saving ? "保存しています…" : "評価を保存する（下書き）"}
          </button>
        </div>
      </div>
    );
  }

  // ─── 設問 ───────────────────────────────────────────
  if (!step) return null;
  const sys = step.kind === "auto" ? systemVerdictFor(step) : null;
  const costIndicators = measureIndicators.filter((i) => i.category_no === 3 || i.category_no === 15);

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
      {header}
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span>回答 {answers.length + 1} 問目</span>
        <span>／ {step.section}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-100">{step.question}</p>
        {step.help && <p className="text-[11px] text-slate-500 mt-1">{step.help}</p>}
      </div>

      {/* 判定材料 */}
      {step.kind === "auto" && (
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          {measureIndicators.filter((i) => i.category_no === step.autoIndicator).length === 0 ? (
            <p className="text-slate-500">対象の指標がありません。手動で選択します。</p>
          ) : (
            measureIndicators
              .filter((i) => i.category_no === step.autoIndicator)
              .map((i) => (
                <p key={i.id} className="text-slate-300">
                  {i.label}: 実績{" "}
                  <span className="font-semibold text-slate-100">{resultDisplay(latestFor(i.id), i.unit)}</span>
                  {" ／ 目標 "}{i.target_value ?? "—"}{i.unit ?? ""}
                </p>
              ))
          )}
          {sys != null && (
            <p className="mt-1" style={{ color: "#22d3ee" }}>
              システム判定: {step.options?.find((o) => o.value === sys)?.label}
            </p>
          )}
        </div>
      )}
      {step.id === "caused_by_initial" && rollupPanel}
      {step.id === "cost_appropriate" && (
        <div className="rounded-lg border px-3 py-2 text-[11px] space-y-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          {costIndicators.map((i) => (
            <p key={i.id} className="text-slate-300">
              No.{i.category_no} {INDICATOR_BY_NO[i.category_no]?.name}: {resultDisplay(latestFor(i.id), i.unit)}
            </p>
          ))}
          {costYears.map((c) => (
            <p key={c.id} className="text-slate-500">
              {fiscalYearLabel(c.fiscal_year)}: {c.total_amount != null ? `¥${c.total_amount.toLocaleString()}` : "未入力"}
            </p>
          ))}
          {measure.execution_rate_note && (
            <p className="text-slate-500">執行率の算定式: {measure.execution_rate_note}</p>
          )}
        </div>
      )}
      {step.id === "benchmark" && (
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          <table className="w-full">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-medium">指標</th>
                <th className="text-left font-medium">比較先</th>
                <th className="text-right font-medium">比較値</th>
                <th className="text-right font-medium">自団体</th>
                <th className="text-left font-medium">出典</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b) => {
                const ind = indicators.find((i) => i.id === b.measure_indicator_id);
                const own = ind ? latestFor(ind.id) : null;
                return (
                  <tr key={b.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="text-slate-400 py-1">{ind?.label ?? "—"}</td>
                    <td className="text-slate-300">{b.comparator}</td>
                    <td className="text-right text-slate-300">{b.value}{ind?.unit ?? ""}</td>
                    <td className="text-right text-slate-100 font-semibold">{resultDisplay(own, ind?.unit ?? null)}</td>
                    <td className="text-slate-500">{b.source_name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 委任された課題の消化 */}
      {step.kind === "delegation_review" && (
        <div className="space-y-2">
          {openDelegations.map((d) => (
            <div key={d.id} className="rounded-lg border p-3" style={{ borderColor: "#f59e0b50" }}>
              <p className="text-xs font-semibold text-slate-100">
                {d.work_code && <span className="font-mono text-slate-500 mr-1.5">{d.work_code}</span>}
                {d.title}
              </p>
              {d.detail && <p className="text-[11px] text-slate-400 mt-0.5">{d.detail}</p>}
              {d.root_cause && <p className="text-[10px] text-slate-500 mt-0.5">根本原因: {d.root_cause}</p>}
              <div className="flex gap-1.5 mt-2">
                {(
                  [
                    { v: "addressed", label: "この評価で扱った", tone: "good" },
                    { v: "carried_over", label: "次期計画へ引き継ぐ", tone: "warn" },
                  ] as const
                ).map((o) => {
                  const active = reviewed[d.id] === o.v;
                  const tone = TONE[o.tone]!;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setReviewed((prev) => ({ ...prev, [d.id]: o.v }))}
                      className="text-[11px] px-2.5 py-1 rounded-lg"
                      style={{
                        background: active ? tone.bg : "var(--bg-primary)",
                        border: `1px solid ${active ? tone.color : "var(--border)"}`,
                        color: active ? tone.color : "#94a3b8",
                      }}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 選択肢 */}
      {(step.kind === "choice" || step.kind === "auto" || step.kind === "delegation") && (
        <div className="space-y-1.5">
          {step.options?.map((o) => {
            const active = choice === o.value;
            const tone = TONE[o.tone ?? "neutral"]!;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setChoice(o.value)}
                className="w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors"
                style={{
                  background: active ? tone.bg : "var(--bg-primary)",
                  border: `1px solid ${active ? tone.color : "var(--border)"}`,
                  color: active ? tone.color : "#cbd5e1",
                }}
              >
                {o.label}
                {step.kind === "auto" && sys === o.value && (
                  <span className="ml-2 text-[10px]" style={{ color: "#22d3ee" }}>← システム判定</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 次期計画へ引き継ぐ課題の記入 */}
      {step.kind === "delegation" && choice === "has" && (
        <div className="space-y-2">
          {delegations.map((d, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-1.5" style={{ borderColor: "#f59e0b50" }}>
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="課題の名称（必須）"
                value={d.title}
                onChange={(e) =>
                  setDelegations((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                }
              />
              <textarea
                className={inputClass}
                style={inputStyle}
                rows={2}
                placeholder="課題の内容 — なぜ主要施策の改善だけでは解消できないか（計画全体のロジックモデルの見直しが要る点）"
                value={d.detail}
                onChange={(e) =>
                  setDelegations((prev) => prev.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))
                }
              />
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="根本原因（わかる範囲で）"
                value={d.root_cause}
                onChange={(e) =>
                  setDelegations((prev) => prev.map((x, j) => (j === i ? { ...x, root_cause: e.target.value } : x)))
                }
              />
              <button
                type="button"
                onClick={() => setDelegations((prev) => prev.filter((_, j) => j !== i))}
                className="text-[10px] text-rose-400"
              >
                この課題を取り消す
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDelegations((prev) => [...prev, { title: "", detail: "", root_cause: "" }])}
            className="text-xs text-indigo-400"
          >
            ＋ 引き継ぐ課題を追加
          </button>
        </div>
      )}

      {/* 記述欄 */}
      {(step.kind === "text" || (choice && needsNote(step, choice) && step.kind !== "delegation")) && (
        <textarea
          className={inputClass}
          style={inputStyle}
          rows={3}
          placeholder={step.notePrompt ?? "補足を記入してください"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex justify-between">
        <button type="button" onClick={goBack} className="text-xs text-slate-400">← 戻る</button>
        <button
          type="button"
          onClick={goNext}
          className="text-sm font-semibold px-4 py-2 rounded-lg"
          style={{ background: "#6366f1", color: "#fff" }}
        >
          次へ →
        </button>
      </div>
    </div>
  );
}
