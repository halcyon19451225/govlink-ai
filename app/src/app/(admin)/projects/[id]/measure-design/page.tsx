export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import { normalizeMeasure, type MeasureDesign } from "@/lib/measure/types";
import MeasureDesignClient from "./MeasureDesignClient";

// 施策構築（EBPM）— E1: データセットの器と一覧・詳細
// 設計: claude/coe-ebpm-plan.md

interface HypothesisRow {
  id: string;
  title: string;
  root_cause: string | null;
  status: string;
}

interface KpiRow {
  id: string;
  label: string;
  unit: string;
  indicator_type: string | null;
}

export default async function MeasureDesignPage({ params }: { params: { id: string } }) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

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
      `SELECT id, title, root_cause, status
       FROM issue_hypotheses
       WHERE project_id = $1
       ORDER BY priority_rank NULLS LAST, created_at`,
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
    />
  );
}
