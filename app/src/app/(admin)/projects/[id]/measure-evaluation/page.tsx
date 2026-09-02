export const dynamic = "force-dynamic";

/**
 * 主要施策評価（計画期間・図7v2）— CA2-3（設計 claude/coe-ca2-design.md §1・§6・§8）。
 *
 * 一計画期間の単位で、中間アウトカム指標が確定したタイミングで行う。
 * 入力は取組毎評価から委任された課題。目的は
 *   ①次期計画における処遇（廃止・改変・統合・継続）を決める
 *   ②次期計画の主要施策形成時の効果性向上（中間アウトカム指標の改善）
 *   ③施策の改善だけでは解消できない課題を、次期計画のニーズ・セオリー評価へ引き継ぐ
 */

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { buildDueList, type DueSourceIndicator } from "@/lib/evaluation/duecheck";
import { causeTypeFromWorkFlow } from "@/lib/evaluation/judgmentFromFlow";
import type { IndicatorSnapshotItem } from "@/lib/evaluation/indicatorSnapshot";
import MeasureEvaluationClient from "./MeasureEvaluationClient";

export interface MeasureRow {
  id: string;
  title: string;
  status: string;
  execution_rate_note: string | null;
  experiment: { design?: string; primary_outcome?: string } | null;
}

export interface MeasureEvalRow {
  id: string;
  measure_design_id: string | null;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  approved_snapshot_at: string | null;
  flow_decision_path: { flow?: string; answers?: { step_id: string; value: string; label: string }[] } | null;
  created_at: string;
  /** 図E1の判定（060）。report_no が null なら判定保留 */
  judgment_path: string | null;
  report_no: number | null;
  route: string | null;
  standard_treatment: string | null;
  decided_treatment: string | null;
  rationale_required: boolean;
  rationale: string | null;
}

/**
 * 取組評価のロールアップ（図7e1 工程3「起因」の材料 ＝ 共通ヘッダ④ 初期アウトカムの年次履歴）。
 * 因果判断（実行起因／論理起因の切り分け）の唯一の根拠なので、年度ごとの初期アウトカム（No.7）の
 * 実績・達否と、図6の回答から切り分けた起因の型を添える。
 */
export interface WorkEvalSummary {
  measure_design_id: string;
  measure_work_id: string;
  work_code: string;
  work_title: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  /** No.7 初期アウトカムの実績（凍結値があればそれ） */
  initial_outcome: string | null;
  initial_achieved: boolean | null;
  /** 実行（未実施／量が出ない…）／論理／測定／外部要因 — causeTypeFromWorkFlow */
  cause_type: string;
}

export interface DelegationRow {
  id: string;
  measure_design_id: string | null;
  measure_work_id: string | null;
  work_code: string | null;
  level: string;
  title: string;
  detail: string | null;
  root_cause: string | null;
  status: string;
}

