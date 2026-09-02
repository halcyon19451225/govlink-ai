"use client";

/**
 * 主要施策評価（図7e1 ＝ 図E1をそのまま実装）のウィザード — CA2-3改。
 *
 * 一計画期間の単位。中間アウトカム指標（No.8）が確定したタイミングで行う。
 * 工程1〜4は様式集（claude/coe-eval-report-forms.md §1）の4つの問い:
 *   ①目標到達（自動・A/B） ②接近＝3か年傾向（自動・C/I） ③初期アウトカム起因（D/E）
 *   ④a 別要因の再現可能性（F/G/H）／④b 財政効果率100%以上か（自動・J/K）
 * 記号列→報告書No.→ルート→標準処遇は lib/evaluation/judgment.ts が機械的に導く。
 * 「この施策をどうするか」は裁量ではなく判定から定まり、裁量は
 * 「標準処遇に従わない理由を書く」ところにだけ置く（comply or explain・様式H4）。
 *
 * 保存する値のうち、判定・処遇・比較の段・財政効果の実績は評価側（program_evaluations・060）。
 * 施策構築(EBPM)のデータ（measure_designs / measure_indicators）はここから書き換えない。
 */

import { useCallback, useEffect, useState } from "react";
import {
  FIG7E1,
  collectTargets,
  needsNote,
  nextAvailableStep,
  resolveNext,
  summarizePath,
  type FlowAnswer,
  type FlowStep,
} from "@/lib/evaluation/flow";
import {
  COMPARISON_GRADE_META,
  EXEMPTION_META,
  ROUTE_META,
  comparisonGradeOfDesign,
  fiscalEffectRate,
  judge,
  partialPath,
  sumFiscalEffect,
  trendJudgment,
  type ComparisonGrade,
  type FiscalEffectPathwayAmount,
  type JudgmentAnswers,
  type StoredFiscalEffect,
  type StoredJudgment,
  type TrendJudgment,
} from "@/lib/evaluation/judgment";
import { judgmentAnswersFromFlow } from "@/lib/evaluation/judgmentFromFlow";
import { isAchieved } from "@/lib/stats/achievement";
import { fiscalYearLabel } from "@/lib/measure/indicators";
import {
  latestResult,
  latestResultByYear,
  resultDisplay,
  type IndicatorBenchmarkRow,
  type IndicatorResultRow,
} from "@/lib/measure/results";
import type { MeasureIndicatorRow, MeasureCostYear, MeasureJudgmentSetup } from "@/lib/measure/dataset";
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
const boxStyle: React.CSSProperties = { borderColor: "var(--border)", background: "var(--bg-primary)" };

const EMPTY_SETUP: MeasureJudgmentSetup = {
  contribution_pathways: [],
  fiscal_effect_estimates: [],
  judgment_exemption: null,
  preconditions: [],
};

