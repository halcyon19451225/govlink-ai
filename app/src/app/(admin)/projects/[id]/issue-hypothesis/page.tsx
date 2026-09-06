export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import IssueHypothesisClient, {
  type IssueDialogueRecord,
  type CommittedHypothesis,
  type KpiRow,
} from "./IssueHypothesisClient";
import { assertProjectPage } from "@/lib/tenant-page";

export default async function IssueHypothesisPage({
  params,
}: {
  params: { id: string };
}) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [dialogues, kpis, committed] = await Promise.all([
    query<IssueDialogueRecord>(
      `SELECT d.id, d.kpi_id, d.gap_analysis_id, d.asis_analysis_id, d.title,
              d.status, d.current_step,
              COALESCE(d.messages,    '[]'::jsonb) AS messages,
              COALESCE(d.problems,    '[]'::jsonb) AS problems,
              COALESCE(d.selection,   '[]'::jsonb) AS selection,
              COALESCE(d.root_causes, '[]'::jsonb) AS root_causes,
              COALESCE(d.hypotheses,  '[]'::jsonb) AS hypotheses,
              d.turn_status, d.turn_error,
              d.committed_at::text,
              d.created_at::text, d.updated_at::text,
              k.label AS kpi_label
       FROM issue_dialogues d
       LEFT JOIN kpis k ON k.id = d.kpi_id
       WHERE d.project_id = $1
       ORDER BY d.created_at DESC`,
      [params.id],
    ),
    query<KpiRow>(
      "SELECT id, label, unit FROM kpis WHERE project_id = $1 ORDER BY created_at",
      [params.id],
    ),
    query<CommittedHypothesis>(
      `SELECT id, issue_dialogue_id, title, description, root_cause,
              priority_rank, status, evidence_sources, proposed_measures
       FROM issue_hypotheses
       WHERE project_id = $1
       ORDER BY priority_rank NULLS LAST, created_at`,
      [params.id],
    ),
  ]);

  return (
    <IssueHypothesisClient
      project={project}
      projectId={params.id}
      initialDialogues={dialogues}
      kpis={kpis}
      initialCommitted={committed}
    />
  );
}
