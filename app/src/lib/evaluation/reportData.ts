import "server-only";

/**
 * 評価報告書の材料を集める（CA2-5）。
 *
 * 原則: **報告書は評価の記録を写すもので、作り直さない。**
 *   - 指標は `indicator_snapshot`（承認時に凍結したもの）を優先し、
 *     まだ凍結されていない下書きのときだけ現在値から組む（その旨を注記する）
 *   - 判定経路は `flow_decision_path` をそのまま文章化する（AIに書かせない）
 *   - 到達度・達成の判定は保存済みの値を使い、ここで再判定しない
 */

import { query, queryOne } from "@/lib/db";
import { getFlow, type FlowAnswer } from "@/lib/evaluation/flow";
import { buildIndicatorSnapshot, type IndicatorSnapshotItem } from "@/lib/evaluation/indicatorSnapshot";
import { computeActivityRate } from "@/lib/evaluation/activityStats";
import { fiscalYearLabel, FUNDING_SOURCES } from "@/lib/measure/indicators";
import type { ReportKind } from "@/lib/evaluation/reportTemplate";
import {
  COMPARISON_GRADE_META,
  EXEMPTION_META,
  ISSUE_CLASS_META,
  ROUTE_META,
  fiscalEffectRate,
  partialPath,
  type ContributionPathway,
  type JudgmentExemption,
  type StoredFiscalEffect,
  type StoredJudgment,
} from "@/lib/evaluation/judgment";
import { causeTypeFromWorkFlow, judgeFromFlow } from "@/lib/evaluation/judgmentFromFlow";
import type {
  ReportActivityRow,
  ReportAnnualHistoryRow,
  ReportBenchmarkRow,
  ReportCostRow,
  ReportDelegationRow,
  ReportFiscalEffect,
  ReportJudgment,
  ReportKeyValue,
  ReportOutcomeSummary,
  ReportPathRow,
  ReportTreatment,
  ReportWorkRollupRow,
} from "@/lib/evaluation/reportRows";
import { withUnit } from "@/lib/evaluation/reportRows";

export type {
  ReportActivityRow,
  ReportAnnualHistoryRow,
  ReportBenchmarkRow,
  ReportCostRow,
  ReportDelegationRow,
  ReportFiscalEffect,
  ReportJudgment,
  ReportKeyValue,
  ReportOutcomeSummary,
  ReportPathRow,
  ReportTreatment,
  ReportWorkRollupRow,
} from "@/lib/evaluation/reportRows";

export interface EvaluationReportData {
  kind: ReportKind;
  /** 文書の見出しに出す対象名（取組名 or 施策名） */
  subject: string;
  project_title: string;
  municipality: string;
  fiscal_year: number | null;
  status: string;
  /** 承認して凍結済みか。未凍結なら報告書に「暫定」と刷る */
  frozen: boolean;
  approved_at: string | null;
  keyValues: ReportKeyValue[];
  indicators: IndicatorSnapshotItem[];
  path: ReportPathRow[];
  narrative: {
    findings: string;
    barrier_factors: string;
    improvement_actions: string;
    next_steps: string;
    result: string;
  };
  delegations: ReportDelegationRow[];
  workRollup: ReportWorkRollupRow[];
  costs: ReportCostRow[];
  benchmarks: ReportBenchmarkRow[];
  activities: ReportActivityRow[];
  /** 様式F7-0 ② 評価過程 */
  judgment: ReportJudgment;
  /** 様式F7-0 ③ 成果の要約 */
  outcome: ReportOutcomeSummary | null;
  /** 様式F7-0 ④ 初期アウトカムの年次履歴 */
  annualHistory: ReportAnnualHistoryRow[];
  /** 様式F7-0 ⑥ 財政効果率 */
  fiscalEffect: ReportFiscalEffect;
  /** 様式F7-0 ⑦ 処遇 */
  treatment: ReportTreatment;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  in_review: "レビュー中",
  approved: "承認済み",
};

const DELEGATION_STATUS_LABEL: Record<string, string> = {
  open: "未対応（上位評価へ委任中）",
  addressed: "対応済み",
  carried_over: "次期計画へ引き継ぎ",
};

