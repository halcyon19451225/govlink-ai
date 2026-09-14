export const dynamic = "force-dynamic";

/**
 * ギャップ分析 — 「登録指標から現状値を取得」（D4）
 *
 * 設計: claude/coe-dataset-model.md §10-1。
 *
 * ここが**旧「データセットから現状値を取得」の置き換え**。
 * 以前は AI に CSV を読ませて現状値を推測させていた。読み取りの当否を人が検算できず、
 * 同じ計算を毎回やり直すので値が揺れた。指標管理に登録された「どう測るか」で機械的に計算し、
 * **計算した値は履歴に積む**（via='gap_analysis'）。これで現状値・KPI・評価が同じ値を指す。
 *
 * 計算できない指標は不足として返す（エラーにしない）。画面は
 * 「どのデータセットを・いつ時点で上げればよいか」を並べ、その箱への導線を添える。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { queryOne } from "@/lib/db";
import { actorFromSession } from "@/lib/activity";
import { indicatorErrorResponse } from "@/lib/indicator/http";
import { computeMany, latestValue, listIndicators } from "@/lib/indicator/service";
import { describeMissing } from "@/lib/indicator/spec";

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界（claude/coe-tenant-isolation.md A-4）。拒否は 404
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "gap_analysis", "edit");
  if (deny) return deny;

  let body: { asOf?: string } = {};
  try { body = (await req.json()) as { asOf?: string }; } catch { /* 本文なしは既定の基準日 */ }

  // 既定の基準日は計画の開始日の前日（＝策定時の現状）。無ければ今日
  const project = await queryOne<{ plan_start_date: string | null }>(
    `SELECT plan_start_date::text FROM projects WHERE id = $1`, [params.id],
  );
  let asOf = body.asOf ?? null;
  if (!asOf && project?.plan_start_date) {
    const d = new Date(`${project.plan_start_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    asOf = d.toISOString().slice(0, 10);
  }
  if (!asOf) asOf = new Date().toISOString().slice(0, 10);

  try {
    const indicators = await listIndicators(params.id);
    const computable = indicators.filter((i) => i.calc_type !== "manual");

    const results = computable.length
      ? await computeMany(actorFromSession(session, "gap_analysis"), params.id, computable.map((i) => i.id), asOf)
      : [];

    // 手入力型は計算しない。既に入っている最新値をそのまま渡す（人が入れた値を尊重する）
    const manual = await Promise.all(
      indicators
        .filter((i) => i.calc_type === "manual")
        .map(async (i) => {
          const v = await latestValue(i.id);
          return v && v.value !== null
            ? { kpi_id: i.id, current_value: Number(v.value), source: `手入力（${v.as_of} 時点）` }
            : null;
        }),
    );

    return NextResponse.json({
      data: {
        asOf,
        values: [
          ...results.filter((r) => r.ok).map((r) => ({
            kpi_id: r.indicatorId,
            current_value: (r as { value: number }).value,
            source: `指標管理で算出（${asOf} 時点）`,
          })),
          ...manual.filter((m): m is { kpi_id: string; current_value: number; source: string } => m !== null),
        ],
        missing: results
          .filter((r) => !r.ok)
          .map((r) => ({
            indicatorId: r.indicatorId,
            label: r.label,
            items: (r as { missing: Parameters<typeof describeMissing>[0][] }).missing.map((m) => ({
              ...m, message: describeMissing(m),
            })),
          })),
      },
      error: null,
    });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}
