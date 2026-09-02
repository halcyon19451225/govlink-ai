export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import ProjectOverviewClient from "./ProjectOverviewClient";
import HandoverIntakeBanner from "@/components/plan/HandoverIntakeBanner";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department_name: string | null;
  municipality_name: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
  vision: string | null;
  created_at: string;
}

interface GoalRow {
  id: string;
  goal_number: number;
  title: string;
  description: string | null;
  sort_order: number;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  goal_id: string | null;
  indicator_type: string;
  previous_value: number | null;
  achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq" | null;
  target_deadline: string | null;
  baseline_value: number | null;
  baseline_year: number | null;
  contributes_to_kpi_id: string | null;
}

// 計画書の調製の状態サマリー（plan_documents — 049）。
// 2026-09 メニュー整理: 計画概要の旧ロジックモデル表に代えて計画書の調製への動線を出す
interface PlanDocRow {
  variant: "full" | "simple" | "digest";
  status: "draft" | "finalized";
  updated_at: string | null;
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const rows = await query<ProjectRow>(
    `SELECT
       p.id, p.title, p.description, p.status,
       p.department_name,
       p.plan_start_date::text,
       p.plan_end_date::text,
       p.vision,
       p.created_at,
       m.name AS municipality_name
     FROM projects p
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE p.id = $1`,
    [params.id],
  );

  const project = rows[0];
  if (!project) notFound();

  const [goals, kpis, planDocs] = await Promise.all([
    query<GoalRow>(
      `SELECT id, goal_number, title, description, sort_order
       FROM project_goals WHERE project_id = $1 ORDER BY sort_order, goal_number`,
      [params.id],
    ),
    query<KpiRow>(
      `SELECT id, label, target::float, current::float, unit,
              goal_id, indicator_type, previous_value::float,
              achievement_condition,
              baseline_value::float AS baseline_value, baseline_year,
              contributes_to_kpi_id,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
    query<PlanDocRow>(
      `SELECT variant, status, updated_at::text AS updated_at
       FROM plan_documents WHERE project_id = $1`,
      [params.id],
    ).catch(() => [] as PlanDocRow[]), // 049 未適用環境でも計画概要は落とさない
  ]);

  return (
    <>
      {/* PL1: 前期からの引き継ぎがあるときだけ表示（P②の入口） */}
      <HandoverIntakeBanner projectId={project.id} />
      <ProjectOverviewClient
        project={project}
        initialGoals={goals}
        initialKpis={kpis}
        planDocs={planDocs}
      />
    </>
  );
}
