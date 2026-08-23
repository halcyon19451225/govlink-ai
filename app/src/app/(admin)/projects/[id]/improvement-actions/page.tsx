export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import ImprovementActionsClient, {
  type ReflectOption,
} from "./ImprovementActionsClient";
import type { ImprovementAction } from "@/lib/improvement/types";

export default async function ImprovementActionsPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [actions, kpis, tasks, logicModels, hypotheses, evaluations, otherProjects, measureOptions] =
    await Promise.all([
    query<ImprovementAction>(
      `SELECT id, project_id, source,
              program_evaluation_id, self_evaluation_entry_id,
              policy_suggestion_id, checkpoint_id,
              title, detail, root_cause,
              owner_department, owner_name,
              to_char(due_date, 'YYYY-MM-DD') AS due_date,
              fiscal_year, status, priority,
              reflect_schedule_task_id, reflect_kpi_id,
              reflect_measure_design_id,
              reflect_logic_model_id, reflect_issue_hypothesis_id,
              reflected_at::text, reflection_note, carry_over,
              created_at::text, updated_at::text
       FROM improvement_actions
       WHERE project_id = $1
       ORDER BY priority NULLS LAST, due_date NULLS LAST, created_at DESC`,
      [params.id],
    ).catch(() => [] as ImprovementAction[]),
    query<ReflectOption>(
      "SELECT id, label AS label FROM kpis WHERE project_id = $1 ORDER BY created_at",
      [params.id],
    ).catch(() => [] as ReflectOption[]),
    query<ReflectOption>(
      `SELECT id, title AS label FROM schedule_tasks
       WHERE project_id = $1 AND completed_at IS NULL
       ORDER BY due_date NULLS LAST LIMIT 100`,
      [params.id],
    ).catch(() => [] as ReflectOption[]),
    query<ReflectOption>(
      `SELECT id,
              COALESCE(name, 'ロジックモデル')
                || ' 第' || version || '版'
                || CASE WHEN is_current THEN '（現行）' ELSE '' END AS label
       FROM logic_models
       WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC LIMIT 20`,
      [params.id],
    ).catch(() => [] as ReflectOption[]),
    query<ReflectOption>(
      `SELECT id, title AS label FROM issue_hypotheses
       WHERE project_id = $1 ORDER BY priority_rank NULLS LAST, created_at`,
      [params.id],
    ).catch(() => [] as ReflectOption[]),
    // 対話の起点に選べる評価
    query<ReflectOption>(
      `SELECT id,
              COALESCE(
                CASE evaluation_tier
                  WHEN 'outcome_initial'      THEN '短期アウトカム評価'
                  WHEN 'outcome_intermediate' THEN '中間アウトカム評価'
                  WHEN 'outcome_long'         THEN '長期アウトカム評価'
                  WHEN 'process'              THEN 'プロセス評価'
                  WHEN 'efficiency'           THEN '効率性評価'
                  ELSE evaluation_tier
                END, evaluation_tier)
              || COALESCE('（' || fiscal_year || '年度）', '')
              || COALESCE(' 到達度 ' || ROUND(achievement_rate) || '%', '') AS label
       FROM program_evaluations
       WHERE project_id = $1
       ORDER BY fiscal_year DESC NULLS LAST, created_at DESC
       LIMIT 30`,
      [params.id],
    ).catch(() => [] as ReflectOption[]),
    // 引き継ぎ先に指定できる他の計画（同一自治体）
    query<{ id: string; title: string }>(
      `SELECT p2.id, p2.title
       FROM projects p2
       JOIN projects p1 ON p1.municipality_id = p2.municipality_id
       WHERE p1.id = $1 AND p2.id <> $1
       ORDER BY p2.created_at DESC
       LIMIT 50`,
      [params.id],
    ).catch(() => [] as { id: string; title: string }[]),
    // 反映先「施策の見直し」の候補（E5）
    query<ReflectOption>(
      `SELECT id, title || CASE WHEN status = 'confirmed' THEN '（確定）' ELSE '（下書き）' END AS label
       FROM measure_designs
       WHERE project_id = $1
       ORDER BY status DESC, sort_order, created_at LIMIT 30`,
      [params.id],
    ).catch(() => [] as ReflectOption[]),
  ]);

  return (
    <ImprovementActionsClient
      project={project}
      projectId={params.id}
      initialActions={actions}
      reflectOptions={{
        kpi: kpis,
        schedule_task: tasks,
        measure_design: measureOptions,
        logic_model: logicModels,
        issue_hypothesis: hypotheses,
      }}
      evaluations={evaluations}
      otherProjects={otherProjects}
    />
  );
}
