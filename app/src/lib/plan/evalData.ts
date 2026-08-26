import "server-only";
import { query } from "@/lib/db";
import { calcAchievement, type AchievementCondition } from "@/lib/stats/achievement";
import { normalizeIndicatorType } from "@/lib/outcome/tiers";
import type { EvalKpiRow, EvalResultRow, ImprovementRow } from "@/lib/plan/docx";

/**
 * 評価報告書（PL3 A①）の実データ表 — docx出力・印刷ビュー・GET応答で共用。
 * KPIの到達度は achievement.ts の統一計算（基準値からの前進量・目標の向きを考慮）。
 * 表はAIに書かせず、常にここから実データで組む。
 */
export interface EvalTables {
  kpis: EvalKpiRow[];
  evaluations: EvalResultRow[];
  improvements: ImprovementRow[];
}

export async function gatherEvalTables(projectId: string): Promise<EvalTables> {
  const [kpis, evals, improvements] = await Promise.all([
    query<{
      label: string;
      unit: string;
      target: number | null;
      current: number | null;
      baseline_value: number | null;
      indicator_type: string | null;
      achievement_condition: string | null;
    }>(
      `SELECT label, unit, target::float AS target, current::float AS current,
              baseline_value::float AS baseline_value, indicator_type, achievement_condition
       FROM kpis WHERE project_id = $1 ORDER BY created_at LIMIT 50`,
      [projectId],
    ),
    query<{ measure: string | null; evaluation_tier: string; fiscal_year: number | null; result: string | null }>(
      `SELECT md.title AS measure, pe.evaluation_tier, pe.fiscal_year, pe.result
       FROM program_evaluations pe
       LEFT JOIN measure_designs md ON md.id = pe.measure_design_id
       WHERE pe.project_id = $1
       ORDER BY pe.fiscal_year DESC NULLS LAST, pe.created_at DESC LIMIT 40`,
      [projectId],
    ),
    query<{ title: string; root_cause: string | null; status: string; due_date: string | null }>(
      `SELECT title, root_cause, status, to_char(due_date, 'YYYY-MM-DD') AS due_date
       FROM improvement_actions WHERE project_id = $1
       ORDER BY priority NULLS LAST, created_at LIMIT 40`,
      [projectId],
    ),
  ]);
  return {
    kpis: kpis.map((k) => {
      const a = calcAchievement({
        current: k.current,
        target: k.target,
        baseline: k.baseline_value,
        condition: (k.achievement_condition as AchievementCondition | null) ?? null,
      });
      return {
        label: k.label,
        tier: normalizeIndicatorType(k.indicator_type),
        unit: k.unit,
        baseline: k.baseline_value,
        current: k.current,
        target: k.target,
        rate: a.rate,
        achieved: a.achieved,
      };
    }),
    evaluations: evals.map((e) => ({
      measure: e.measure ?? "（計画全体）",
      tier: e.evaluation_tier,
      fiscal_year: e.fiscal_year,
      result: (e.result ?? "").slice(0, 300),
    })),
    improvements,
  };
}
