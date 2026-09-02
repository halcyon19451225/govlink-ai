export const dynamic = "force-dynamic";

/**
 * 指標No.5（アクティビティ）の実施率 — タスク完了実績からのオンデマンド集計（CA2-1）。
 *
 * GET ?workId=&fiscalYear= … {planned, completed, rate, breakdown}
 * 実体化（measure_indicator_results への書き込み）はここではしない。
 * 評価の承認時だけ凍結として書く（CA2-2）。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { computeActivityRate } from "@/lib/evaluation/activityStats";

type Params = { params: { id: string; measureId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const workId = req.nextUrl.searchParams.get("workId");
  const fyRaw = req.nextUrl.searchParams.get("fiscalYear");
  const fiscalYear = fyRaw ? Number(fyRaw) : NaN;
  if (!workId || !/^[0-9a-f-]{36}$/i.test(workId) || !Number.isInteger(fiscalYear)) {
    return NextResponse.json(
      { data: null, error: "workId と fiscalYear を指定してください" },
      { status: 400 },
    );
  }

  const work = await queryOne<{ id: string }>(
    `SELECT w.id FROM measure_works w
      WHERE w.id = $1 AND w.project_id = $2 AND w.measure_design_id = $3`,
    [workId, params.id, params.measureId],
  );
  if (!work) {
    return NextResponse.json({ data: null, error: "取組が見つかりません" }, { status: 404 });
  }

  const result = await computeActivityRate(params.id, workId, fiscalYear);
  return NextResponse.json({ data: result, error: null });
}
