"use client";

// 評価フローウィザード（図6・図7）
//
// フロー定義（lib/evaluation/flow.ts）を読んで描画する。分岐の経路は
// flow_decision_path に保存され、「なぜこの判断に至ったか」の記録になる。
//
// auto ステップでは選択したKPIの到達度からシステムが判定を提示し、
// 担当者が実態と異なると考えれば上書きできる（上書きしたことも記録される）。

import { useEffect, useState } from "react";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import {
  FLOWS,
  collectTargets,
  needsNote,
  resolveNext,
  summarizePath,
  type EvaluationFlow,
  type FlowAnswer,
  type FlowKey,
  type FlowStep,
} from "@/lib/evaluation/flow";
import { calcAchievement, type AchievementCondition } from "@/lib/stats/achievement";
import { normalizeIndicatorType } from "@/lib/outcome/tiers";
import {
  LOGIC_COLUMNS,
  COLUMN_TO_INDICATOR_TYPE,
  type LogicColumnKey,
  type LogicColumns,
} from "@/lib/logicmodel/elements";

export interface WizardKpi {
  id: string;
  label: string;
  unit: string;
  target: number | null;
  current: number | null;
  baseline_value: number | null;
  achievement_condition: AchievementCondition | null;
  indicator_type: string | null;
}

interface Contributor {
  kpi_id: string;
  label: string;
  unit: string;
  current: number | null;
  target: number | null;
  rate: number | null;
  achieved: boolean;
  evaluations: {
    id: string;
    fiscal_year: number | null;
    status: string;
    rate: number | null;
    findings: string | null;
    improvement_actions: string | null;
    created_at: string;
  }[];
}

/** 施策構築（EBPM）の確定済みデータセット — 評価の前提として選べる（E5） */
export interface WizardMeasure {
  id: string;
  title: string;
  evidence_status: "sufficient" | "partial" | "none";
  experiment: { design?: string; primary_outcome?: string } | null;
  structure_indicators: { id: string; text: string }[];
  process_indicators: { id: string; text: string }[];
  kpi_ids_initial: string[];
  kpi_ids_intermediate: string[];
  cost_per_outcome_note: string | null;
  unit_cost: number | null;
}

interface Props {
  projectId: string;
  kpis: WizardKpi[];
  logicModelId: string | null;
  /** 現行版のロジックモデル。成果を選ぶとその成果に割り当てたKPIが決まる（L3→L5） */
  logicColumns?: LogicColumns | null;
  /** 確定済みの施策データセット（E5）。選ぶとKPI・指標・実験設計が揃う */
  measures?: WizardMeasure[];
  onSaved: () => void;
}

const TONE: Record<string, { color: string; bg: string }> = {
  good: { color: "#10b981", bg: "#10b98118" },
  warn: { color: "#f59e0b", bg: "#f59e0b18" },
  bad: { color: "#ef4444", bg: "#ef444418" },
  neutral: { color: "#818cf8", bg: "#6366f118" },
};

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  borderColor: "var(--border)",
};
const cardStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  borderColor: "var(--border)",
};

