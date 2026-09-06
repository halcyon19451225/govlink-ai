export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import DatasetsClient from "./DatasetsClient";
import { assertProjectPage } from "@/lib/tenant-page";

interface ProjectRow {
  id: string;
  title: string;
  plan_type: string | null;
}

interface DatasetDef {
  id: string;
  display_name: string;
  description: string;
  data_format: string;
  required_columns: string[];
  plan_types: string[];
  used_by_modules: string[];
  ai_analysis_types: string[];
  data_sensitivity: string;
  update_frequency: string;
  source_description: string;
}

interface ProjectDataset {
  id: string;
  project_id: string;
  dataset_def_id: string;
  file_name: string;
  s3_key: string;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  survey_year: number | null;
  status: string;
  validation_errors: unknown;
  row_count: number | null;
  metadata: unknown;
}

export default async function DatasetsPage({
  params,
}: {
  params: { id: string };
}) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const project = await queryOne<ProjectRow>(
    "SELECT id, title, plan_type FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const defs = await query<DatasetDef>(
    `SELECT * FROM dataset_definitions
     WHERE $1 = ANY(plan_types) OR 'custom' = ANY(plan_types)
     ORDER BY id`,
    [project.plan_type ?? "custom"],
  );

  const uploaded = await query<ProjectDataset>(
    "SELECT * FROM project_datasets WHERE project_id = $1 ORDER BY uploaded_at DESC",
    [params.id],
  );

  return (
    <DatasetsClient
      project={project}
      defs={defs}
      uploaded={uploaded}
    />
  );
}