/** 回答（fig7e1 の工程ID）→ 図E1の4問。judgmentFromFlow と同じ写し取り */
function judgmentSoFar(answers: FlowAnswer[]): Partial<JudgmentAnswers> | null {
  return judgmentAnswersFromFlow("fig7e1", answers).answers;
}

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
  const flow = FIG7E1;

  const [indicators, setIndicators] = useState<MeasureIndicatorRow[] | null>(null);
  const [costYears, setCostYears] = useState<MeasureCostYear[]>([]);
  const [setup, setSetup] = useState<MeasureJudgmentSetup>(EMPTY_SETUP);
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
  /** 工程3で記録する「実際に行った比較の段」（初期値は実験設計から） */
  const [comparisonGrade, setComparisonGrade] = useState<ComparisonGrade | "">("");
  /** 工程4b: 寄与経路ごとの期末実績（円）。初期値は事前推計 */
  const [actuals, setActuals] = useState<FiscalEffectPathwayAmount[]>([]);
  /** 工程7: 標準処遇と異なる決定処遇（事務局案） */
  const [decidedTreatment, setDecidedTreatment] = useState("");
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
        data: { indicators: MeasureIndicatorRow[]; costYears: MeasureCostYear[]; setup?: MeasureJudgmentSetup } | null;
        error: string | null;
      };
      if (!ds.data) {
        setLoadError(ds.error ?? "データセットを読み込めませんでした");
        return;
      }
      setIndicators(ds.data.indicators);
      setCostYears(ds.data.costYears);
      const st = ds.data.setup ?? EMPTY_SETUP;
      setSetup(st);
      // 期末実績の初期値は事前推計（担当者が期末の値に直す）
      setActuals(
        st.contribution_pathways.map((pw) => {
          const est = st.fiscal_effect_estimates.find((e) => e.pathway_key === pw.key);
          return { pathway_key: pw.key, label: pw.label, annual: est?.annual ?? null, cumulative: est?.cumulative ?? null, basis: est?.basis ?? null };
        }),
      );
      setComparisonGrade(comparisonGradeOfDesign(measure.experiment?.design) ?? "");
      const rj = (await resRes.json()) as { data: IndicatorResultRow[] | null };
      if (rj.data) setResults(rj.data);
      const bj = (await bmRes.json()) as { data: IndicatorBenchmarkRow[] | null };
      if (bj.data) setBenchmarks(bj.data);
    } catch {
      setLoadError("通信エラーが発生しました");
    }
  }, [base, measure.experiment?.design]);

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

  // 主たる中間アウトカム（No.8 の先頭）。複数ある場合はこれで一本化する（様式集 §2）
  const midIndicators = measureIndicators.filter((i) => i.category_no === 8);
  const primaryMid = midIndicators[0] ?? null;

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

  // ② 3か年傾向（主たる中間アウトカムの年度別実績）
  const trend: TrendJudgment | null = primaryMid
    ? trendJudgment(
        Array.from(latestResultByYear(resultsByIndicator.get(primaryMid.id) ?? []).entries())
          .filter(([, r]) => r.value != null)
          .map(([fiscal_year, r]) => ({ fiscal_year, value: r.value as number })),
        primaryMid.achievement_condition,
        primaryMid.target_value,
        primaryMid.baseline_value,
      )
    : null;

  // ④b 財政効果率（期末実績 ÷ 事業費累計）
  const totalCost = costYears.reduce((s, c) => s + (c.total_amount ?? 0), 0);
  const effectTotal = sumFiscalEffect(actuals);
  const fe = fiscalEffectRate({ fiscalEffect: effectTotal, totalCost: totalCost > 0 ? totalCost : null });
  const fiscalVerdict: "efficient" | "inefficient" | null =
    fe.mark === "J" ? "efficient" : fe.mark === "K" ? "inefficient" : null;

  const systemVerdictFor = (s: FlowStep): string | null => {
    if (s.autoSource === "indicator" && s.autoIndicator != null) return categoryVerdict(s.autoIndicator);
    if (s.autoSource === "trend") return trend?.verdict ?? null;
    if (s.autoSource === "fiscal_effect") return fiscalVerdict ?? "pending";
    return null;
  };

  // ここまでの判定（記号列・報告書No.・標準処遇）
  const jsf = judgmentSoFar(answers);
  const judged = jsf?.q1 ? judge(jsf as JudgmentAnswers) : null;
  const pathSoFar = partialPath(jsf);
  const exemption = setup.judgment_exemption;

  const step: FlowStep | null = stepId ? (flow.steps[stepId] ?? null) : null;

  const startSteps = () => {
    setPhase("steps");
    setAnswers([]);
    setChoice("");
    setNote("");
    setStepId(nextAvailableStep(flow, null, presentCats, skipCtx));
  };

  /** 補足が必須か（図E1固有: 暫定・単年の傾向判定、システム判定の上書き、処遇の変更） */
  const noteRequired = (s: FlowStep, value: string): boolean => {
    if (needsNote(s, value)) return true;
    if (s.kind === "auto") {
      const sys = systemVerdictFor(s);
      if (sys != null && sys !== value) return true; // 上書きの理由
      if (s.autoSource === "trend" && trend && trend.confidence !== "confirmed") return true;
    }
    return false;
  };

  const goNext = () => {
    if (!step) return;
    const value = step.kind === "text" ? "" : step.kind === "delegation_review" ? "reviewed" : choice;

    if ((step.kind === "choice" || step.kind === "auto" || step.kind === "delegation" || step.kind === "treatment") && !value) {
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
    if (noteRequired(step, value) && !note.trim()) {
      setError(
        step.kind === "treatment"
          ? "標準処遇と異なる処遇には理由書（H4）が必須です。理由を記入してください"
          : "根拠の記入が必要です",
      );
      return;
    }
    if (step.id === "e1_q3" && !comparisonGrade) {
      setError("実際に行った比較の方法（比較の段）を選んでください");
      return;
    }
    if (step.kind === "treatment" && value === "modified" && !decidedTreatment.trim()) {
      setError("決定処遇（事務局案）を記入してください");
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
          : step.kind === "treatment" && value === "modified"
            ? `標準処遇と異なる処遇: ${decidedTreatment.trim()}`
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

      // 図E1の判定（q1〜q4b）と根拠・材料。report_no/route はサーバーが導く
      const pick = (id: string) => answers.find((a) => a.step_id === id);
      const judgmentPayload: StoredJudgment | null = jsf?.q1
        ? {
            ...(jsf as JudgmentAnswers),
            rationale: {
              ...(pick("e1_q2")?.note ? { q2: pick("e1_q2")!.note! } : {}),
              ...(pick("e1_q3")?.note ? { q3: pick("e1_q3")!.note! } : {}),
              ...(pick("e1_q4a")?.note ? { q4a: pick("e1_q4a")!.note! } : {}),
              ...(pick("e1_q4b")?.note ? { q4b: pick("e1_q4b")!.note! } : {}),
            },
            evidence: {
              q1: { system: categoryVerdict(8), overridden: pick("e1_q1")?.overridden === true },
              ...(trend && pick("e1_q2") ? { trend } : {}),
              ...(pick("e1_q4b")
                ? { fiscal: { rate: fe.rate, mark: fe.mark, system: fiscalVerdict, overridden: pick("e1_q4b")?.overridden === true } }
                : {}),
            },
          }
        : null;
      const fiscalPayload: StoredFiscalEffect | null = pick("e1_q4b")
        ? {
            pathways: actuals,
            effect_total: effectTotal,
            cost_total: totalCost > 0 ? totalCost : null,
            rate: fe.rate,
            mark: fe.mark,
            note: fe.note || fe.formula,
          }
        : null;
      const treatmentAns = pick("treatment");

      const res = await fetch(`/api/admin/projects/${projectId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: flow.tier,
          fiscal_year: fiscalYear,
          status: "draft",
          result: `【${measure.title}】` + summarizePath(flow, answers),
          findings: targets.findings ?? null,
          success_factors: targets.success_factors ?? null,
          barrier_factors: targets.barrier_factors ?? null,
          improvement_actions: targets.improvement_actions ?? null,
          next_steps: targets.next_steps ?? null,
          measure_design_id: measure.id,
          delegations: delegationItems,
          delegation_updates: updates,
          judgment: judgmentPayload,
          comparison_grade: comparisonGrade || null,
          fiscal_effect: fiscalPayload,
          treatment_choice: treatmentAns?.value ?? null,
          decided_treatment: treatmentAns?.value === "modified" ? decidedTreatment.trim() : null,
          rationale: treatmentAns?.value === "modified" ? (treatmentAns.note ?? null) : null,
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

  /** 判定の途中経過（記号列・報告書No.・標準処遇）— 工程の右肩に常時出す */
  const judgmentStrip = answers.some((a) => a.step_id === "e1_q1") && (
    <div className="rounded-lg border px-3 py-2 text-[11px] flex flex-wrap gap-x-4 gap-y-1" style={{ borderColor: "#6366f160", background: "#6366f10d" }}>
      <span className="text-slate-400">記号列 <span className="font-mono text-slate-100 font-semibold">{pathSoFar}</span></span>
      {judged ? (
        <>
          <span className="text-slate-400">報告書 <span className="text-slate-100 font-semibold">No.{judged.pattern.no} {judged.pattern.title}</span></span>
          <span className="text-slate-400">ルート <span className="text-slate-100">{judged.pattern.route} {ROUTE_META[judged.pattern.route].name}</span></span>
          <span className="text-slate-400">標準処遇 <span className="text-slate-100">{judged.pattern.standardTreatment}</span></span>
        </>
      ) : (
        <span className="text-slate-500">（判定は工程4まで進むと定まります）</span>
      )}
    </div>
  );

  /** 初期アウトカムの年次履歴（共通ヘッダ④ ＝ 因果判断の唯一の根拠） */
  const annualHistoryPanel = (
    <div className="rounded-lg border px-3 py-2 text-[11px]" style={boxStyle}>
      <p className="text-slate-300 font-semibold mb-1">初期アウトカムの年次履歴（取組評価・図6）— 因果判断の唯一の根拠</p>
      {workEvals.length === 0 ? (
        <p className="text-slate-500">取組評価がまだありません（判断材料が不足します。「起因しない」を選ぶ前に、年次評価が無いこと自体を根拠に書いてください）。</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left font-medium">年度</th>
              <th className="text-left font-medium">取組</th>
              <th className="text-left font-medium">初期アウトカム</th>
              <th className="text-left font-medium">達否</th>
              <th className="text-left font-medium">起因の型</th>
              <th className="text-left font-medium">状態</th>
            </tr>
          </thead>
          <tbody>
            {workEvals.map((w, i) => (
              <tr key={i} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-0.5 text-slate-400">{w.fiscal_year != null ? fiscalYearLabel(w.fiscal_year) : "—"}</td>
                <td className="text-slate-300"><span className="font-mono text-slate-500">{w.work_code}</span> {w.work_title}</td>
                <td className="text-slate-100">{w.initial_outcome ?? "—"}</td>
                <td>{w.initial_achieved == null ? "—" : w.initial_achieved ? <span style={{ color: "#34d399" }}>達成</span> : <span style={{ color: "#f87171" }}>未達</span>}</td>
                <td className="text-slate-300">{w.cause_type}</td>
                <td style={{ color: w.status === "approved" ? "#34d399" : "#94a3b8" }}>
                  {w.status === "approved" ? "承認済み" : w.status === "in_review" ? "レビュー中" : "下書き"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // ─── 冒頭（材料の確認）──────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        {header}
        <p className="text-[11px] text-slate-500">
          一計画期間の評価です。図E1の4つの問い（目標到達→接近→起因→再現可能性／財政効果率）で判定し、
          報告書No.と標準処遇を機械的に定めたうえで、次期計画での処遇（事務局案）を決めます。
        </p>
        {exemption && (
          <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "#f59e0b60", background: "#f59e0b0d" }}>
            <p className="font-semibold" style={{ color: "#fbbf24" }}>適用除外: {EXEMPTION_META[exemption.kind].name}</p>
            <p className="text-slate-400 mt-0.5">{EXEMPTION_META[exemption.kind].detail}</p>
            <p className="text-slate-500 mt-0.5">理由: {exemption.reason}{exemption.decided_on ? `（決裁 ${exemption.decided_on}）` : ""}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-slate-300 mb-1">中間アウトカム指標（No.8）</p>
          <div className="rounded-lg border px-3 py-2 text-[11px]" style={boxStyle}>
            {midIndicators.length === 0 ? (
              <p className="text-slate-500">
                中間アウトカム指標がまだありません。施策構築（EBPM）で No.8 を設定すると、判定が自動提示されます。
              </p>
            ) : (
              midIndicators.map((i, k) => (
                <p key={i.id} className="text-slate-300">
                  {k === 0 && <span className="text-indigo-400 mr-1" title="主たる中間アウトカム">◎</span>}
                  {i.label}: 実績{" "}
                  <span className="font-semibold text-slate-100">{resultDisplay(latestFor(i.id), i.unit)}</span>
                  {" ／ 目標 "}{i.target_value ?? "—"}{i.unit ? ` ${i.unit}` : ""}
                  {" ／ ベースライン（自然体推計）"}{i.natural_baseline ?? "未入力"}
                </p>
              ))
            )}
            {trend && <p className="text-slate-500 mt-1">傾向: {trend.note}</p>}
          </div>
        </div>
        {annualHistoryPanel}
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
          事業費累計 {totalCost > 0 ? `¥${totalCost.toLocaleString()}` : "未入力"} ／ 寄与経路 {setup.contribution_pathways.length}件
          {setup.contribution_pathways.length === 0 && "（未定義のため財政効果率は算定不能＝④bは判定保留になります）"}
          ／ 比較先 {benchmarks.length}件{benchmarks.length === 0 && "（他団体比較の工程は飛ばされます）"}
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
    const treatmentAns = answers.find((a) => a.step_id === "treatment");
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        {header}
        {judgmentStrip}
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
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={boxStyle}>
          <p className="text-slate-400">比較の段: <span className="text-slate-100">{comparisonGrade ? `${comparisonGrade} ${COMPARISON_GRADE_META[comparisonGrade].name}` : "—"}</span></p>
          {answers.some((a) => a.step_id === "e1_q4b") && (
            <p className="text-slate-400">財政効果率: <span className="text-slate-100">{fe.rate != null ? `${fe.rate}%（${fe.mark}）` : "算定不能（判定保留）"}</span> <span className="text-slate-500">{fe.formula}</span></p>
          )}
        </div>
        {treatmentAns && (
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "#6366f160", background: "#6366f10d" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#818cf8" }}>
              次期計画での処遇（事務局案）: {treatmentAns.value === "standard" ? (judged?.pattern.standardTreatment ?? "標準処遇") : treatmentAns.value === "modified" ? decidedTreatment : "処遇を行わない（測定設計のみ）"}
            </p>
            {treatmentAns.value === "modified" && (
              <p className="text-[10px] mt-0.5" style={{ color: "#fbbf24" }}>
                標準処遇と異なるため理由書（様式H4）が付きます。承認には理由の記入が必須です。
              </p>
            )}
            <p className="text-[10px] text-slate-500 mt-0.5">
              この処遇は「次期計画への反映」（様式G1・G4）の出発点になります（現行計画の施策データは書き換えません）。
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
  const requiresNoteNow = Boolean(choice) && noteRequired(step, choice);

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
      {header}
      {judgmentStrip}
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span>回答 {answers.length + 1} 問目</span>
        <span>／ {step.section}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-100">{step.question}</p>
        {step.help && <p className="text-[11px] text-slate-500 mt-1">{step.help}</p>}
      </div>

      {/* ① 判定材料: 中間アウトカムの実績 vs 目標 */}
      {step.autoSource === "indicator" && (
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={boxStyle}>
          {midIndicators.length === 0 ? (
            <p className="text-slate-500">対象の指標がありません。手動で選択します（根拠の記入が必要です）。</p>
          ) : (
            midIndicators.map((i) => (
              <p key={i.id} className="text-slate-300">
                {i.label}: 実績{" "}
                <span className="font-semibold text-slate-100">{resultDisplay(latestFor(i.id), i.unit)}</span>
                {" ／ 目標 "}{i.target_value ?? "—"}{i.unit ? ` ${i.unit}` : ""}
                {" ／ 基準値 "}{i.baseline_value ?? "—"}
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

      {/* ② 判定材料: 3か年傾向 */}
      {step.autoSource === "trend" && (
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={boxStyle}>
          {!trend || trend.used.length === 0 ? (
            <p className="text-slate-500">主たる中間アウトカムの年度別実績がありません。傾向を判定できないため、担当者が根拠を書いて選びます（報告書に「単年判断」と注記されます）。</p>
          ) : (
            <>
              <p className="text-slate-300">
                {primaryMid?.label}（目標 {primaryMid?.target_value ?? "—"}{primaryMid?.unit ? ` ${primaryMid.unit}` : ""}）:
                {" "}
                {trend.used.map((p) => `${fiscalYearLabel(p.fiscal_year)} ${p.value}`).join(" → ")}
              </p>
              <p className="text-slate-500 mt-0.5">{trend.note}</p>
            </>
          )}
          {trend?.verdict && (
            <p className="mt-1" style={{ color: trend.confidence === "confirmed" ? "#22d3ee" : "#fbbf24" }}>
              システム判定{trend.confidence === "provisional" ? "（暫定・2点）" : ""}: {step.options?.find((o) => o.value === trend.verdict)?.label}
            </p>
          )}
        </div>
      )}

      {/* ③ 判定材料: 年次履歴 ＋ 比較の段 */}
      {step.id === "e1_q3" && (
        <>
          {annualHistoryPanel}
          <div className="rounded-lg border px-3 py-2 text-[11px] space-y-1" style={boxStyle}>
            <p className="text-slate-300 font-semibold">実際に行った比較の方法（比較の段）</p>
            <p className="text-slate-500">
              実際に行っていない比較を書かない。初期値は実験設計{measure.experiment?.design ? `（${measure.experiment.design}）` : ""}から提示。
              財政効果率の算定は C 以上が要件。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(COMPARISON_GRADE_META) as ComparisonGrade[]).map((g) => {
                const active = comparisonGrade === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setComparisonGrade(g)}
                    title={COMPARISON_GRADE_META[g].detail}
                    className="text-[11px] px-2.5 py-1 rounded-lg"
                    style={{
                      background: active ? TONE.neutral!.bg : "var(--bg-primary)",
                      border: `1px solid ${active ? TONE.neutral!.color : "var(--border)"}`,
                      color: active ? TONE.neutral!.color : "#94a3b8",
                    }}
                  >
                    {g} {COMPARISON_GRADE_META[g].name}
                  </button>
                );
              })}
            </div>
            {comparisonGrade && <p className="text-slate-500">{COMPARISON_GRADE_META[comparisonGrade].detail}</p>}
          </div>
        </>
      )}

      {/* ④b 判定材料: 寄与経路ごとの期末実績 → 財政効果率 */}
      {step.autoSource === "fiscal_effect" && (
        <div className="rounded-lg border px-3 py-2 text-[11px] space-y-2" style={boxStyle}>
          <p className="text-slate-300 font-semibold">
            事業費（計画期間累計・人件費按分込み）: <span className="text-slate-100">{totalCost > 0 ? `¥${totalCost.toLocaleString()}` : "未入力（施策データセットの年度別事業費）"}</span>
          </p>
          {setup.contribution_pathways.length === 0 ? (
            <p className="text-slate-500">
              寄与経路が未定義です（施策データセット「判定の前提」で定義します）。財政効果を推計できないため判定保留になります。
            </p>
          ) : (
            <div className="space-y-1.5">
              {setup.contribution_pathways.map((pw) => {
                const row = actuals.find((a) => a.pathway_key === pw.key);
                const est = setup.fiscal_effect_estimates.find((e) => e.pathway_key === pw.key);
                const setRow = (over: Partial<FiscalEffectPathwayAmount>) =>
                  setActuals((prev) => prev.map((a) => (a.pathway_key === pw.key ? { ...a, ...over } : a)));
                return (
                  <div key={pw.key} className="rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--border)" }}>
                    <p className="text-slate-300">{pw.label} <span className="text-slate-500">— {pw.formula}</span></p>
                    <div className="flex flex-wrap gap-2 mt-1 items-end">
                      <label className="text-[10px] text-slate-500">
                        期末実績・累計（円）
                        <input type="number" className={inputClass} style={{ ...inputStyle, width: 160 }}
                          value={row?.cumulative ?? ""}
                          onChange={(e) => setRow({ cumulative: e.target.value ? Number(e.target.value) : null })} />
                      </label>
                      <label className="text-[10px] text-slate-500">
                        年額（円）
                        <input type="number" className={inputClass} style={{ ...inputStyle, width: 140 }}
                          value={row?.annual ?? ""}
                          onChange={(e) => setRow({ annual: e.target.value ? Number(e.target.value) : null })} />
                      </label>
                      <label className="text-[10px] text-slate-500 flex-1 min-w-[200px]">
                        算定の根拠（X＝実績−ベースライン・単価・対象者数）
                        <input className={inputClass} style={inputStyle}
                          value={row?.basis ?? ""}
                          onChange={(e) => setRow({ basis: e.target.value || null })} />
                      </label>
                    </div>
                    {est && (est.cumulative != null || est.annual != null) && (
                      <p className="text-[10px] text-slate-500 mt-0.5">計画時の事前推計: 累計 {est.cumulative != null ? `¥${est.cumulative.toLocaleString()}` : "—"} ／ 年額 {est.annual != null ? `¥${est.annual.toLocaleString()}` : "—"}</p>
                    )}
                  </div>
                );
              })}
              <p className="text-slate-300">
                財政効果（累計）: <span className="text-slate-100 font-semibold">{effectTotal != null ? `¥${effectTotal.toLocaleString()}` : "未入力"}</span>
                {" ／ 財政効果率: "}
                <span className="font-semibold" style={{ color: fe.mark === "J" ? "#34d399" : fe.mark === "K" ? "#fbbf24" : "#94a3b8" }}>
                  {fe.rate != null ? `${fe.rate}%（${fe.mark}）` : "算定不能"}
                </span>
              </p>
              <p className="text-slate-500">{fe.rate != null ? fe.formula : fe.note}</p>
            </div>
          )}
          {sys != null && (
            <p style={{ color: "#22d3ee" }}>システム判定: {step.options?.find((o) => o.value === sys)?.label}</p>
          )}
        </div>
      )}

      {step.id === "benchmark" && (
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={boxStyle}>
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

      {/* ⑦ 処遇: 判定から定まる標準処遇を示す */}
      {step.kind === "treatment" && (
        <div className="rounded-lg border px-3 py-2 text-[11px] space-y-1" style={boxStyle}>
          {judged ? (
            <>
              <p className="text-slate-300">
                報告書 <span className="text-slate-100 font-semibold">No.{judged.pattern.no} {judged.pattern.title}</span>
                （{judged.path}）／ ルート {judged.pattern.route} {ROUTE_META[judged.pattern.route].name}（審議: {ROUTE_META[judged.pattern.route].review}）
              </p>
              <p className="text-slate-300">
                標準処遇: <span className="text-slate-100 font-semibold">{judged.pattern.standardTreatment}</span>
              </p>
              <p className="text-slate-500">反映先: {judged.pattern.reflectTargets.join("・")} ／ 要点: {judged.pattern.keyPoint}</p>
            </>
          ) : (
            <p style={{ color: "#fbbf24" }}>
              判定保留（記号列 {pathSoFar}）。どのルートにも進まず処遇は行いません。測定課題Ⅳとして記録し、次期に判定可能となる測定設計を計画に書き込みます。
            </p>
          )}
          {exemption && (
            <p style={{ color: "#fbbf24" }}>適用除外（{EXEMPTION_META[exemption.kind].name}）: 廃止対象としません。</p>
          )}
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
      {(step.kind === "choice" || step.kind === "auto" || step.kind === "delegation" || step.kind === "treatment") && (
        <div className="space-y-1.5">
          {step.options?.map((o) => {
            // 判定保留・適用除外のときは「標準処遇のとおり」を選べない（処遇を行わない）
            const disabled = step.kind === "treatment" && o.value === "standard" && !judged;
            const active = choice === o.value;
            const tone = TONE[o.tone ?? "neutral"]!;
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => setChoice(o.value)}
                className="w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors disabled:opacity-40"
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

      {/* 決定処遇（標準処遇と異なる場合） */}
      {step.kind === "treatment" && choice === "modified" && (
        <input
          className={inputClass}
          style={inputStyle}
          placeholder="決定処遇（事務局案）— 例: 廃止ではなく対象を絞って継続"
          value={decidedTreatment}
          onChange={(e) => setDecidedTreatment(e.target.value)}
        />
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
      {(step.kind === "text" || (requiresNoteNow && step.kind !== "delegation")) && (
        <textarea
          className={inputClass}
          style={inputStyle}
          rows={step.kind === "treatment" ? 5 : 3}
          placeholder={step.notePrompt ?? "補足を記入してください"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      {requiresNoteNow && step.kind === "auto" && sys != null && sys !== choice && (
        <p className="text-[10px]" style={{ color: "#fbbf24" }}>システム判定を上書きします。理由を記入してください。</p>
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
