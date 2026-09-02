"use client";

/**
 * 取組評価（図6v2）のウィザード — CA2-2（設計 claude/coe-ca2-design.md §1・§5）。
 *
 * 評価者は取組の担当者レベル。目的は
 *   ①次年度以降の取組の効果性向上（初期アウトカム指標の改善）
 *   ②取組の改善だけでは解消できない課題の、主要施策毎評価への委任
 *
 * 判定材料は施策データセットの指標（057）と実績（058）:
 *   - 工程1（implemented）は No.5 のタスク完了実績からの実施率を自動提示
 *   - 工程2・3（target_met / outcome_initial_met）は No.6・7 の実績 vs 目標で自動提示
 *   - 指標が無い工程（0. 体制 / 2b. 到達と質）は自動でスキップ
 * 通った経路は flow_decision_path に、使った指標は indicator_snapshot に残る。
 */

import { useCallback, useEffect, useState } from "react";
import {
  FIG6V2,
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
import { latestResult, resultDisplay, type IndicatorResultRow } from "@/lib/measure/results";
import type { MeasureIndicatorRow, MeasureCostYear } from "@/lib/measure/dataset";

export interface WizardWork {
  id: string;
  code: string;
  title: string;
}

export interface WizardMeasureContext {
  id: string;
  title: string;
  execution_rate_note: string | null;
  experiment: {
    design?: string;
    primary_outcome?: string;
    considered?: unknown[];
  } | null;
}

interface ActivityRate {
  planned: number;
  completed: number;
  rate: number | null;
  breakdown: { title: string; planned: number; completed: number }[];
}

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

export default function WorkEvaluationWizard({
  projectId,
  measure,
  work,
  fiscalYear,
  onClose,
  onSaved,
}: {
  projectId: string;
  measure: WizardMeasureContext;
  work: WizardWork;
  fiscalYear: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = `/api/admin/projects/${projectId}/measure-design/${measure.id}/dataset`;
  const flow = FIG6V2;

  const [indicators, setIndicators] = useState<MeasureIndicatorRow[] | null>(null);
  const [costYears, setCostYears] = useState<MeasureCostYear[]>([]);
  const [results, setResults] = useState<IndicatorResultRow[]>([]);
  const [activityRate, setActivityRate] = useState<ActivityRate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // フローの進行
  const [phase, setPhase] = useState<"results" | "steps" | "confirm">("results");
  const [stepId, setStepId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<FlowAnswer[]>([]);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [delegations, setDelegations] = useState<DelegationDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 実績記入フォームの状態（indicatorId → 入力値）
  const [entry, setEntry] = useState<Record<string, { value: string; text: string }>>({});
  const [entryBusy, setEntryBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [dsRes, resRes, rateRes] = await Promise.all([
        fetch(base, { cache: "no-store" }),
        fetch(`${base}/results`, { cache: "no-store" }),
        fetch(`${base}/activity-rate?workId=${work.id}&fiscalYear=${fiscalYear}`, { cache: "no-store" }),
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
      const aj = (await rateRes.json()) as { data: ActivityRate | null };
      if (aj.data) setActivityRate(aj.data);
    } catch {
      setLoadError("通信エラーが発生しました");
    }
  }, [base, work.id, fiscalYear]);

  useEffect(() => {
    void load();
  }, [load]);

  // 委任ステップで「ある」を選んだら、1件目の記入欄をすぐ出す
  // （空のまま「＋ 委任する課題を追加」を探させない）
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

  // この取組の指標（工程の材料）と主要施策レベルのコスト系（工程6の材料）
  const workIndicators = indicators.filter((i) => i.measure_work_id === work.id);
  const costIndicators = indicators.filter(
    (i) => !i.measure_work_id && (i.category_no === 3 || i.category_no === 15),
  );
  const presentCats = new Set(workIndicators.map((i) => i.category_no));

  const resultsByIndicator = new Map<string, IndicatorResultRow[]>();
  for (const r of results) {
    const list = resultsByIndicator.get(r.measure_indicator_id);
    if (list) list.push(r);
    else resultsByIndicator.set(r.measure_indicator_id, [r]);
  }
  /** 対象年度の最新実績（年度一致を優先、無ければ全体の最新） */
  const latestFor = (indicatorId: string): IndicatorResultRow | null => {
    const rows = resultsByIndicator.get(indicatorId) ?? [];
    const inYear = rows.filter((r) => r.fiscal_year === fiscalYear);
    return latestResult(inYear.length > 0 ? inYear : rows);
  };

  /** カテゴリ単位の機械判定（No.6・7）。データが無ければ null */
  const categoryVerdict = (categoryNo: number): "met" | "not_met" | null => {
    const targets = workIndicators.filter(
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

  /** auto ステップのシステム判定 */
  const systemVerdictFor = (step: FlowStep): string | null => {
    if (step.autoSource === "activity_rate") {
      const rate = activityRate?.rate ?? null;
      if (rate == null) return null;
      if (rate >= 99.5) return "done";
      if (rate > 0) return "partial";
      return "not_done";
    }
    if (step.autoSource === "indicator" && step.autoIndicator != null) {
      return categoryVerdict(step.autoIndicator);
    }
    return null;
  };

  const step: FlowStep | null = stepId ? (flow.steps[stepId] ?? null) : null;

  const startSteps = () => {
    setPhase("steps");
    setAnswers([]);
    setChoice("");
    setNote("");
    setStepId(nextAvailableStep(flow, null, presentCats));
  };

  const goNext = () => {
    if (!step) return;
    const value = step.kind === "text" ? "" : choice;
    if ((step.kind === "choice" || step.kind === "auto" || step.kind === "delegation") && !value) {
      setError("選択してください");
      return;
    }
    if (needsNote(step, value) && !note.trim()) {
      setError("補足の記入が必要です");
      return;
    }
    if (step.kind === "delegation" && value === "has") {
      const valid = delegations.filter((d) => d.title.trim());
      if (valid.length === 0) {
        setError("委任する課題の名称を1件以上記入してください");
        return;
      }
    }
    setError(null);

    const opt = step.options?.find((o) => o.value === value);
    const sys = step.kind === "auto" ? systemVerdictFor(step) : null;
    const answer: FlowAnswer = {
      step_id: step.id,
      section: step.section,
      question: step.question,
      value,
      label: opt?.label ?? "",
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(step.kind === "auto" && sys != null
        ? { system_value: sys, overridden: value !== sys }
        : {}),
    };
    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setNote("");
    setChoice("");

    const rawNext = resolveNext(step, value);
    const effective = rawNext ? nextAvailableStep(flow, rawNext, presentCats) : null;
    if (effective) setStepId(effective);
    else {
      setStepId(null);
      setPhase("confirm");
    }
  };

  const goBack = () => {
    if (answers.length === 0) {
      setPhase("results");
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
      const delegationAnswer = answers.find((a) => a.step_id === "delegation");
      const delegationItems =
        delegationAnswer?.value === "has"
          ? delegations
              .filter((d) => d.title.trim())
              .map((d) => ({
                title: d.title.trim(),
                detail: d.detail.trim() || null,
                root_cause: d.root_cause.trim() || null,
              }))
          : [];
      const res = await fetch(`/api/admin/projects/${projectId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: flow.tier,
          fiscal_year: fiscalYear,
          status: "draft",
          result: `【${work.code} ${work.title}】` + summarizePath(flow, answers),
          findings: targets.findings ?? null,
          barrier_factors: targets.barrier_factors ?? null,
          improvement_actions: targets.improvement_actions ?? null,
          next_steps: targets.next_steps ?? null,
          measure_design_id: measure.id,
          measure_work_id: work.id,
          delegations: delegationItems,
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

  /** 実績の即時登録（記入フェーズ） */
  const submitEntry = async (ind: MeasureIndicatorRow) => {
    const e = entry[ind.id];
    if (!e || (!e.value && !e.text)) return;
    setEntryBusy(ind.id);
    try {
      const res = await fetch(`${base}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          measure_indicator_id: ind.id,
          fiscal_year: fiscalYear,
          measured_on: new Date().toISOString().slice(0, 10),
          value: e.value ? Number(e.value) : null,
          value_text: e.text || null,
        }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (json.error) setError(json.error);
      else {
        setEntry((prev) => ({ ...prev, [ind.id]: { value: "", text: "" } }));
        await load();
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setEntryBusy(null);
    }
  };

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">
          {flow.label} — {work.code} {work.title}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {measure.title} ／ {fiscalYearLabel(fiscalYear)}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* 評価1の設計アーティファクトと同じビジュアルのフロー全体図（CA2-4） */}
        <a
          href="/help/flow-fig6.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: "var(--bg-input)", color: "#818cf8", border: "1px solid var(--border)" }}
        >
          🗺 フロー全体図
        </a>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
        >
          ✕ 閉じる
        </button>
      </div>
    </div>
  );

  // ─── フェーズ1: 実績の確認・記入 ───────────────────────────
  if (phase === "results") {
    const flowCats = [4, 5, 6, 7, 10, 11].filter((no) => presentCats.has(no));
    const rows = workIndicators
      .filter((i) => flowCats.includes(i.category_no))
      .sort((a, b) => a.category_no - b.category_no);
    const missingRequired = rows.filter(
      (i) =>
        [6, 7].includes(i.category_no) &&
        i.target_value != null &&
        latestFor(i.id) == null,
    );
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        {header}
        <div>
          <h4 className="text-xs font-semibold text-slate-300">実績の確認（評価の材料）</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            当該年度の実績が未入力の指標はここで記入できます。No.5（アクティビティ）は
            タスク完了実績からの自動集計です。実績は履歴で残ります。
          </p>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-[11px]" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-slate-500">
                <th className="text-left px-2 py-1 font-medium w-8">No</th>
                <th className="text-left px-2 py-1 font-medium">指標</th>
                <th className="text-right px-2 py-1 font-medium w-24">目標値</th>
                <th className="text-right px-2 py-1 font-medium w-28">当該年度の実績</th>
                <th className="text-left px-2 py-1 font-medium w-56">記入</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ind) => {
                const latest = latestFor(ind.id);
                const isAuto = ind.category_no === 5;
                return (
                  <tr key={ind.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{ind.category_no}</td>
                    <td className="px-2 py-1.5">
                      <span className="text-slate-400">{INDICATOR_BY_NO[ind.category_no]?.name}</span>
                      <span className="block text-slate-300">{ind.label}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-300">
                      {ind.target_value ?? "—"}{ind.unit ?? ""}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {isAuto ? (
                        <span className="text-cyan-300 font-semibold">
                          {activityRate?.rate != null
                            ? `${activityRate.rate}%（${activityRate.completed}/${activityRate.planned}件）`
                            : "計画にタスクなし"}
                        </span>
                      ) : (
                        <span className={latest ? "text-slate-200 font-semibold" : "text-slate-500"}>
                          {resultDisplay(latest, ind.unit)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {isAuto ? (
                        <span className="text-[10px] text-slate-500">タスク完了実績から自動集計</span>
                      ) : (
                        <div className="flex gap-1">
                          <input
                            type="number"
                            className="w-20 text-right rounded border px-1.5 py-1 text-[11px] bg-transparent text-slate-100"
                            style={inputStyle}
                            placeholder={ind.unit ?? "値"}
                            value={entry[ind.id]?.value ?? ""}
                            onChange={(e) =>
                              setEntry((prev) => ({
                                ...prev,
                                [ind.id]: { value: e.target.value, text: prev[ind.id]?.text ?? "" },
                              }))
                            }
                          />
                          <input
                            className="flex-1 rounded border px-1.5 py-1 text-[11px] bg-transparent text-slate-100"
                            style={inputStyle}
                            placeholder="定性（Yes/No 等）"
                            value={entry[ind.id]?.text ?? ""}
                            onChange={(e) =>
                              setEntry((prev) => ({
                                ...prev,
                                [ind.id]: { value: prev[ind.id]?.value ?? "", text: e.target.value },
                              }))
                            }
                          />
                          <button
                            type="button"
                            onClick={() => void submitEntry(ind)}
                            disabled={entryBusy === ind.id}
                            className="text-[11px] text-indigo-400 shrink-0 disabled:opacity-50"
                          >
                            保存
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-slate-500">
                    この取組にはフローが参照する指標（No.4〜11）がまだありません。
                    施策構築（EBPM）のデータセットで指標を設定してから評価すると、判定の自動提示が働きます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {missingRequired.length > 0 && (
          <p className="text-[11px]" style={{ color: "#fbbf24" }}>
            ⚠ 実績が未入力の必須指標があります（
            {missingRequired.map((i) => `No.${i.category_no}`).join("・")}
            ）。このまま進むと該当の判定は自動提示なし（手動選択）になります。
          </p>
        )}
        <div className="flex justify-end gap-2">
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

  // ─── フェーズ3: 確認・保存 ─────────────────────────────────
  if (phase === "confirm") {
    const delegationAnswer = answers.find((a) => a.step_id === "delegation");
    const items = delegationAnswer?.value === "has" ? delegations.filter((d) => d.title.trim()) : [];
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
                  <span className="ml-2 text-[10px]" style={{ color: "#fbbf24" }}>
                    ※システム判定を上書き
                  </span>
                )}
              </p>
              {a.label && a.note && <p className="text-[11px] text-slate-400 mt-0.5">{a.note}</p>}
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "#f59e0b60", background: "#f59e0b0d" }}>
            <p className="text-[11px] font-semibold" style={{ color: "#fbbf24" }}>
              主要施策毎評価へ委任する課題（{items.length}件）
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

  // ─── フェーズ2: 設問 ───────────────────────────────────────
  if (!step) return null;
  const sys = step.kind === "auto" ? systemVerdictFor(step) : null;
  const fyCost = costYears.find((c) => c.fiscal_year === fiscalYear);

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

      {/* 判定材料のパネル */}
      {step.kind === "auto" && (
        <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          {step.autoSource === "activity_rate" ? (
            activityRate?.rate != null ? (
              <>
                <p className="text-slate-300">
                  実施率{" "}
                  <span className="font-semibold text-cyan-300">
                    {activityRate.rate}%（{activityRate.completed}/{activityRate.planned}件）
                  </span>{" "}
                  — タスク完了実績からの自動集計
                </p>
                {activityRate.breakdown.map((b, i) => (
                  <p key={i} className="text-slate-500 mt-0.5">
                    ・{b.title}: {b.completed}/{b.planned}件
                  </p>
                ))}
              </>
            ) : (
              <p className="text-slate-500">
                当該年度に計画されたタスクがありません（実施項目の期限・繰り返しを確認してください）。手動で選択します。
              </p>
            )
          ) : (
            (() => {
              const targets = workIndicators.filter((i) => i.category_no === step.autoIndicator);
              if (targets.length === 0) return <p className="text-slate-500">対象の指標がありません。</p>;
              return targets.map((ind) => {
                const latest = latestFor(ind.id);
                return (
                  <p key={ind.id} className="text-slate-300">
                    {ind.label}: 実績{" "}
                    <span className="font-semibold text-slate-100">{resultDisplay(latest, ind.unit)}</span>
                    {" ／ 目標 "}
                    {ind.target_value ?? "—"}
                    {ind.unit ?? ""}
                  </p>
                );
              });
            })()
          )}
          {sys != null && (
            <p className="mt-1" style={{ color: "#22d3ee" }}>
              システム判定: {step.options?.find((o) => o.value === sys)?.label}
              （実態と異なる場合は選び直してください）
            </p>
          )}
        </div>
      )}
      {step.id === "cost_check" && (
        <div className="rounded-lg border px-3 py-2 text-[11px] space-y-1" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          {costIndicators.map((ind) => {
            const latest = latestFor(ind.id);
            return (
              <p key={ind.id} className="text-slate-300">
                No.{ind.category_no} {ind.label}: {resultDisplay(latest, ind.unit)}
                {ind.target_value != null && ` ／ 目標 ${ind.target_value}${ind.unit ?? ""}`}
              </p>
            );
          })}
          <p className="text-slate-300">
            {fiscalYearLabel(fiscalYear)}の事業費計:{" "}
            {fyCost?.total_amount != null ? `¥${fyCost.total_amount.toLocaleString()}` : "未入力"}
          </p>
          {measure.execution_rate_note && (
            <p className="text-slate-500">執行率の算定式: {measure.execution_rate_note}</p>
          )}
        </div>
      )}
      {step.id === "attributable" && measure.experiment && (
        <div className="rounded-lg border px-3 py-2 text-[11px] space-y-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
          <p className="text-slate-300">実験設計: {measure.experiment.design ?? "未設定"}</p>
          {measure.experiment.primary_outcome && (
            <p className="text-slate-500">主要評価項目: {measure.experiment.primary_outcome}</p>
          )}
          {Array.isArray(measure.experiment.considered) && measure.experiment.considered.length > 0 && (
            <p className="text-slate-500">不採用とした手法の記録: {measure.experiment.considered.length}件</p>
          )}
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

      {/* 委任課題の記入（「ある」を選ぶと1件目の記入欄が出る） */}
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
                placeholder="課題の内容 — なぜ取組の改善だけでは解消できないか"
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
            ＋ 委任する課題を追加
          </button>
        </div>
      )}

      {/* 記述欄 */}
      {(step.kind === "text" || (choice && needsNote(step, choice))) && step.kind !== "delegation" && (
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
