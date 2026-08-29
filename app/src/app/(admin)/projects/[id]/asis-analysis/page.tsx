export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import AsisAnalysisClient, { type AsisRecord } from "./AsisAnalysisClient";
import { EMPTY_SWOT, EMPTY_CROSS } from "@/lib/asis/types";

interface KpiRow {
  id: string;
  label: string;
  unit: string;
}

export default async function AsisAnalysisPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [records, kpis] = await Promise.all([
    query<AsisRecord>(
      `SELECT a.id, a.kpi_id, a.title, a.status, a.current_step,
              COALESCE(a.messages, '[]'::jsonb)   AS messages,
              COALESCE(a.swot, $2::jsonb)         AS swot,
              COALESCE(a.cross_analysis, $3::jsonb) AS cross_analysis,
              a.turn_status, a.turn_error,
              a.created_at::text, a.updated_at::text,
              k.label AS kpi_label
       FROM asis_analyses a
       LEFT JOIN kpis k ON k.id = a.kpi_id
       WHERE a.project_id = $1
       ORDER BY a.created_at DESC`,
      [params.id, JSON.stringify(EMPTY_SWOT), JSON.stringify(EMPTY_CROSS)],
    ),
    query<KpiRow>(
      "SELECT id, label, unit FROM kpis WHERE project_id = $1 ORDER BY created_at",
      [params.id],
    ),
  ]);

  return (
    <AsisAnalysisClient
      project={project}
      projectId={params.id}
      initialRecords={records}
      kpis={kpis}
    />
  );
}
