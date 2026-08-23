export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { calcAchievement, type AchievementCondition } from "@/lib/stats/achievement";

type Params = { params: { id: string } };

/**
 * 短期 → 中間のロールアップ。
 *
 * 図7フローの第2の問い「中間アウトカムの未達は初期アウトカムに起因するか」に
 * 担当者が資料を探さずに答えられるよう、指定した中間アウトカムKPIに
 * `contributes_to_kpi_id` で紐づく短期アウトカムKPIと、その評価履歴を返す。
 *
 * GET ?kpiIds=<uuid>,<uuid>
 */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  const raw = req.nextUrl.searchParams.get("kpiIds") ?? "";
  const parentIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  if (parentIds.length === 0) {
    return NextResponse.json({ data: { contributors: [] }, error: null });
  }

  // 1) 指定KPIに寄与する下位KPI
  const children = await query<{
    id: string;
    label: string;
    unit: string;
    current: number | null;
    target: number | null;
    baseline_value: number | null;
    achievement_condition: AchievementCondition | null;
    contributes_to_kpi_id: string;
  }>(
    `SELECT id, label, unit,
            current::float AS current, target::float AS target,
            baseline_value::float AS baseline_value,
            achievement_condition, contributes_to_kpi_id
     FROM kpis
     WHERE project_id = $1 AND contributes_to_kpi_id = ANY($2::uuid[])
     ORDER BY created_at`,
    [params.id, parentIds],
  );

  if (children.length === 0) {
    return NextResponse.json({ data: { contributors: [] }, error: null });
  }

  // 2) それらのKPIを対象にした短期アウトカム評価の履歴
  const childIds = children.map((c) => c.id);
  const evals = await query<{
    id: string;
    fiscal_year: number | null;
    status: string;
    result: string | null;
    achievement_rate: number | null;
    computed_achievement_rate: number | null;
    findings: string | null;
    improvement_actions: string | null;
    kpi_ids: string[] | null;
    created_at: string;
  }>(
    `SELECT id, fiscal_year, status, result,
            achievement_rate::float, computed_achievement_rate::float,
            findings, improvement_actions, kpi_ids, created_at::text
     FROM program_evaluations
     WHERE project_id = $1
       AND evaluation_tier IN ('outcome_initial', 'outcome', 'process')
       AND kpi_ids && $2::uuid[]
     ORDER BY fiscal_year NULLS LAST, created_at`,
    [params.id, childIds],
  ).catch(() => []);

  const contributors = children.map((c) => {
    const ach = calcAchievement({
      current: c.current,
      target: c.target,
      baseline: c.baseline_value,
      condition: c.achievement_condition,
    });
    return {
      kpi_id: c.id,
      label: c.label,
      unit: c.unit ?? "",
      current: c.current,
      target: c.target,
      rate: ach.rate,
      achieved: ach.achieved,
      contributes_to_kpi_id: c.contributes_to_kpi_id,
      evaluations: evals
        .filter((e) => (e.kpi_ids ?? []).includes(c.id))
        .map((e) => ({
          id: e.id,
          fiscal_year: e.fiscal_year,
          status: e.status,
          rate: e.achievement_rate ?? e.computed_achievement_rate,
          findings: e.findings,
          improvement_actions: e.improvement_actions,
          created_at: e.created_at,
        })),
    };
  });

  return NextResponse.json({ data: { contributors }, error: null });
}
