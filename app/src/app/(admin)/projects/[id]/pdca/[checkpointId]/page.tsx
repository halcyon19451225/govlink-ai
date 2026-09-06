export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import CheckpointWorkClient from "./CheckpointWorkClient";
import type { PdcaCheckpoint } from "../page";
import { assertProjectPage } from "@/lib/tenant-page";

export default async function CheckpointPage({
  params,
}: {
  params: { id: string; checkpointId: string };
}) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const checkpoint = await queryOne<PdcaCheckpoint & {
    project_id: string;
    started_at: string | null;
    completed_at: string | null;
    completion_notes: string | null;
  }>(
    `SELECT id, project_id, name, cycle_type, phase, description,
            evaluation_tiers, modules_involved, qc_step, instructions,
            to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            status, started_at::text, completed_at::text, completion_notes, sort_order
     FROM project_pdca_checkpoints
     WHERE id = $1 AND project_id = $2`,
    [params.checkpointId, params.id],
  );
  if (!checkpoint) notFound();

  const project = await queryOne<{ title: string }>(
    "SELECT title FROM projects WHERE id = $1",
    [params.id],
  );

  const modules = await query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM plan_modules ORDER BY sort_order",
    [],
  );

  return (
    <CheckpointWorkClient
      checkpoint={checkpoint}
      projectTitle={project?.title ?? ""}
      projectId={params.id}
      modules={modules}
    />
  );
}