/** flow_decision_path を表にする（保存された経路をそのまま写す） */
function pathRows(flowKey: string | undefined, answers: FlowAnswer[]): ReportPathRow[] {
  const flow = getFlow(flowKey);
  return answers.map((a) => {
    const step = flow?.steps[a.step_id];
    const systemLabel =
      a.overridden && a.system_value
        ? (step?.options?.find((o) => o.value === a.system_value)?.label ?? a.system_value)
        : "";
    return {
      section: a.section,
      question: a.question,
      answer: a.label || (a.note ? "（記述）" : ""),
      note: a.note ?? "",
      overridden: systemLabel ? `システム判定「${systemLabel}」を担当者が変更` : "",
    };
  });
}

export async function buildEvaluationReportData(
  projectId: string,
  evalId: string,
): Promise<EvaluationReportData | null> {
  const ev = await queryOne<{
    id: string;
    evaluation_tier: string;
    fiscal_year: number | null;
    status: string;
    result: string | null;
    findings: string | null;
    barrier_factors: string | null;
    improvement_actions: string | null;
    next_steps: string | null;
    flow_decision_path: { flow?: string; answers?: FlowAnswer[] } | null;
    indicator_snapshot: IndicatorSnapshotItem[] | null;
    approved_snapshot_at: string | null;
    measure_design_id: string | null;
    measure_work_id: string | null;
    measure_title: string | null;
    work_code: string | null;
    work_title: string | null;
    execution_rate_note: string | null;
    project_title: string;
    municipality: string;
    // 060: 図E1の判定・処遇（評価側）と、寄与経路・適用除外（施策側）
    judgment: StoredJudgment | null;
    judgment_path: string | null;
    report_no: number | null;
    decided_treatment: string | null;
    rationale_required: boolean | null;
    rationale: string | null;
    comparison_grade: "A" | "B" | "C" | "D" | null;
    fiscal_effect: StoredFiscalEffect | null;
    contribution_pathways: ContributionPathway[] | null;
    judgment_exemption: JudgmentExemption | null;
  }>(
    `SELECT pe.id, pe.evaluation_tier, pe.fiscal_year, pe.status, pe.result,
            pe.findings, pe.barrier_factors, pe.improvement_actions, pe.next_steps,
            pe.flow_decision_path, pe.indicator_snapshot,
            pe.approved_snapshot_at::text AS approved_snapshot_at,
            pe.measure_design_id, pe.measure_work_id,
            pe.judgment, pe.judgment_path, pe.report_no, pe.decided_treatment,
            pe.rationale_required, pe.rationale, pe.comparison_grade, pe.fiscal_effect,
            md.contribution_pathways, md.judgment_exemption,
            md.title AS measure_title, md.execution_rate_note,
            w.code AS work_code, w.title AS work_title,
            p.title AS project_title, m.name AS municipality
       FROM program_evaluations pe
       LEFT JOIN measure_designs md ON md.id = pe.measure_design_id
       LEFT JOIN measure_works w    ON w.id = pe.measure_work_id
       JOIN projects p              ON p.id = pe.project_id
       JOIN municipalities m        ON m.id = p.municipality_id
      WHERE pe.id = $1 AND pe.project_id = $2`,
    [evalId, projectId],
  );
  if (!ev) return null;

  const kind: ReportKind = ev.measure_work_id ? "work" : "measure";
  const frozen = Boolean(ev.approved_snapshot_at);

  // 指標: 凍結済みならそれを使う。未凍結なら現在値から組み、暫定である旨を報告書に刷る
  let indicators: IndicatorSnapshotItem[] = Array.isArray(ev.indicator_snapshot)
    ? ev.indicator_snapshot
    : [];
  if (indicators.length === 0 && ev.measure_design_id) {
    const built = await buildIndicatorSnapshot(
      projectId,
      ev.measure_design_id,
      ev.measure_work_id,
      ev.fiscal_year,
    );
    indicators = built.items;
  }

  // 委任 — 取組評価は「委任した課題」、主要施策評価は「委任された課題」
  const delegationRows = await query<{
    title: string;
    detail: string | null;
    root_cause: string | null;
    status: string;
    level: string;
    work_code: string | null;
  }>(
    kind === "work"
      ? `SELECT d.title, d.detail, d.root_cause, d.status, d.level, w.code AS work_code
           FROM evaluation_delegations d
           LEFT JOIN measure_works w ON w.id = d.measure_work_id
          WHERE d.project_id = $1 AND d.from_evaluation_id = $2
          ORDER BY d.created_at`
      : `SELECT d.title, d.detail, d.root_cause, d.status, d.level, w.code AS work_code
           FROM evaluation_delegations d
           LEFT JOIN measure_works w ON w.id = d.measure_work_id
          WHERE d.project_id = $1
            AND (d.addressed_in_evaluation_id = $2 OR d.from_evaluation_id = $2)
          ORDER BY d.level, d.created_at`,
    [projectId, evalId],
  ).catch(() => []);

  const delegations: ReportDelegationRow[] = delegationRows.map((d) => ({
    origin:
      d.level === "to_next_plan"
        ? "次期計画へ"
        : d.work_code
          ? `取組 ${d.work_code}`
          : "取組評価",
    title: d.title,
    detail: d.detail ?? "",
    root_cause: d.root_cause ?? "",
    status: DELEGATION_STATUS_LABEL[d.status] ?? d.status,
  }));

  // 取組評価のロールアップ（主要施策評価のみ）
  const workRollup: ReportWorkRollupRow[] =
    kind === "measure" && ev.measure_design_id
      ? (
          await query<{
            code: string;
            title: string;
            fiscal_year: number | null;
            status: string;
            result: string | null;
          }>(
            `SELECT w.code, w.title, pe.fiscal_year, pe.status, pe.result
               FROM program_evaluations pe
               JOIN measure_works w ON w.id = pe.measure_work_id
              WHERE pe.project_id = $1 AND w.measure_design_id = $2
              ORDER BY w.sort_order, pe.fiscal_year`,
            [projectId, ev.measure_design_id],
          ).catch(() => [])
        ).map((r) => ({
          code: r.code,
          title: r.title,
          fiscal_year: r.fiscal_year != null ? fiscalYearLabel(r.fiscal_year) : "—",
          status: STATUS_LABEL[r.status] ?? r.status,
          result: r.result ?? "",
        }))
      : [];

  // 年度別コスト（取組評価は当該年度のみ、主要施策評価は全年度）
  const costRows = ev.measure_design_id
    ? await query<{
        fiscal_year: number;
        total_amount: number | null;
        funding: Record<string, number | null> | null;
        note: string | null;
      }>(
        `SELECT fiscal_year, total_amount::float AS total_amount, funding, note
           FROM measure_cost_years
          WHERE measure_design_id = $1
          ORDER BY fiscal_year`,
        [ev.measure_design_id],
      ).catch(() => [])
    : [];
  const costs: ReportCostRow[] = costRows
    .filter((c) => kind === "measure" || ev.fiscal_year == null || c.fiscal_year === ev.fiscal_year)
    .map((c) => ({
      fiscal_year: fiscalYearLabel(c.fiscal_year),
      total: c.total_amount != null ? `¥${c.total_amount.toLocaleString()}` : "—",
      funding: FUNDING_SOURCES.map((s) => {
        const v = c.funding?.[s.key];
        return v ? `${s.label} ¥${Number(v).toLocaleString()}` : null;
      })
        .filter(Boolean)
        .join(" ／ "),
      note: c.note ?? "",
    }));

  // 他団体比較（主要施策評価のみ）
  const benchmarks: ReportBenchmarkRow[] =
    kind === "measure" && ev.measure_design_id
      ? (
          await query<{
            indicator: string;
            unit: string | null;
            comparator: string;
            value: number;
            fiscal_year: number | null;
            source_name: string;
            indicator_id: string;
          }>(
            `SELECT i.label AS indicator, i.unit, b.comparator, b.value::float AS value,
                    b.fiscal_year, b.source_name, i.id AS indicator_id
               FROM measure_indicator_benchmarks b
               JOIN measure_indicators i ON i.id = b.measure_indicator_id
              WHERE i.project_id = $1 AND i.measure_design_id = $2
              ORDER BY i.category_no, b.comparator`,
            [projectId, ev.measure_design_id],
          ).catch(() => [])
        ).map((b) => {
          const own = indicators.find((i) => i.indicator_id === b.indicator_id);
          return {
            indicator: b.indicator,
            comparator: b.comparator,
            value: withUnit(b.value, b.unit),
            own: own?.result_value != null ? withUnit(own.result_value, b.unit) : "—",
            fiscal_year: b.fiscal_year != null ? fiscalYearLabel(b.fiscal_year) : "—",
            source: b.source_name,
          };
        })
      : [];

  // 実施記録（取組評価のみ・No.5の内訳）
  const activities: ReportActivityRow[] =
    kind === "work" && ev.measure_work_id && ev.fiscal_year != null
      ? (await computeActivityRate(projectId, ev.measure_work_id, ev.fiscal_year)).breakdown.map(
          (b) => ({
            title: b.title,
            planned: `${b.planned}件`,
            completed: `${b.completed}件`,
          }),
        )
      : [];

  const answers = ev.flow_decision_path?.answers ?? [];
  const flowKey = ev.flow_decision_path?.flow;
  const flow = getFlow(flowKey);

  // ── 様式F7-0 ② 評価過程（図E1の判定）──────────────────────
  // 現行フローは図E1の4問と設問が一致しないため、写せるところまで写し、
  // 足りなければ「判定保留」とする（様式集の正規の状態。処遇は行わない）。
  const { result: judgment, missing } = judgeFromFlow(flowKey, answers, ev.judgment);
  const exemption = ev.judgment_exemption;
  const judgmentRow: ReportJudgment = judgment
    ? {
        path: judgment.path,
        report_no: judgment.pattern.no,
        report_title: judgment.pattern.title,
        state: judgment.pattern.state,
        route: `${judgment.pattern.route} ${ROUTE_META[judgment.pattern.route].name}（審議: ${ROUTE_META[judgment.pattern.route].review}）`,
        standard_treatment: judgment.pattern.standardTreatment,
        issue_class:
          judgment.pattern.issueClass === "none"
            ? "（軽微）"
            : ISSUE_CLASS_META[judgment.pattern.issueClass].name,
        approach: judgment.pattern.approach,
        missing: [],
        pending: false,
      }
    : {
        // 保留でも「どこまで進んだか」は出す（例: A→E→?）
        path: ev.judgment_path ?? partialPath(ev.judgment ?? null),
        report_no: null,
        report_title: exemption ? `適用除外（${EXEMPTION_META[exemption.kind].name}）` : "判定保留",
        state: exemption
          ? `${EXEMPTION_META[exemption.kind].detail}${exemption.reason ? `／理由: ${exemption.reason}` : ""}`
          : "判定に必要なデータが揃っていない",
        route: "—（どのルートにも進まない）",
        standard_treatment: "—（処遇を行わない）",
        issue_class: ISSUE_CLASS_META.IV.name,
        approach: "測定設計の立て直し（対照群設計・KPIツリー・比較の段の引き上げ）",
        missing: missing.length > 0 ? missing : ["①成果は目標値に達したか"],
        pending: true,
      };

  // ── 様式F7-0 ③ 成果 ─────────────────────────────────────
  // ベースライン（自然体推計）・X・比較の段は入力欄が未実装（migration 060 待ち）。
  // 埋められない欄は「未入力」と刷る。空白のまま提出させないため省略しない。
  const outcomeNo = kind === "measure" ? 8 : 7;
  const outcomeItem = indicators.find((i) => i.category_no === outcomeNo);
  const outcome: ReportOutcomeSummary | null = outcomeItem
    ? {
        indicator: outcomeItem.label,
        baseline: withUnit(outcomeItem.baseline_value, outcomeItem.unit),
        target: withUnit(outcomeItem.target_value, outcomeItem.unit),
        result:
          outcomeItem.result_value != null
            ? withUnit(outcomeItem.result_value, outcomeItem.unit)
            : (outcomeItem.result_text ?? "—"),
        natural_baseline:
          outcomeItem.natural_baseline != null
            ? `${withUnit(outcomeItem.natural_baseline, outcomeItem.unit)}${outcomeItem.baseline_source ? `（${outcomeItem.baseline_source}）` : ""}`
            : "未入力",
        x:
          outcomeItem.natural_baseline != null && outcomeItem.result_value != null
            ? `${withUnit(Math.round((outcomeItem.result_value - outcomeItem.natural_baseline) * 1000) / 1000, outcomeItem.unit)}（実績 − ベースライン。目標値との差ではない）`
            : "未算定（実績またはベースラインが未入力。目標値との差ではない）",
        comparison_grade: ev.comparison_grade
          ? `${ev.comparison_grade} ${COMPARISON_GRADE_META[ev.comparison_grade].name}`
          : "未入力",
      }
    : null;

  // ── 様式F7-0 ④ 初期アウトカムの年次履歴 ─────────────────
  const annualHistory: ReportAnnualHistoryRow[] =
    kind === "measure" && ev.measure_design_id
      ? (
          await query<{
            code: string;
            title: string;
            fiscal_year: number | null;
            indicator_snapshot: IndicatorSnapshotItem[] | null;
            flow_decision_path: { answers?: FlowAnswer[] } | null;
          }>(
            `SELECT w.code, w.title, pe.fiscal_year, pe.indicator_snapshot, pe.flow_decision_path
               FROM program_evaluations pe
               JOIN measure_works w ON w.id = pe.measure_work_id
              WHERE pe.project_id = $1 AND w.measure_design_id = $2
              ORDER BY pe.fiscal_year, w.sort_order`,
            [projectId, ev.measure_design_id],
          ).catch(() => [])
        ).map((r) => {
          const snap = Array.isArray(r.indicator_snapshot) ? r.indicator_snapshot : [];
          const item = snap.find((i) => i.category_no === 7);
          return {
            fiscal_year: r.fiscal_year != null ? fiscalYearLabel(r.fiscal_year) : "—",
            work: `${r.code} ${r.title}`,
            indicator: item?.label ?? "—",
            result:
              item?.result_value != null
                ? withUnit(item.result_value, item.unit)
                : (item?.result_text ?? "—"),
            achieved: item?.achieved == null ? "—" : item.achieved ? "達成" : "未達",
            cause_type: causeTypeFromWorkFlow(r.flow_decision_path?.answers ?? []),
          };
        })
      : [];

  // ── 様式F7-0 ⑥ 財政効果率 ───────────────────────────────
  // 評価側に保存した期末実績（fiscal_effect・060）を写す。承認済みならそのまま凍結値。
  // 無ければ事業費だけを示し「保留」と明示する（推計不能→処遇せず測定課題Ⅳ）。
  const totalCost = costRows.reduce((s, c) => s + (c.total_amount ?? 0), 0);
  const storedFe = ev.fiscal_effect;
  const fe = fiscalEffectRate({
    fiscalEffect: storedFe?.effect_total ?? null,
    totalCost: storedFe?.cost_total ?? (totalCost > 0 ? totalCost : null),
  });
  const pathwayDefs = Array.isArray(ev.contribution_pathways) ? ev.contribution_pathways : [];
  const pathwayText =
    storedFe && storedFe.pathways.length > 0
      ? storedFe.pathways
          .map((p) => {
            const def = pathwayDefs.find((d) => d.key === p.pathway_key);
            const amount = p.cumulative != null ? `累計 ¥${p.cumulative.toLocaleString()}` : "未入力";
            const annual = p.annual != null ? `／年額 ¥${p.annual.toLocaleString()}` : "";
            return `${p.label ?? def?.label ?? p.pathway_key}（${def?.formula ?? "推計式未記載"}）: ${amount}${annual}${p.basis ? `／根拠: ${p.basis}` : ""}`;
          })
          .join("\n")
      : pathwayDefs.length > 0
        ? pathwayDefs.map((d) => `${d.label}（${d.formula}）: 期末実績 未入力`).join("\n")
        : "未定義（分野ごとに寄与経路と経路別推計式を施策データセットで定義する）";
  const fiscalEffect: ReportFiscalEffect = {
    pathways: pathwayText,
    effect: storedFe?.effect_total != null ? `¥${storedFe.effect_total.toLocaleString()}` : "未入力",
    cost:
      storedFe?.cost_total != null
        ? `¥${storedFe.cost_total.toLocaleString()}`
        : totalCost > 0
          ? `¥${totalCost.toLocaleString()}`
          : "—",
    rate: fe.rate != null ? `${fe.rate}%` : "算定不能",
    mark: exemption
      ? `適用除外（${EXEMPTION_META[exemption.kind].name}）`
      : (fe.mark ?? "保留（測定課題Ⅳとして記録し、処遇は行わない）"),
    formula: fe.formula,
    note: fe.note,
  };

  // ── 様式F7-0 ⑦ 処遇 ─────────────────────────────────────
  // 決定処遇は評価側の decided_treatment（060）。無ければ「未決定」。
  // 標準処遇と異なれば理由書（H4）の要否と、その要旨を写す。
  const treatment: ReportTreatment = {
    route: judgmentRow.route,
    standard: judgmentRow.standard_treatment,
    decided: ev.decided_treatment ?? (judgment ? "未決定（処遇決定会議・答申を経て確定）" : "—（処遇を行わない）"),
    rationale: ev.rationale_required
      ? `要（標準処遇と異なる決定。様式H4）${ev.rationale ? `: ${ev.rationale}` : " — 理由未記入"}`
      : "—",
  };

  const subject =
    kind === "work"
      ? `${ev.work_code ?? ""} ${ev.work_title ?? ""}`.trim()
      : (ev.measure_title ?? "");

  const keyValues: ReportKeyValue[] = [
    { label: "計画", value: ev.project_title },
    { label: "団体", value: ev.municipality },
    { label: kind === "work" ? "評価の対象（取組）" : "評価の対象（主要施策）", value: subject },
    ...(kind === "work" && ev.measure_title
      ? [{ label: "属する主要施策", value: ev.measure_title }]
      : []),
    {
      label: kind === "work" ? "対象年度" : "評価時点",
      value: ev.fiscal_year != null ? fiscalYearLabel(ev.fiscal_year) : "—",
    },
    { label: "評価の枠組み", value: flow ? `${flow.label}（${flow.subtitle}）` : "—" },
    { label: "評価の状態", value: STATUS_LABEL[ev.status] ?? ev.status },
    {
      label: "指標実績の凍結",
      value: frozen ? `承認時に凍結（${(ev.approved_snapshot_at ?? "").slice(0, 10)}）` : "未凍結（暫定値）",
    },
    ...(ev.execution_rate_note ? [{ label: "執行率の算定式", value: ev.execution_rate_note }] : []),
    ...(indicators.some((i) => i.category_no === 5 && i.activity_rate != null)
      ? [
          {
            label: "実施率（No.5）",
            value: (() => {
              const i = indicators.find((x) => x.category_no === 5 && x.activity_rate != null)!;
              return `${i.activity_rate}%（${i.activity_completed}/${i.activity_planned}件）`;
            })(),
          },
        ]
      : []),
  ];

  return {
    kind,
    subject,
    project_title: ev.project_title,
    municipality: ev.municipality,
    fiscal_year: ev.fiscal_year,
    status: ev.status,
    frozen,
    approved_at: ev.approved_snapshot_at,
    keyValues,
    indicators,
    path: pathRows(flowKey, answers),
    narrative: {
      findings: ev.findings ?? "",
      barrier_factors: ev.barrier_factors ?? "",
      improvement_actions: ev.improvement_actions ?? "",
      next_steps: ev.next_steps ?? "",
      result: ev.result ?? "",
    },
    delegations,
    workRollup,
    costs,
    benchmarks,
    activities,
    judgment: judgmentRow,
    outcome,
    annualHistory,
    fiscalEffect,
    treatment,
  };
}
