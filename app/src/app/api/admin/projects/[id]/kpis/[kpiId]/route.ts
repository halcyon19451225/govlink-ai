export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query } from "@/lib/db";

const patchSchema = z.object({
  label:                 z.string().min(1).optional(),
  target:                z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
  unit:                  z.string().optional(),
  goal_id:               z.string().nullable().optional(),
  indicator_type:        z.enum(["process","outcome_initial","outcome_mid","outcome_intermediate","outcome_long","efficiency"]).optional(),
  previous_value:        z.number().nullable().optional(),
  achievement_condition: z.enum(["lte","lt","gte","gt","eq"]).nullable().optional(),
  target_deadline:       z.string().nullable().optional(), // "YYYY-MM-DD"
  baseline_value:        z.union([z.number(), z.string()]).transform((v) => Number(v)).nullable().optional(),
  baseline_year:         z.number().int().nullable().optional(),
  contributes_to_kpi_id: z.string().uuid().nullable().optional(),
});

// PATCH: KPIを更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; kpiId: string } }
) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "バリデーションエラー" }, { status: 422 });
  }

  const colMap: Record<string, string> = {
    label: "label", target: "target", unit: "unit",
    goal_id: "goal_id", indicator_type: "indicator_type",
    previous_value: "previous_value",
    achievement_condition: "achievement_condition",
    target_deadline: "target_deadline",
    baseline_value: "baseline_value",
    baseline_year: "baseline_year",
    contributes_to_kpi_id: "contributes_to_kpi_id",
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(colMap)) {
    if (k in parsed.data && (parsed.data as Record<string, unknown>)[k] !== undefined) {
      sets.push(`${col} = $${i++}`);
      vals.push((parsed.data as Record<string, unknown>)[k] ?? null);
    }
  }
  sets.push(`updated_at = now()`);

  vals.push(params.kpiId, params.id);
  await query(
    `UPDATE kpis SET ${sets.join(", ")} WHERE id = $${i} AND project_id = $${i + 1}`,
    vals
  );

  return NextResponse.json({ data: { id: params.kpiId }, error: null });
}

// DELETE: KPIを削除
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; kpiId: string } }
) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  await query(
    "DELETE FROM kpis WHERE id = $1 AND project_id = $2",
    [params.kpiId, params.id]
  );

  return NextResponse.json({ data: { id: params.kpiId }, error: null });
}
