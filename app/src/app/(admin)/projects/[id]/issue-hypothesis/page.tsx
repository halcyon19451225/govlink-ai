export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import IssueHypothesisClient from "./IssueHypothesisClient";

interface IssueHypothesis {
  id: string;
  title: string;
  description: string | null;
  root_cause: string | null;
  root_cause_tree: unknown | null;
  priority_rank: number | null;
  smart_check: unknown | null;
  evidence_sources: string[] | null;
  proposed_measures: string[] | null;
  status: "draft" | "confirmed" | "rejected";
  ai_generated: boolean;
  verification_notes: string | null;
  gap_analysis_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GapRow {
  id: string;
  indicator_name: string;
  gap_value: string;
  trend: string;
  priority_score: number | null;
}

export default async function IssueHypothesisPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [hypotheses, gaps] = await Promise.all([
    query<IssueHypothesis>(
      `SELECT id, title, description, root_cause, root_cause_tree,
              priority_rank, smart_check, evidence_sources, proposed_measures,
              status, ai_generated, verification_notes,
              gap_analysis_id, created_at::text, updated_at::text
       FROM issue_hypotheses WHERE project_id = $1 ORDER BY priority_rank NULLS LAST, created_at`,
      [params.id],
    ),
    query<GapRow>(
      `SELECT id, indicator_name, gap_value::text, trend, priority_score
       FROM gap_analyses WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
  ]);

  return (
    <IssueHypothesisClient
      project={project}
      hypotheses={hypotheses}
      gaps={gaps}
      projectId={params.id}
    />
  );
}
