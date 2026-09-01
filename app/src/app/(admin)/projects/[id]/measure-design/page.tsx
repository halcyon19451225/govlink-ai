export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { normalizeMeasure, type MeasureDesign } from "@/lib/measure/types";
import type { ScoreboardKpi } from "@/lib/outcome/tiers";
import MeasureDesignClient, { type MeasureFocus } from "./MeasureDesignClient";

// 施策構築（EBPM）— E1: データセットの器と一覧・詳細
// 設計: claude/coe-ebpm-plan.md
//
// ?kpi=<kpiId> が付くと「目標（長期アウトカム）の詳細画面」として振る舞う。
// 計画概要の「目的・目標を見る」から目標をタップして入る動線で、
//   冒頭にその目標の到達状況だけを出し、
//   一覧をその目標に紐づく主要施策だけに絞る。
// パラメータが無いときの表示は従来どおり（全施策）。

interface HypothesisRow {
  id: string;
  title: string;
  root_cause: string | null;
  status: string;
  /** どの指標の課題仮説か（計画横断で並ぶため、指標名が無いと選べない） */
  kpi_label: string | null;
  priority_rank: number | null;
}

interface KpiRow {
  id: string;
  label: string;
  unit: string;
  indicator_type: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** スコアボードに渡す列（計画概要と同じ形） */
const SCOREBOARD_COLS = `id, label, target::float, current::float, unit,
        indicator_type, achievement_condition,
        baseline_value::float AS baseline_value, baseline_year,
        contributes_to_kpi_id,
        to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline`;

/**
 * この目標（KPI）に紐づく主要施策を集める。
 *
 * 施策側が直接この指標を持っている場合（kpi_ids_initial / kpi_ids_intermediate）と、
 * 課題仮説設定をこの指標から始めた場合（issue_dialogues.kpi_id）の両方を拾う。
 * 後者を入れないと、施策の指標欄をまだ埋めていない段階で目標から辿れなくなる。
 */
async function loadFocus(
  projectId: string,
  kpiId: string,
): Promise<MeasureFocus | null> {
  const kpi = await queryOne<ScoreboardKpi>(
    `SELECT ${SCOREBOARD_COLS} FROM kpis WHERE id = $1 AND project_id = $2`,
    [kpiId, projectId],
  ).catch(() => null);
  if (!kpi) return null;

  const [contributors, related, plan] = await Promise.all([
    query<ScoreboardKpi>(
      `SELECT ${SCOREBOARD_COLS} FROM kpis
        WHERE project_id = $1 AND contributes_to_kpi_id = $2
        ORDER BY created_at`,
      [projectId, kpiId],
    ).catch(() => [] as ScoreboardKpi[]),
    query<{ id: string }>(
      `SELECT DISTINCT md.id
         FROM measure_designs md
         LEFT JOIN issue_hypotheses h ON h.id = md.issue_hypothesis_id
         LEFT JOIN issue_dialogues d  ON d.id = h.issue_dialogue_id
        WHERE md.project_id = $1
          AND ($2::uuid = ANY(md.kpi_ids_initial)
            OR $2::uuid = ANY(md.kpi_ids_intermediate)
            OR d.kpi_id = $2::uuid)`,
      [projectId, kpiId],
    ).catch(() => [] as { id: string }[]),
    queryOne<{ plan_start_date: string | null; plan_end_date: string | null }>(
      `SELECT plan_start_date::text, plan_end_date::text FROM projects WHERE id = $1`,
      [projectId],
    ).catch(() => null),
  ]);

  return {
    kpi,
    contributors,
    measureIds: related.map((r) => r.id),
    planStartDate: plan?.plan_start_date ?? null,
    planEndDate: plan?.plan_end_date ?? null,
  };
}

export default async function MeasureDesignPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { kpi?: string };
}) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const focusKpiId = searchParams?.kpi;
  const focus =
    focusKpiId && UUID_RE.test(focusKpiId) ? await loadFocus(params.id, focusKpiId) : null;

  const [measureRows, hypotheses, kpis] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT id, project_id,
              issue_hypothesis_id, root_cause_snapshot, gap_analysis_ids, measure_dialogue_id,
              title, approach, target_population, target_size::float AS target_size,
              intervention, delivery,
              to_char(period_start, 'YYYY-MM-DD') AS period_start,
              to_char(period_end, 'YYYY-MM-DD') AS period_end,
              evidence_status, evidence_items, experiment,
              structure_indicators, process_indicators,
              kpi_ids_initial, kpi_ids_intermediate,
              total_budget::float AS total_budget, unit_cost::float AS unit_cost,
              cost_per_outcome_note, funding, budget_breakdown,
              owner_department, milestones, risks,
              status, sort_order, committed_at::text, created_at::text, updated_at::text
       FROM measure_designs
       WHERE project_id = $1
       ORDER BY sort_order, created_at`,
      [params.id],
    ).catch(() => [] as Record<string, unknown>[]),
    query<HypothesisRow>(
      `SELECT h.id, h.title, h.root_cause, h.status, h.priority_rank,
              k.label AS kpi_label
       FROM issue_hypotheses h
       LEFT JOIN issue_dialogues d ON d.id = h.issue_dialogue_id
       LEFT JOIN kpis k ON k.id = d.kpi_id
       WHERE h.project_id = $1
       ORDER BY k.label NULLS LAST, h.priority_rank NULLS LAST, h.created_at`,
      [params.id],
    ).catch(() => [] as HypothesisRow[]),
    query<KpiRow>(
      `SELECT id, label, unit, indicator_type FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ).catch(() => [] as KpiRow[]),
  ]);

  const measures: MeasureDesign[] = measureRows.map(normalizeMeasure);

  return (
    <MeasureDesignClient
      project={project}
      projectId={params.id}
      initialMeasures={measures}
      hypotheses={hypotheses}
      kpis={kpis}
      focus={focus}
    />
  );
}
