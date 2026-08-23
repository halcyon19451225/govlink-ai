export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import LogicModelEditorClient from "./LogicModelEditorClient";

interface LogicModelRow {
  id: string;
  name: string | null;
  version: number;
  status: "draft" | "confirmed";
  purpose: string | null;
  basic_goal: string | null;
  basic_ideology: string | null;
  current_status: unknown | null;
  problem: string | null;
  challenge: string | null;
  root_cause: string | null;
  major_policy: string | null;
  initial_outcomes: string[] | null;
  intermediate_outcomes: string[] | null;
  long_outcomes: string[] | null;
  inputs: string[];
  activities: string[];
  outputs: string[];
  outcomes: unknown | null;
  edges: unknown;
  is_current: boolean;
  revision_reason: string | null;
  ai_generated: boolean;
  issue_hypothesis_id: string | null;
  generated_at: string | null;
}

interface HypothesisRow {
  id: string;
  title: string;
  root_cause: string | null;
  proposed_measures: string[] | null;
}

// 到達度の算定（目標の向き・基準値）と整合検査（層・寄与関係）に必要な列を揃える。
interface KpiRow {
  id: string;
  label: string;
  target: number | null;
  current: number | null;
  unit: string;
  baseline_value: number | null;
  achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq" | null;
  indicator_type: string | null;
  contributes_to_kpi_id: string | null;
}

export default async function LogicModelPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<{ id: string; title: string; description: string | null }>(
    "SELECT id, title, description FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [logicModels, hypotheses, kpis] = await Promise.all([
    query<LogicModelRow>(
      `SELECT id, name, version, status, purpose, basic_goal, basic_ideology,
              current_status, problem, challenge, root_cause, major_policy,
              initial_outcomes, intermediate_outcomes, long_outcomes,
              inputs, activities, outputs, outcomes,
              edges, is_current, revision_reason,
              ai_generated, issue_hypothesis_id, generated_at::text
       FROM logic_models WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC`,
      [params.id],
    ),
    query<HypothesisRow>(
      "SELECT id, title, root_cause, proposed_measures FROM issue_hypotheses WHERE project_id = $1 ORDER BY priority_rank NULLS LAST",
      [params.id],
    ),
    query<KpiRow>(
      `SELECT id, label, target::float AS target, current::float AS current, unit,
              baseline_value::float AS baseline_value,
              achievement_condition, indicator_type, contributes_to_kpi_id
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
  ]);

  return (
    <LogicModelEditorClient
      project={project}
      logicModels={logicModels}
      hypotheses={hypotheses}
      kpis={kpis}
      projectId={params.id}
    />
  );
}
