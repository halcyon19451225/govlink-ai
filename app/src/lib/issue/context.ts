import "server-only";
import { queryOne } from "@/lib/db";
import type { CrossAnalysis, SwotData } from "@/lib/asis/types";
import type { IssueKpiContext } from "./prompt";

export interface AsisSource {
  asis_analysis_id: string | null;
  swot: SwotData | null;
  cross_analysis: CrossAnalysis | null;
  asis_status: string | null;
}

const EMPTY_ASIS_SOURCE: AsisSource = {
  asis_analysis_id: null,
  swot: null,
  cross_analysis: null,
  asis_status: null,
};

/** 指定KPIに紐づく現状整理（As-Is）の結果を取得する */
export async function fetchAsisSource(
  projectId: string,
  kpiId: string | null,
): Promise<AsisSource> {
  if (!kpiId) return EMPTY_ASIS_SOURCE;

  const row = await queryOne<{
    id: string;
    status: string;
    swot: SwotData;
    cross_analysis: CrossAnalysis;
  }>(
    `SELECT id, status, swot, cross_analysis
     FROM asis_analyses
     WHERE project_id = $1 AND kpi_id = $2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [projectId, kpiId],
  );
  if (!row) return EMPTY_ASIS_SOURCE;

  return {
    asis_analysis_id: row.id,
    swot: row.swot,
    cross_analysis: row.cross_analysis,
    asis_status: row.status,
  };
}

/** KPI とギャップ分析から対話用のコンテキストを組み立てる */
export async function fetchIssueKpiContext(
  projectId: string,
  kpiId: string,
): Promise<{ context: IssueKpiContext; gapAnalysisId: string | null } | null> {
  const row = await queryOne<{
    label: string;
    unit: string | null;
    target: number | null;
    target_deadline: string | null;
    gap_id: string | null;
    current_value: number | null;
    gap_value: number | null;
    trend: string | null;
  }>(
    `SELECT k.label, k.unit, k.target::float,
            to_char(k.target_deadline, 'YYYY年M月') AS target_deadline,
            g.id                   AS gap_id,
            g.current_value::float AS current_value,
            g.gap_value::float     AS gap_value,
            g.trend                AS trend
     FROM kpis k
     LEFT JOIN gap_analyses g ON g.kpi_id = k.id AND g.project_id = $2
     WHERE k.id = $1 AND k.project_id = $2`,
    [kpiId, projectId],
  );
  if (!row) return null;

  return {
    context: {
      indicatorName: row.label,
      unit: row.unit ?? "",
      targetValue: row.target,
      currentValue: row.current_value,
      gapValue: row.gap_value,
      deadline: row.target_deadline,
      trend: row.trend,
    },
    gapAnalysisId: row.gap_id,
  };
}

/**
 * 対話の冒頭で提示する「問題の種」を現状整理から拾う。
 * 弱み → 脅威 → WT戦略 → WO戦略 の順に最大3件。
 */
export function pickProblemSeeds(
  swot: SwotData | null,
  cross: CrossAnalysis | null,
): string[] {
  const seeds: string[] = [];
  for (const w of swot?.weaknesses ?? []) seeds.push(w.text);
  for (const t of swot?.threats ?? []) seeds.push(t.text);
  for (const s of cross?.wt ?? []) seeds.push(s);
  for (const s of cross?.wo ?? []) seeds.push(s);
  return seeds.slice(0, 3);
}
