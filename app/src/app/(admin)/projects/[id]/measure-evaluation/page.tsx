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
}

/** 取組評価のロールアップ（図7v2 工程2の材料） */
export interface WorkEvalSummary {
  measure_design_id: string;
  measure_work_id: string;
  work_code: string;
  work_title: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
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
              flow_decision_path, created_at::text AS created_at
         FROM program_evaluations
        WHERE project_id = $1
          AND measure_work_id IS NULL
          AND evaluation_tier = 'outcome_intermediate'
          AND measure_design_id IS NOT NULL
        ORDER BY created_at DESC`,
      [params.id],
    ).catch(() => [] as MeasureEvalRow[]),
    query<WorkEvalSummary>(
      `SELECT pe.measure_design_id, pe.measure_work_id,
              w.code AS work_code, w.title AS work_title,
              pe.fiscal_year, pe.status, pe.result
         FROM program_evaluations pe
         JOIN measure_works w ON w.id = pe.measure_work_id
        WHERE pe.project_id = $1 AND pe.measure_work_id IS NOT NULL
        ORDER BY w.sort_order, pe.fiscal_year`,
      [params.id],
    ).catch(() => [] as WorkEvalSummary[]),
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

  return (
    <MeasureEvaluationClient
      project={project}
      measures={measures}
      evaluations={evaluations}
      workEvals={workEvals}
      delegations={delegations}
      benchmarkCounts={benchmarkCounts}
    />
  );
}
