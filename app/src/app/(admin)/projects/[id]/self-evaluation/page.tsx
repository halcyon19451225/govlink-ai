export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import SelfEvaluationClient from "./SelfEvaluationClient";

interface EntryRow {
  id: string;
  sheet_id: string;
  fiscal_year: number;
  period_type: "interim" | "final";
  actual_activities: string | null;
  rating: "achieved" | "mostly_achieved" | "not_achieved" | "ongoing" | null;
  rating_label: string | null;
  achievement_analysis: string | null;
  activity_appropriateness: string | null;
  improvement_status: string | null;
  ideal_gap: string | null;
  challenges: string | null;
  countermeasures: string | null;
  next_year_changes: string | null;
  prefecture_support_request: string | null;
  created_at: string;
}

interface SheetRow {
  id: string;
  project_id: string;
  checkpoint_id: string | null;
  program_evaluation_id: string | null;
  title: string;
  has_interim_review: boolean;
  background: string | null;
  activities: string | null;
  target_and_metrics: string | null;
  evaluation_method: string | null;
  evaluation_timing: string | null;
  created_at: string;
  entries: EntryRow[];
}

interface EvalRef {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
}

export default async function SelfEvaluationPage({
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

  const [sheets, evaluations] = await Promise.all([
    query<SheetRow>(
      `SELECT s.id, s.project_id, s.checkpoint_id, s.program_evaluation_id,
              s.title, s.has_interim_review, s.background, s.activities,
              s.target_and_metrics, s.evaluation_method, s.evaluation_timing,
              s.created_at::text,
              COALESCE(json_agg(
                json_build_object(
                  'id', e.id,
                  'sheet_id', e.sheet_id,
                  'fiscal_year', e.fiscal_year,
                  'period_type', e.period_type,
                  'actual_activities', e.actual_activities,
                  'rating', e.rating,
                  'rating_label', e.rating_label,
                  'achievement_analysis', e.achievement_analysis,
                  'activity_appropriateness', e.activity_appropriateness,
                  'improvement_status', e.improvement_status,
                  'ideal_gap', e.ideal_gap,
                  'challenges', e.challenges,
                  'countermeasures', e.countermeasures,
                  'next_year_changes', e.next_year_changes,
                  'prefecture_support_request', e.prefecture_support_request,
                  'created_at', e.created_at::text
                ) ORDER BY e.fiscal_year, e.period_type
              ) FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
       FROM self_evaluation_sheets s
       LEFT JOIN self_evaluation_entries e ON e.sheet_id = s.id
       WHERE s.project_id = $1
       GROUP BY s.id
       ORDER BY s.created_at`,
      [params.id],
    ).catch(() => [] as SheetRow[]),
    query<EvalRef>(
      `SELECT id, evaluation_tier, fiscal_year
       FROM program_evaluations WHERE project_id = $1 ORDER BY fiscal_year`,
      [params.id],
    ).catch(() => [] as EvalRef[]),
  ]);

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">自己評価シート</h2>
      </div>
      <SelfEvaluationClient
        project={project}
        sheets={sheets}
        evaluations={evaluations}
      />
    </div>
  );
}
