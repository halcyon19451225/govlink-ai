export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import LineageGraphClient from "./LineageGraphClient";

interface DatasetRow {
  id: string;
  file_name: string;
  dataset_def_id: string;
  display_name: string;
}

interface GapRow {
  id: string;
  indicator_name: string;
}

interface HypothesisRow {
  id: string;
  title: string;
  gap_analysis_id: string | null;
}

interface ModelRow {
  id: string;
  name: string | null;
  issue_hypothesis_id: string | null;
}

export default async function LineagePage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [datasets, gaps, hypotheses, models] = await Promise.all([
    query<DatasetRow>(
      `SELECT pd.id, pd.file_name, pd.dataset_def_id, dd.display_name
       FROM project_datasets pd
       JOIN dataset_definitions dd ON dd.id = pd.dataset_def_id
       WHERE pd.project_id = $1`,
      [params.id],
    ),
    query<GapRow>(
      "SELECT id, indicator_name FROM gap_analyses WHERE project_id = $1",
      [params.id],
    ),
    query<HypothesisRow>(
      "SELECT id, title, gap_analysis_id FROM issue_hypotheses WHERE project_id = $1",
      [params.id],
    ),
    query<ModelRow>(
      "SELECT id, name, issue_hypothesis_id FROM logic_models WHERE project_id = $1 ORDER BY version DESC LIMIT 5",
      [params.id],
    ),
  ]);

  return (
    <LineageGraphClient
      project={project}
      datasets={datasets}
      gaps={gaps}
      hypotheses={hypotheses}
      models={models}
      projectId={params.id}
    />
  );
}
