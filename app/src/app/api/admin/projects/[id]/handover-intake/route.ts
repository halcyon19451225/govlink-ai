export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const MODULE = "self_evaluation";

/**
 * 前期引き継ぎの取り込み — 対象の取得（PL1 P② 経路1）
 *
 * GET … この計画（次期側）に結線された finalized な引き継ぎパッケージと、
 *       反映先になる新計画側の素材（draft施策・KPI）を返す。
 *       無ければ handover: null（ダッシュボードのバナーはこれで出し分ける）
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const handover = await queryOne(
    `SELECT h.id, h.title, h.fiscal_year, h.package, h.status,
            h.source_project_id, p.title AS source_project_title,
            h.finalized_at::text AS finalized_at, h.consumed_at::text AS consumed_at
     FROM plan_handovers h
     JOIN projects p ON p.id = h.source_project_id
     WHERE h.target_project_id = $1 AND h.status IN ('finalized', 'consumed')
     ORDER BY (h.status = 'finalized') DESC, h.finalized_at DESC NULLS LAST
     LIMIT 1`,
    [params.id],
  );
  if (!handover) {
    return NextResponse.json({ data: { handover: null }, error: null });
  }

  const [measures, kpis] = await Promise.all([
    query(
      `SELECT id, title, status, cloned_from_measure_id
       FROM measure_designs WHERE project_id = $1 ORDER BY sort_order, created_at`,
      [params.id],
    ),
    query(
      `SELECT id, label, unit, target::float AS target,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline,
              target_needs_review, indicator_type, cloned_from_kpi_id
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
  ]);

  return NextResponse.json({ data: { handover, measures, kpis }, error: null });
}
