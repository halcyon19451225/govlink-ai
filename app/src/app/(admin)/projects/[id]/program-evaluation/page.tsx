export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import BackButton from "@/components/BackButton";
import ProgramEvaluationClient from "./ProgramEvaluationClient";

interface ProgramEvalRow {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  achievement_rate: number | null;
  findings: string | null;
  kpi_ids: string[] | null;
  flow_decision_path: unknown;
  created_at: string;
}

export default async function ProgramEvaluationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) notFound();

  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [evaluations, kpis, logicModels] = await Promise.all([
    query<ProgramEvalRow>(
      `SELECT id, evaluation_tier, fiscal_year, status, result, achievement_rate::float,
              findings, kpi_ids, flow_decision_path, created_at::text
       FROM program_evaluations WHERE project_id = $1 ORDER BY fiscal_year, created_at`,
      [params.id],
    ).catch(() => [] as ProgramEvalRow[]),
    query<{
      id: string;
      label: string;
      target: number;
      current: number;
      unit: string;
      previous_value: number | null;
    }>(
      `SELECT id, label, target::float AS target, current::float AS current, unit,
              previous_value::float AS previous_value
       FROM kpis WHERE project_id = $1`,
      [params.id],
    ).catch(() => []),
    query<{ id: string; activities: unknown; major_policy: string | null }>(
      "SELECT id, activities, major_policy FROM logic_models WHERE project_id = $1 ORDER BY version DESC LIMIT 1",
      [params.id],
    ).catch(() => []),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">プログラム評価</h2>
      </div>
      <ProgramEvaluationClient
        project={project}
        evaluations={evaluations}
        kpis={kpis}
        logicModels={logicModels}
      />
    </div>
  );
}
