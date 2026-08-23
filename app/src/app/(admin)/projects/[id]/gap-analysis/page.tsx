export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import GapAnalysisClient from "./GapAnalysisClient";

interface ProjectRow {
  id: string;
  title: string;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  unit: string;
  achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq" | null;
  target_deadline: string | null;
  baseline_value: number | null;
  goal_id: string | null;
  goal_title: string | null;
}

interface GapRow {
  id: string;
  kpi_id: string | null;
  indicator_name: string;
  current_value: number | null;
  target_value: number;
  gap_value: number | null;
  data_source: string;
  priority_score: number | null;
  ai_analysis: string | null;
  updated_at: string;
}

export default async function GapAnalysisPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [kpis, gaps] = await Promise.all([
    query<KpiRow>(
      `SELECT k.id, k.label, k.target::float, k.unit,
              k.achievement_condition,
              k.baseline_value::float AS baseline_value,
              to_char(k.target_deadline, 'YYYY-MM-DD') AS target_deadline,
              k.goal_id,
              g.title AS goal_title
       FROM kpis k
       LEFT JOIN project_goals g ON g.id = k.goal_id
       WHERE k.project_id = $1
       ORDER BY k.created_at`,
      [params.id],
    ),
    query<GapRow>(
      `SELECT id, kpi_id, indicator_name,
              current_value::float,
              target_value::float,
              gap_value::float,
              data_source, priority_score, ai_analysis,
              updated_at::text
       FROM gap_analyses
       WHERE project_id = $1
       ORDER BY updated_at DESC`,
      [params.id],
    ),
  ]);

  return (
    <GapAnalysisClient
      project={project}
      kpis={kpis}
      initialGaps={gaps}
      projectId={params.id}
    />
  );
}
