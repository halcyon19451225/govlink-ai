export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import GapAnalysisClient from "./GapAnalysisClient";

interface ProjectRow {
  id: string;
  title: string;
}

interface GapAnalysis {
  id: string;
  project_id: string;
  checkpoint_id: string | null;
  indicator_name: string;
  indicator_unit: string | null;
  data_source: string;
  current_value: number;
  current_year: number;
  target_value: number;
  target_basis: string;
  gap_value: number;
  affected_population: number | null;
  trend: "improving" | "worsening" | "stable" | "unknown";
  priority_score: number | null;
  notes: string | null;
  ai_analysis: string | null;
  created_at: string;
  updated_at: string;
}

interface DatasetRow {
  id: string;
  dataset_def_id: string;
  file_name: string;
  uploaded_at: string;
  survey_year: number | null;
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

  const gaps = await query<GapAnalysis>(
    `SELECT *,
            gap_value::float,
            current_value::float,
            target_value::float,
            affected_population::float
     FROM gap_analyses
     WHERE project_id = $1
     ORDER BY created_at`,
    [params.id],
  );

  const datasets = await query<DatasetRow>(
    "SELECT id, dataset_def_id, file_name, uploaded_at::text, survey_year FROM project_datasets WHERE project_id = $1",
    [params.id],
  );

  return (
    <GapAnalysisClient
      project={project}
      gaps={gaps}
      datasets={datasets}
      projectId={params.id}
    />
  );
}
