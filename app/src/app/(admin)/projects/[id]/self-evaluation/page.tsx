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
  upstream_program_evaluation: UpstreamEval | null;
}

interface EvalRef {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
}

/** 上流のプログラム評価（自己評価を書くときの参照情報） */
interface UpstreamEval {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  result: string | null;
  achievement_rate: number | null;
  findings: string | null;
  improvement_actions: string | null;
  next_steps: string | null;
}

/**
 * 計画期間から評価対象年度を算出する。
 * 以前は「現在年 ±1」をハードコードしており、複数年度計画とずれていた。
 */
function fiscalYearsOf(
  planStart: string | null,
  planEnd: string | null,
  periodYears: number | null,
): number[] {
  const now = new Date();
  // 日本の年度は4月始まり
  const currentFy = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;

  if (!planStart) return [currentFy - 1, currentFy, currentFy + 1];

  const start = new Date(planStart);
  if (Number.isNaN(start.getTime())) return [currentFy - 1, currentFy, currentFy + 1];
  const startFy = start.getMonth() + 1 >= 4 ? start.getFullYear() : start.getFullYear() - 1;

  let endFy: number;
  if (planEnd) {
    const end = new Date(planEnd);
    endFy = Number.isNaN(end.getTime())
      ? startFy + (periodYears ?? 3) - 1
      : end.getMonth() + 1 >= 4
        ? end.getFullYear()
        : end.getFullYear() - 1;
  } else {
    endFy = startFy + (periodYears ?? 3) - 1;
  }

  const years: number[] = [];
  for (let y = startFy; y <= Math.max(startFy, endFy); y++) years.push(y);
  if (years.length === 0) return [currentFy];

  // 長期計画（10年超など）では年度ブロックが並びすぎるため、
  // 現年度を中心にした窓に絞る（計画期間内にクランプする）
  const MAX_YEARS = 6;
  if (years.length > MAX_YEARS) {
    const first = years[0]!;
    const last = years[years.length - 1]!;
    let from = Math.max(first, Math.min(currentFy - 2, last - MAX_YEARS + 1));
    if (from < first) from = first;
    return Array.from({ length: MAX_YEARS }, (_, i) => from + i).filter((y) => y <= last);
  }
  return years;
}

export default async function SelfEvaluationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) notFound();

  const project = await queryOne<{
    id: string;
    title: string;
    plan_start_date: string | null;
    plan_end_date: string | null;
    plan_period_years: number | null;
  }>(
    `SELECT p.id, p.title, p.plan_start_date::text, p.plan_end_date::text,
            t.plan_period_years
     FROM projects p
     LEFT JOIN plan_templates t ON t.id = p.template_id
     WHERE p.id = $1`,
    [params.id],
  );
  if (!project) notFound();

  const fiscalYears = fiscalYearsOf(
    project.plan_start_date,
    project.plan_end_date,
    project.plan_period_years,
  );

  const [sheets, evaluations] = await Promise.all([
    query<SheetRow>(
      // 上流のプログラム評価を JOIN する。
      // API 側には実装済みだったが、この画面が自前SQLで取得していたため
      // 評価結果が自己評価の画面に届いていなかった。
      `SELECT s.id, s.project_id, s.checkpoint_id, s.program_evaluation_id,
              s.title, s.has_interim_review, s.background, s.activities,
              s.target_and_metrics, s.evaluation_method, s.evaluation_timing,
              s.created_at::text,
              CASE WHEN pe.id IS NULL THEN NULL ELSE
                json_build_object(
                'id', pe.id,
                'evaluation_tier', pe.evaluation_tier,
                'fiscal_year', pe.fiscal_year,
                'result', pe.result,
                'achievement_rate', pe.achievement_rate::float,
                'findings', pe.findings,
                'improvement_actions', pe.improvement_actions,
                'next_steps', pe.next_steps
              )
              END AS upstream_program_evaluation,
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
       LEFT JOIN program_evaluations pe ON pe.id = s.program_evaluation_id
       WHERE s.project_id = $1
       GROUP BY s.id, pe.id
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
        fiscalYears={fiscalYears}
      />
    </div>
  );
}
