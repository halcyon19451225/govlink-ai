export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import ProgramEvaluationClient from "./ProgramEvaluationClient";
import OutcomeScoreboard from "@/components/outcome/OutcomeScoreboard";
import type { ScoreboardKpi } from "@/lib/outcome/tiers";

interface ProgramEvalRow {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  achievement_rate: number | null;
  findings: string | null;
  improvement_actions: string | null;
  next_steps: string | null;
  kpi_ids: string[] | null;
  flow_decision_path: unknown;
  approved_snapshot_at: string | null;
  created_at: string;
}

interface MeasureRow {
  id: string;
  title: string;
  evidence_status: "sufficient" | "partial" | "none";
  experiment: { design?: string; primary_outcome?: string } | null;
  structure_indicators: { id: string; text: string }[];
  process_indicators: { id: string; text: string }[];
  kpi_ids_initial: string[];
  kpi_ids_intermediate: string[];
  cost_per_outcome_note: string | null;
  unit_cost: number | null;
  total_budget: number | null;
  funding: string | null;
}

export default async function ProgramEvaluationPage({
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
  }>(
    `SELECT id, title, plan_start_date::text, plan_end_date::text
     FROM projects WHERE id = $1`,
    [params.id],
  );
  if (!project) notFound();

  const [evaluations, kpis, logicModels, outcomeKpis, measures] = await Promise.all([
    query<ProgramEvalRow>(
      // 評価がどの版のロジックモデルを前提にしたかを一緒に取る（L5）。
      // 計画が改訂されても過去の評価が指す版は動かないので、
      // 「この評価は改訂前の版を見ていた」と示せるようにする。
      `SELECT pe.id, pe.evaluation_tier, pe.fiscal_year, pe.status, pe.result,
              pe.achievement_rate::float,
              pe.findings, pe.improvement_actions, pe.next_steps,
              pe.kpi_ids, pe.flow_decision_path,
              pe.approved_snapshot_at::text,
              pe.created_at::text,
              pe.logic_model_id,
              lm.version      AS logic_model_version,
              lm.is_current   AS logic_model_is_current,
              pe.measure_design_id,
              md.title        AS measure_title
       FROM program_evaluations pe
       LEFT JOIN logic_models lm ON lm.id = pe.logic_model_id
       LEFT JOIN measure_designs md ON md.id = pe.measure_design_id
       WHERE pe.project_id = $1
       ORDER BY pe.fiscal_year, pe.created_at`,
      [params.id],
    ).catch(() => [] as ProgramEvalRow[]),
    query<{
      id: string;
      label: string;
      target: number;
      current: number;
      unit: string;
      previous_value: number | null;
      baseline_value: number | null;
      achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq" | null;
      indicator_type: string | null;
    }>(
      `SELECT id, label, target::float AS target, current::float AS current, unit,
              previous_value::float AS previous_value,
              baseline_value::float AS baseline_value,
              achievement_condition, indicator_type
       FROM kpis WHERE project_id = $1`,
      [params.id],
    ).catch(() => []),
    query<{ id: string; activities: unknown; major_policy: string | null; version: number }>(
      `SELECT id, version, activities, major_policy,
              inputs, outputs, outcomes,
              initial_outcomes, intermediate_outcomes, long_outcomes
       FROM logic_models
       WHERE project_id = $1
       ORDER BY is_current DESC, version DESC, created_at DESC LIMIT 1`,
      [params.id],
    ).catch(() => []),
    // アウトカム・スコアボード用（三層＋基準値＋寄与関係）
    query<ScoreboardKpi>(
      `SELECT id, label, target::float AS target, current::float AS current, unit,
              baseline_value::float AS baseline_value, baseline_year,
              achievement_condition, indicator_type, contributes_to_kpi_id,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ).catch(() => [] as ScoreboardKpi[]),
    // 施策構築（EBPM）で確定した施策。評価ウィザードの「評価する施策」と
    // 効率性評価のコスト参照に使う（E5）
    query<MeasureRow>(
      `SELECT id, title, evidence_status, experiment,
              structure_indicators, process_indicators,
              kpi_ids_initial, kpi_ids_intermediate,
              cost_per_outcome_note, unit_cost::float AS unit_cost,
              total_budget::float AS total_budget, funding
       FROM measure_designs
       WHERE project_id = $1 AND status = 'confirmed'
       ORDER BY sort_order, created_at`,
      [params.id],
    ).catch(() => [] as MeasureRow[]),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">プログラム評価</h2>
      </div>

      {/* 評価の前提として、三層アウトカムの到達状況を先に示す */}
      <div className="mb-6">
        <OutcomeScoreboard
          kpis={outcomeKpis}
          planStartDate={project.plan_start_date}
          planEndDate={project.plan_end_date}
          title="アウトカム到達状況（評価の前提）"
        />
      </div>

      <ProgramEvaluationClient
        project={project}
        evaluations={evaluations}
        kpis={kpis}
        logicModels={logicModels}
        measures={measures}
      />
    </div>
  );
}
