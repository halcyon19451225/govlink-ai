export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import ProjectOverviewClient from "./ProjectOverviewClient";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department_name: string | null;
  municipality_name: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
  vision: string | null;
  created_at: string;
}

interface GoalRow {
  id: string;
  goal_number: number;
  title: string;
  description: string | null;
  sort_order: number;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  goal_id: string | null;
  indicator_type: string;
  previous_value: number | null;
  achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq" | null;
  target_deadline: string | null;
  baseline_value: number | null;
  baseline_year: number | null;
  contributes_to_kpi_id: string | null;
}

interface LogicModelRow {
  id: string;
  // 要素列は JSONB（文字列配列と要素オブジェクトが混在しうる）
  inputs: unknown;
  activities: unknown;
  outputs: unknown;
  initial_outcomes: unknown;
  intermediate_outcomes: unknown;
  long_outcomes: unknown;
  name: string | null;
  status: string;
  generated_at: string | null;
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const rows = await query<ProjectRow>(
    `SELECT
       p.id, p.title, p.description, p.status,
       p.department_name,
       p.plan_start_date::text,
       p.plan_end_date::text,
       p.vision,
       p.created_at,
       m.name AS municipality_name
     FROM projects p
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE p.id = $1`,
    [params.id],
  );

  const project = rows[0];
  if (!project) notFound();

  const [goals, kpis, logicModelRows] = await Promise.all([
    query<GoalRow>(
      `SELECT id, goal_number, title, description, sort_order
       FROM project_goals WHERE project_id = $1 ORDER BY sort_order, goal_number`,
      [params.id],
    ),
    query<KpiRow>(
      `SELECT id, label, target::float, current::float, unit,
              goal_id, indicator_type, previous_value::float,
              achievement_condition,
              baseline_value::float AS baseline_value, baseline_year,
              contributes_to_kpi_id,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
    query<LogicModelRow>(
      `SELECT id, inputs, activities, outputs,
              initial_outcomes, intermediate_outcomes, long_outcomes,
              name, status, generated_at::text
       FROM logic_models WHERE project_id = $1
       -- 現行版は is_current で決める（034）。
       -- 以前は generated_at 順で、他画面の version 順と別の行を見ていた。
       ORDER BY is_current DESC, version DESC, created_at DESC LIMIT 1`,
      [params.id],
    ),
  ]);

  const logicModel = logicModelRows[0] ?? null;

  return (
    <ProjectOverviewClient
      project={project}
      initialGoals={goals}
      initialKpis={kpis}
      logicModel={logicModel}
    />
  );
}