export default function EvaluationWizard({
  projectId,
  kpis,
  logicModelId,
  logicColumns,
  measures,
  onSaved,
}: Props) {
  const [flowKey, setFlowKey] = useState<FlowKey | null>(null);
  const [selectedKpis, setSelectedKpis] = useState<string[]>([]);
  /** 「評価する成果」として選んだロジックモデルの要素（L5） */
  const [pickedElementId, setPickedElementId] = useState<string | null>(null);
  /** 「評価する施策」として選んだ施策データセット（E5） */
  const [pickedMeasureId, setPickedMeasureId] = useState<string | null>(null);
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getFullYear());
  const [stepId, setStepId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<FlowAnswer[]>([]);
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contributors, setContributors] = useState<Contributor[] | null>(null);
  const [loadingRollup, setLoadingRollup] = useState(false);
  /** 受領済み実績報告の所見・課題（S2 C① — 選んだ施策の参考情報） */
  const [reportNotes, setReportNotes] = useState<
    { request_title: string; fiscal_year: number | null; items: { label: string; value: string }[] }[]
  >([]);

  useEffect(() => {
    if (!pickedMeasureId) {
      setReportNotes([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/projects/${projectId}/report-requests/answers?measureId=${pickedMeasureId}`,
        );
        const json = (await res.json()) as { data: typeof reportNotes | null };
        if (!cancelled && res.ok && json.data) setReportNotes(json.data);
      } catch {
        /* 参考情報のため失敗は握りつぶす */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedMeasureId, projectId]);

  const flow: EvaluationFlow | null = flowKey ? FLOWS[flowKey] : null;
  const step: FlowStep | null = flow && stepId ? (flow.steps[stepId] ?? null) : null;

  // 選択中のKPIの到達度（auto ステップの判定材料）
  const chosen = kpis.filter((k) => selectedKpis.includes(k.id));
  const achievements = chosen.map((k) => ({
    kpi: k,
    ach: calcAchievement({
      current: k.current,
      target: k.target,
      baseline: k.baseline_value,
      condition: k.achievement_condition,
    }),
  }));
  const systemVerdict =
    achievements.length > 0 && achievements.every((a) => a.ach.achieved) ? "met" : "not_met";

  // ロジックモデルの成果のうち、このフローで評価しうるもの（L5）。
  // 自分のスパンに合う層を先に出し、合わないものには印を付ける。
  const outcomeChoices: {
    id: string;
    text: string;
    kpiIds: string[];
    color: string;
    tierMatches: boolean;
  }[] = (() => {
    if (!flow || !logicColumns) return [];
    const outcomeKeys: LogicColumnKey[] = [
      "initial_outcomes",
      "intermediate_outcomes",
      "long_outcomes",
    ];
    const out = outcomeKeys.flatMap((key) => {
      const meta = LOGIC_COLUMNS.find((c) => c.key === key);
      const tierMatches = COLUMN_TO_INDICATOR_TYPE[key] === flow.tier;
      return (logicColumns[key] ?? []).map((el) => ({
        id: el.id,
        text: el.text,
        kpiIds: el.kpi_ids,
        color: meta?.color ?? "#94a3b8",
        tierMatches,
      }));
    });
    return out.sort((a, b) => Number(b.tierMatches) - Number(a.tierMatches));
  })();

  // 選んだフローに合う指標タイプを先頭に出す
  const relevantKpis = flow
    ? [...kpis].sort((a, b) => {
        const ta = normalizeIndicatorType(a.indicator_type) === flow.tier ? 0 : 1;
        const tb = normalizeIndicatorType(b.indicator_type) === flow.tier ? 0 : 1;
        return ta - tb;
      })
    : kpis;

  const reset = () => {
    setFlowKey(null);
    setSelectedKpis([]);
    setPickedElementId(null);
    setPickedMeasureId(null);
    setStepId(null);
    setAnswers([]);
    setNote("");
    setChoice("");
    setContributors(null);
    setError(null);
  };

  const startFlow = async () => {
    if (!flow) return;
    setError(null);
    setAnswers([]);
    setNote("");
    setChoice("");
    setStepId(flow.start);

    // 図7では、選んだ中間アウトカムに寄与する短期アウトカムの評価履歴を先に集める
    if (flow.key === "fig7" && selectedKpis.length > 0) {
      setLoadingRollup(true);
      try {
        const res = await fetch(
          `/api/admin/projects/${projectId}/evaluations/rollup?kpiIds=${selectedKpis.join(",")}`,
        );
        const json = (await res.json()) as {
          data: { contributors: Contributor[] } | null;
        };
        setContributors(json.data?.contributors ?? []);
      } catch {
        setContributors([]);
      } finally {
        setLoadingRollup(false);
      }
    }
  };

  const goNext = () => {
    if (!flow || !step) return;
    const value = step.kind === "text" ? "" : choice;

    if (step.kind !== "text" && !value) {
      setError("選択してください");
      return;
    }
    if (needsNote(step, value) && !note.trim()) {
      setError("補足の記入が必要です");
      return;
    }
    setError(null);

    const opt = step.options?.find((o) => o.value === value);
    const answer: FlowAnswer = {
      step_id: step.id,
      section: step.section,
      question: step.question,
      value,
      label: opt?.label ?? "",
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(step.kind === "auto"
        ? { system_value: systemVerdict, overridden: value !== systemVerdict }
        : {}),
    };

    const nextAnswers = [...answers, answer];
    setAnswers(nextAnswers);
    setNote("");
    setChoice("");
    setStepId(resolveNext(step, value));
  };

  const goBack = () => {
    if (answers.length === 0) {
      setStepId(null);
      return;
    }
    const prev = answers[answers.length - 1]!;
    setAnswers(answers.slice(0, -1));
    setStepId(prev.step_id);
    setChoice(prev.value);
    setNote(prev.note ?? "");
  };

  const save = async () => {
    if (!flow) return;
    setSaving(true);
    setError(null);
    try {
      const targets = collectTargets(flow, answers);
      const res = await fetch(`/api/admin/projects/${projectId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: flow.tier,
          fiscal_year: fiscalYear,
          status: "draft",
          result: summarizePath(flow, answers),
          findings: targets.findings ?? null,
          success_factors: targets.success_factors ?? null,
          barrier_factors: targets.barrier_factors ?? null,
          improvement_actions: targets.improvement_actions ?? null,
          next_steps: targets.next_steps ?? null,
          kpi_ids: selectedKpis,
          logic_model_id: logicModelId,
          measure_design_id: pickedMeasureId,
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
      reset();
      onSaved();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  // ─── フロー選択 ────────────────────────────────
  if (!flow) {
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        <div>
          <h3 className="text-sm font-semibold text-slate-200">評価フローを開始する</h3>
          <p className="text-xs text-slate-500 mt-1">
            策定方針の図6・図7に沿って、分岐に答えながら評価を記録します。通った経路は判断の根拠として保存されます。
          </p>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          {/* 図6v2（取組評価）は専用メニューのウィザードで実施する — ここには出さない */}
          {(["fig6", "fig7"] as FlowKey[]).map((k) => {
            const f = FLOWS[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFlowKey(k)}
                className="text-left rounded-xl border p-4 transition-colors hover:border-indigo-500/50"
                style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
              >
                <span className="block text-sm font-semibold text-slate-100">{f.label}</span>
                <span className="block text-[11px] text-slate-400 mt-1 leading-snug">{f.subtitle}</span>
                <span className="block text-[10px] text-slate-500 mt-2">{f.cycleNote}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── 対象KPIの選択 ─────────────────────────────
  if (!stepId && answers.length === 0) {
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{flow.label}</h3>
            <p className="text-xs text-slate-500 mt-1">{flow.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-xs px-3 py-1.5 rounded-lg shrink-0"
            style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
          >
            フローを選び直す
          </button>
        </div>

        <div style={{ maxWidth: 200 }}>
          <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
          <input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(parseInt(e.target.value, 10) || fiscalYear)}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {/* ── 施策から選ぶ（E5・推奨）────────────────────
            施策データセットには KPI・SPO指標・実験設計・コスト算定式が
            揃っている。ここから入ると評価の前提が一度に決まる。 */}
        {flow && measures && measures.length > 0 && (
          <div>
            <label className="text-xs text-slate-400 mb-2 block">
              評価する施策を選ぶ（施策構築（EBPM）で確定したもの）
            </label>
            <div className="space-y-1.5">
              {measures.map((m) => {
                const active = pickedMeasureId === m.id;
                const kpiIds = flow.tier === "outcome_intermediate"
                  ? m.kpi_ids_intermediate
                  : flow.tier === "outcome_initial"
                    ? m.kpi_ids_initial
                    : [...m.kpi_ids_initial, ...m.kpi_ids_intermediate];
                const hasControl =
                  m.experiment?.design != null && m.experiment.design !== "prepost";
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setPickedMeasureId(null);
                        return;
                      }
                      setPickedMeasureId(m.id);
                      setPickedElementId(null);
                      if (kpiIds.length > 0) setSelectedKpis(kpiIds);
                    }}
                    className="w-full text-left rounded-lg px-3 py-2.5 transition-colors"
                    style={{
                      background: active ? "#6366f11c" : "var(--bg-primary)",
                      border: `1px solid ${active ? "#6366f160" : "var(--border)"}`,
                    }}
                  >
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-100">{m.title}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={
                          m.evidence_status === "sufficient"
                            ? { background: "#10b98118", color: "#10b981" }
                            : { background: "#6366f118", color: "#818cf8" }
                        }
                      >
                        {m.evidence_status === "sufficient"
                          ? "エビデンスあり"
                          : m.experiment?.design
                            ? `実験中: ${m.experiment.design}`
                            : "エビデンス不足"}
                      </span>
                      {m.experiment?.design && (
                        <span className="text-[10px]" style={{ color: hasControl ? "#10b981" : "#f59e0b" }}>
                          {hasControl ? "対照あり（効果を比較で判定できます）" : "対照なし（前後比較のみ）"}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500">
                        KPI{kpiIds.length}件を選択
                      </span>
                    </span>
                    {active && (
                      <span className="block text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                        指標: 構造 {m.structure_indicators.map((x) => x.text).join("・") || "—"} ／
                        過程 {m.process_indicators.map((x) => x.text).join("・") || "—"}
                        {m.experiment?.primary_outcome && (
                          <> ／ 主要評価項目: {m.experiment.primary_outcome}</>
                        )}
                        {m.cost_per_outcome_note && <> ／ 効率性の算定式: {m.cost_per_outcome_note}</>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-600 mt-1.5">
              施策を選ぶと、その施策のKPI（このフローの評価スパン分）が下で選択され、
              評価レコードに「どの施策の評価か」が記録されます。
            </p>

            {/* 受領済み実績報告の所見・課題（S2 C① — 現場からの報告を評価の参考に） */}
            {pickedMeasureId && reportNotes.length > 0 && (
              <div
                className="mt-2 rounded-lg border p-3 space-y-2"
                style={{ background: "#06b6d40d", borderColor: "#06b6d430" }}
              >
                <p className="text-[11px] font-semibold" style={{ color: "#22d3ee" }}>
                  📮 実績報告の所見・課題（受領済みの回答より）
                </p>
                {reportNotes.map((r, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-[10px] text-slate-500">
                      {r.request_title}
                      {r.fiscal_year && `（${r.fiscal_year}年度）`}
                    </p>
                    {r.items.map((item, j) => (
                      <p key={j} className="text-[11px] text-slate-300 leading-relaxed">
                        <span className="text-slate-500">{item.label}: </span>
                        {item.value}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 成果から選ぶ（L5）──────────────────────────
            「どのKPIを評価するのか」から入ると、
            評価対象が計画のどの成果にあたるのかが曖昧になっていた。
            ロジックモデルで割り当てた対応（L3）をここで使い、
            「どの成果を評価するのか」から入れるようにする。 */}
        {outcomeChoices.length > 0 && (
          <div>
            <label className="text-xs text-slate-400 mb-2 block">
              評価する成果を選ぶ（ロジックモデルより）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {outcomeChoices.map((c) => {
                const active = pickedElementId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setPickedElementId(active ? null : c.id);
                      if (!active) setSelectedKpis(c.kpiIds);
                    }}
                    disabled={c.kpiIds.length === 0}
                    className="text-xs px-2.5 py-1.5 rounded-lg border text-left transition-colors disabled:opacity-40"
                    style={{
                      borderColor: active ? c.color : c.color + "40",
                      background: active ? c.color + "22" : c.color + "10",
                      color: "var(--text-primary)",
                    }}
                    title={
                      c.kpiIds.length === 0
                        ? "この成果にはKPIが割り当てられていません。ロジックモデル画面で割り当ててください"
                        : `KPI ${c.kpiIds.length}件を選択します`
                    }
                  >
                    {c.text.length > 24 ? `${c.text.slice(0, 24)}…` : c.text}
                    <span className="ml-1.5" style={{ color: c.kpiIds.length === 0 ? "#f59e0b" : c.color }}>
                      {c.kpiIds.length === 0 ? "⚠ KPI未割当" : `KPI${c.kpiIds.length}`}
                    </span>
                    {!c.tierMatches && (
                      <span className="ml-1.5" style={{ color: "#f59e0b" }}>
                        ※このフローの評価スパン外
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-600 mt-1.5">
              成果を選ぶと、その成果に割り当てたKPIが下で選択されます。個別に増減もできます。
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-slate-400 mb-2 block">
            評価対象のKPI（到達度の自動判定に使います）
          </label>
          {relevantKpis.length === 0 ? (
            <p className="text-xs text-slate-500">KPIが登録されていません。</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {relevantKpis.map((k) => {
                const isTier = normalizeIndicatorType(k.indicator_type) === flow.tier;
                const checked = selectedKpis.includes(k.id);
                return (
                  <label
                    key={k.id}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-colors"
                    style={{
                      background: checked ? "#6366f114" : "var(--bg-primary)",
                      border: `1px solid ${checked ? "#6366f140" : "var(--border)"}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedKpis((p) =>
                          e.target.checked ? [...p, k.id] : p.filter((x) => x !== k.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs text-slate-200 leading-snug">{k.label}</span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        現在 {k.current ?? "—"}{k.unit} ／ 目標 {k.target ?? "—"}{k.unit}
                        {!isTier && (
                          <span style={{ color: "#f59e0b" }}>　※このフローの評価スパンと異なる指標です</span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="button"
          onClick={() => void startFlow()}
          disabled={selectedKpis.length === 0}
          className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          評価を開始する
        </button>
        {selectedKpis.length === 0 && (
          <p className="text-[11px] text-slate-500">対象KPIを1つ以上選んでください。</p>
        )}
      </div>
    );
  }

  // ─── 完了（確認と保存）──────────────────────────
  if (!stepId) {
    return (
      <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
        <h3 className="text-sm font-semibold text-slate-200">
          {flow.label} — 記録内容の確認
        </h3>

        <div
          className="rounded-lg p-4 space-y-3"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
        >
          {answers.map((a, i) => (
            <div key={i}>
              <p className="text-[10px] text-slate-500">{a.section}</p>
              <p className="text-xs text-slate-400 leading-snug">{a.question}</p>
              {a.label && (
                <p className="text-sm font-semibold text-slate-100 mt-0.5">
                  → {a.label}
                  {a.overridden && (
                    <span className="ml-2 text-[10px] font-normal" style={{ color: "#f59e0b" }}>
                      （システム判定を上書き）
                    </span>
                  )}
                </p>
              )}
              {a.note && (
                <p className="text-xs text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">
                  {a.note}
                </p>
              )}
            </div>
          ))}
        </div>

        {achievements.length > 0 && (
          <div
            className="rounded-lg p-4"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
          >
            <p className="text-[11px] font-semibold text-slate-400 mb-2">
              到達度（保存時にこの値が記録されます）
            </p>
            <ul className="space-y-1.5">
              {achievements.map(({ kpi, ach }) => (
                <li key={kpi.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-slate-300 truncate">{kpi.label}</span>
                  <span
                    className="text-xs font-semibold tabular-nums shrink-0"
                    style={{ color: ach.achieved ? "#10b981" : ach.rate != null && ach.rate < 0 ? "#ef4444" : "#f59e0b" }}
                  >
                    {ach.rate == null ? "—" : `${ach.rate}%`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {saving ? "保存中..." : "評価として保存する"}
          </button>
          <button
            type="button"
            onClick={goBack}
            className="text-sm px-4 py-2 rounded-xl"
            style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
          >
            ← 前の設問へ戻る
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-sm px-4 py-2 rounded-xl"
            style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
          >
            破棄
          </button>
        </div>
      </div>
    );
  }

  // ─── 設問 ─────────────────────────────────────
  const totalSteps = Object.keys(flow.steps).length;
  const currentIndex = answers.length + 1;
  const showRollup = flow.key === "fig7" && step?.id === "caused_by_initial";

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] text-slate-500">{flow.label}</p>
          <h3 className="text-sm font-semibold text-slate-200">{step?.section}</h3>
        </div>
        <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">
          設問 {currentIndex} / 最大 {totalSteps}
        </span>
      </div>

      <div
        className="rounded-full overflow-hidden"
        style={{ height: 3, background: "var(--bg-input)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.min(100, (currentIndex / totalSteps) * 100)}%`,
            background: "#6366f1",
          }}
        />
      </div>

      <p className="text-base text-slate-100 leading-relaxed">{step?.question}</p>
      {step?.help && <p className="text-xs text-slate-500 leading-relaxed">{step.help}</p>}

      {/* auto ステップ: システム判定の提示 */}
      {step?.kind === "auto" && (
        <div
          className="rounded-lg p-4"
          style={{
            background: systemVerdict === "met" ? "#10b98110" : "#ef444410",
            border: `1px solid ${systemVerdict === "met" ? "#10b98140" : "#ef444440"}`,
          }}
        >
          <p
            className="text-xs font-semibold mb-2"
            style={{ color: systemVerdict === "met" ? "#10b981" : "#ef4444" }}
          >
            システムの判定: {systemVerdict === "met" ? "目標に達している" : "目標に達していない"}
          </p>
          <ul className="space-y-1">
            {achievements.map(({ kpi, ach }) => (
              <li key={kpi.id} className="text-[11px] text-slate-300 flex justify-between gap-3">
                <span className="truncate">{kpi.label}</span>
                <span className="tabular-nums shrink-0 text-slate-400">
                  {kpi.current ?? "—"}{kpi.unit} / 目標 {kpi.target ?? "—"}{kpi.unit}
                  <span className="ml-2" style={{ color: ach.achieved ? "#10b981" : "#f59e0b" }}>
                    到達度 {ach.rate == null ? "—" : `${ach.rate}%`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-500 mt-2">
            実態と異なる場合は、下で選び直してください（上書きしたことも記録されます）。
          </p>
        </div>
      )}

      {/* 図7: 短期アウトカムのロールアップ */}
      {showRollup && (
        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
        >
          <p className="text-[11px] font-semibold text-slate-400 mb-2">
            この中間アウトカムに寄与する短期アウトカムの状況
          </p>
          {loadingRollup ? (
            <AiThinkingIndicator label="短期アウトカムの評価履歴を集計しています" />
          ) : !contributors || contributors.length === 0 ? (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              寄与する短期アウトカムが登録されていません。KPIの「寄与する上位アウトカム」を設定すると、ここに短期の評価履歴が集約されます。
            </p>
          ) : (
            <ul className="space-y-2.5">
              {contributors.map((c) => (
                <li key={c.kpi_id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-slate-200 truncate">{c.label}</span>
                    <span
                      className="text-xs font-semibold tabular-nums shrink-0"
                      style={{ color: c.achieved ? "#10b981" : "#f59e0b" }}
                    >
                      {c.rate == null ? "—" : `${c.rate}%`}
                      {c.achieved ? "（達成）" : "（未達）"}
                    </span>
                  </div>
                  {c.evaluations.length === 0 ? (
                    <p className="text-[10px] text-slate-600 mt-0.5">短期評価の記録なし</p>
                  ) : (
                    <ul className="mt-1 ml-3 space-y-0.5">
                      {c.evaluations.map((e) => (
                        <li key={e.id} className="text-[10px] text-slate-400 leading-snug">
                          {e.fiscal_year ? `${e.fiscal_year}年度` : "年度未設定"}
                          {e.rate != null ? ` 到達度${e.rate}%` : ""}
                          {e.findings ? ` — ${e.findings}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 選択肢 */}
      {step && step.kind !== "text" && (
        <div className="space-y-2">
          {step.options?.map((o) => {
            const t = TONE[o.tone ?? "neutral"]!;
            const selected = choice === o.value;
            const isSystem = step.kind === "auto" && o.value === systemVerdict;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { setChoice(o.value); setError(null); }}
                className="w-full text-left rounded-lg px-4 py-2.5 text-sm transition-colors"
                style={{
                  background: selected ? t.bg : "var(--bg-primary)",
                  color: selected ? t.color : "#cbd5e1",
                  border: `1px solid ${selected ? t.color : "var(--border)"}`,
                }}
              >
                {o.label}
                {isSystem && (
                  <span className="ml-2 text-[10px] text-slate-500">（システム判定）</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 補足記述 */}
      {step && (step.kind === "text" || needsNote(step, choice)) && (
        <div>
          <label className="text-xs text-slate-400 mb-1 block">
            {step.notePrompt ?? "補足"}
            {(step.noteRequired || needsNote(step, choice)) && (
              <span style={{ color: "#f87171" }}> *</span>
            )}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={inputClass}
            style={inputStyle}
            placeholder={step.notePrompt ?? ""}
          />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={goNext}
          className="text-sm font-semibold px-5 py-2 rounded-xl text-white"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          次へ →
        </button>
        <button
          type="button"
          onClick={goBack}
          className="text-sm px-4 py-2 rounded-xl"
          style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
        >
          ← 戻る
        </button>
        <button
          type="button"
          onClick={reset}
          className="text-sm px-4 py-2 rounded-xl ml-auto"
          style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
        >
          破棄
        </button>
      </div>
    </div>
  );
}