export default async function MeasureEvaluationPage({ params }: { params: { id: string } }) {
  const project = await queryOne<{
    id: string;
    title: string;
    plan_start_date: string | null;
    plan_end_date: string | null;
  }>(
    `SELECT id, title,
            to_char(plan_start_date, 'YYYY-MM-DD') AS plan_start_date,
            to_char(plan_end_date,   'YYYY-MM-DD') AS plan_end_date
       FROM projects WHERE id = $1`,
    [params.id],
  );
  if (!project) notFound();

  const [measures, evaluations, workEvals, delegations, benchmarkCounts] = await Promise.all([
    query<MeasureRow>(
      `SELECT id, title, status, execution_rate_note, experiment
         FROM measure_designs
        WHERE project_id = $1
        ORDER BY sort_order, created_at`,
      [params.id],
    ).catch(() => [] as MeasureRow[]),
    // 主要施策評価（取組が紐づかない outcome_intermediate）
    query<MeasureEvalRow>(
      `SELECT id, measure_design_id, fiscal_year, status, result,
              approved_snapshot_at::text AS approved_snapshot_at,
              flow_decision_path, created_at::text AS created_at,
              judgment_path, report_no, route, standard_treatment, decided_treatment,
              rationale_required, rationale
         FROM program_evaluations
        WHERE project_id = $1
          AND measure_work_id IS NULL
          AND evaluation_tier = 'outcome_intermediate'
          AND measure_design_id IS NOT NULL
        ORDER BY created_at DESC`,
      [params.id],
    ).catch(() => [] as MeasureEvalRow[]),
    query<{
      measure_design_id: string; measure_work_id: string; work_code: string; work_title: string;
      fiscal_year: number | null; status: string; result: string | null;
      indicator_snapshot: IndicatorSnapshotItem[] | null;
      flow_decision_path: { answers?: { step_id: string; value?: string | null }[] } | null;
    }>(
      `SELECT pe.measure_design_id, pe.measure_work_id,
              w.code AS work_code, w.title AS work_title,
              pe.fiscal_year, pe.status, pe.result,
              pe.indicator_snapshot, pe.flow_decision_path
         FROM program_evaluations pe
         JOIN measure_works w ON w.id = pe.measure_work_id
        WHERE pe.project_id = $1 AND pe.measure_work_id IS NOT NULL
        ORDER BY w.sort_order, pe.fiscal_year`,
      [params.id],
    )
      .then((rows) =>
        rows.map((r): WorkEvalSummary => {
          const snap = Array.isArray(r.indicator_snapshot) ? r.indicator_snapshot : [];
          const item = snap.find((i) => i.category_no === 7);
          return {
            measure_design_id: r.measure_design_id,
            measure_work_id: r.measure_work_id,
            work_code: r.work_code,
            work_title: r.work_title,
            fiscal_year: r.fiscal_year,
            status: r.status,
            result: r.result,
            initial_outcome:
              item?.result_value != null
                ? `${item.result_value}${item.unit ? ` ${item.unit}` : ""}`
                : (item?.result_text ?? null),
            initial_achieved: item?.achieved ?? null,
            cause_type: causeTypeFromWorkFlow(r.flow_decision_path?.answers ?? []),
          };
        }),
      )
      .catch(() => [] as WorkEvalSummary[]),
    query<DelegationRow>(
      `SELECT d.id, d.measure_design_id, d.measure_work_id,
              w.code AS work_code, d.level, d.title, d.detail, d.root_cause, d.status
         FROM evaluation_delegations d
         LEFT JOIN measure_works w ON w.id = d.measure_work_id
        WHERE d.project_id = $1
        ORDER BY d.created_at`,
      [params.id],
    ).catch(() => [] as DelegationRow[]),
    query<{ measure_design_id: string; n: number }>(
      `SELECT i.measure_design_id, count(*)::int AS n
         FROM measure_indicator_benchmarks b
         JOIN measure_indicators i ON i.id = b.measure_indicator_id
        WHERE i.project_id = $1
        GROUP BY i.measure_design_id`,
      [params.id],
    ).catch(() => [] as { measure_design_id: string; n: number }[]),
  ]);

  // 評価予定（CA2-4）— 主要施策レベルの指標（No.8 等）の評価時点
  const [indicatorRows, allEvals] = await Promise.all([
    query<{
      id: string; category_no: number; label: string;
      measure_work_id: string | null; measure_design_id: string;
      checkpoint_id: string | null; cp_label: string | null;
      relative_year: number | null; relative_period: string | null;
      absolute_date: string | null; evaluation_type: string | null;
    }>(
      `SELECT i.id, i.category_no, i.label, i.measure_work_id, i.measure_design_id,
              c.id AS checkpoint_id, c.label AS cp_label,
              c.relative_year, c.relative_period,
              to_char(c.absolute_date, 'YYYY-MM-DD') AS absolute_date,
              c.evaluation_type
         FROM measure_indicators i
         JOIN measure_indicator_checkpoints c ON c.measure_indicator_id = i.id
        WHERE i.project_id = $1
        ORDER BY c.sort_order`,
      [params.id],
    ).catch(() => []),
    query<{
      id: string; measure_work_id: string | null; measure_design_id: string | null;
      fiscal_year: number | null; evaluation_tier: string;
    }>(
      `SELECT id, measure_work_id, measure_design_id, fiscal_year, evaluation_tier
         FROM program_evaluations WHERE project_id = $1`,
      [params.id],
    ).catch(() => []),
  ]);

  const byIndicator = new Map<string, DueSourceIndicator>();
  for (const r of indicatorRows) {
    if (!r.checkpoint_id) continue;
    const cur = byIndicator.get(r.id) ?? {
      id: r.id,
      category_no: r.category_no,
      label: r.label,
      measure_work_id: r.measure_work_id,
      measure_design_id: r.measure_design_id,
      checkpoints: [],
    };
    cur.checkpoints.push({
      id: r.checkpoint_id,
      measure_indicator_id: r.id,
      label: r.cp_label ?? "評価時点",
      relative_year: r.relative_year,
      relative_period: r.relative_period,
      absolute_date: r.absolute_date,
      evaluation_type: r.evaluation_type,
    });
    byIndicator.set(r.id, cur);
  }
  const planStartYear = project.plan_start_date
    ? Number(project.plan_start_date.slice(0, 4))
    : new Date().getFullYear();
  const dueItems = buildDueList(
    Array.from(byIndicator.values()),
    allEvals,
    planStartYear,
    new Date().toISOString().slice(0, 10),
  );

  return (
    <MeasureEvaluationClient
      project={project}
      measures={measures}
      evaluations={evaluations}
      workEvals={workEvals}
      delegations={delegations}
      benchmarkCounts={benchmarkCounts}
      dueItems={dueItems}
    />
  );
}
