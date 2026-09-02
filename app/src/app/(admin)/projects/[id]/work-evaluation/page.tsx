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
import { buildDueList, type DueSourceIndicator } from "@/lib/evaluation/duecheck";
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

  // 評価予定（CA2-4）— 指標の評価時点が正本。計画の年次を決め打ちしない
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
    <WorkEvaluationClient
      project={project}
      measures={measures}
      works={works}
      evaluations={evaluations}
      delegationCounts={delegationCounts}
      dueItems={dueItems}
    />
  );
}
