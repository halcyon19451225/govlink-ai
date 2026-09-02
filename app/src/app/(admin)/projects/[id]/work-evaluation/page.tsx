export const dynamic = "force-dynamic";

/**
 * 取組評価（年次・図6v2）— CA2-2（設計 claude/coe-ca2-design.md §1・§5・§8）。
 *
 * 評価者は取組の担当者レベル。目的は
 *   ①次年度以降の取組の効果性向上（初期アウトカム指標の改善）
 *   ②取組の改善だけでは解消できない課題の、主要施策毎評価への委任
 * 単位は measure_works（057の二層の下段）。判定材料は指標（057）と実績（058）。
 */

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import WorkEvaluationClient from "./WorkEvaluationClient";

export interface WorkRow {
  id: string;
  measure_design_id: string;
  code: string;
  title: string;
  owner_department: string | null;
}

export interface MeasureRow {
  id: string;
  title: string;
  status: string;
  execution_rate_note: string | null;
  experiment: { design?: string; primary_outcome?: string; considered?: unknown[] } | null;
}

export interface WorkEvalRow {
  id: string;
  measure_work_id: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  approved_snapshot_at: string | null;
  created_at: string;
}

export interface DelegationCountRow {
  measure_work_id: string;
  open_count: number;
}

export default async function WorkEvaluationPage({ params }: { params: { id: string } }) {
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

  const [measures, works, evaluations, delegationCounts] = await Promise.all([
    query<MeasureRow>(
      `SELECT DISTINCT md.id, md.title, md.status, md.execution_rate_note, md.experiment
         FROM measure_designs md
         JOIN measure_works w ON w.measure_design_id = md.id AND NOT w.retired
        WHERE md.project_id = $1
        ORDER BY md.title`,
      [params.id],
    ).catch(() => [] as MeasureRow[]),
    query<WorkRow>(
      `SELECT id, measure_design_id, code, title, owner_department
         FROM measure_works
        WHERE project_id = $1 AND NOT retired
        ORDER BY sort_order, code`,
      [params.id],
    ).catch(() => [] as WorkRow[]),
    query<WorkEvalRow>(
      `SELECT id, measure_work_id, fiscal_year, status, result,
              approved_snapshot_at::text AS approved_snapshot_at,
              created_at::text AS created_at
         FROM program_evaluations
        WHERE project_id = $1 AND measure_work_id IS NOT NULL
        ORDER BY fiscal_year DESC NULLS LAST, created_at DESC`,
      [params.id],
    ).catch(() => [] as WorkEvalRow[]),
    query<DelegationCountRow>(
      `SELECT measure_work_id, count(*) FILTER (WHERE status = 'open')::int AS open_count
         FROM evaluation_delegations
        WHERE project_id = $1 AND measure_work_id IS NOT NULL
        GROUP BY measure_work_id`,
      [params.id],
    ).catch(() => [] as DelegationCountRow[]),
  ]);

  return (
    <WorkEvaluationClient
      project={project}
      measures={measures}
      works={works}
      evaluations={evaluations}
      delegationCounts={delegationCounts}
    />
  );
}
