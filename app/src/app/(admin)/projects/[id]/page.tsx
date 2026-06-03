export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import ProjectOverviewClient from "./ProjectOverviewClient";

// ─── DB 型 ───────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department_name: string | null;
  municipality_name: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
  purpose: string | null;
  major_policy: string | null;
  created_at: string;
}

interface GoalRow {
  id: string;
  goal_number: number;
  title: string;
  description: string | null;
  sort_order: number;
}

interface LogicModelRow {
  id: string;
  inputs: string[];
  activities: string[];
  outputs: string[];
  initial_outcomes: string[] | null;
  intermediate_outcomes: string[] | null;
  name: string | null;
  status: string;
  generated_at: string | null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

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
       p.purpose,
       p.major_policy,
       p.created_at,
       m.name AS municipality_name
     FROM projects p
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE p.id = $1`,
    [params.id],
  );

  const project = rows[0];
  if (!project) notFound();

  const [goals, logicModelRows] = await Promise.all([
    query<GoalRow>(
      `SELECT id, goal_number, title, description, sort_order
       FROM project_goals WHERE project_id = $1 ORDER BY sort_order, goal_number`,
      [params.id],
    ),
    query<LogicModelRow>(
      `SELECT id, inputs, activities, outputs,
              initial_outcomes, intermediate_outcomes,
              name, status, generated_at::text
       FROM logic_models WHERE project_id = $1
       ORDER BY generated_at DESC LIMIT 1`,
      [params.id],
    ),
  ]);

  const logicModel = logicModelRows[0] ?? null;

  return (
    <ProjectOverviewClient
      project={project}
      goals={goals}
      logicModel={logicModel}
    />
  );
}
