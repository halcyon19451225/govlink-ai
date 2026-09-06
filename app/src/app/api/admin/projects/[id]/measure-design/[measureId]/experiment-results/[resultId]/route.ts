export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { EXPERIMENT_RESULT_COLUMNS as RESULT_COLUMNS } from "@/lib/measure/experimentResult";

type Params = { params: { id: string; measureId: string; resultId: string } };

// 実験結果の更新・削除 — X2
// 昇格済み（promoted_at あり）の結果は編集・削除不可。
// 昇格した内容はエビデンスとして他の計画が参照し得るため、
// 事後に書き換えられると根拠の追跡が壊れる（妥当性最優先の方針）。

const patchSchema = z.object({
  design: z
    .enum(["rct", "cluster_rct", "stepped_wedge", "waitlist", "did", "matching", "prepost"])
    .optional(),
  implemented_as_planned: z.boolean().optional(),
  deviation_note: z.string().max(2000).optional().nullable(),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  sample_size: z.number().int().min(0).optional().nullable(),
  primary_outcome: z.string().max(400).optional().nullable(),
  result_summary: z.string().trim().min(1).max(4000).optional(),
  effect_direction: z.enum(["improved", "no_change", "worsened", "unclear"]).optional(),
  effect_size: z.string().max(400).optional().nullable(),
  status: z.enum(["draft", "confirmed"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const current = await queryOne<{ id: string; promoted_at: string | null }>(
    `SELECT id, promoted_at::text FROM experiment_results
     WHERE id = $1 AND measure_design_id = $2 AND project_id = $3`,
    [params.resultId, params.measureId, params.id],
  );
  if (!current) {
    return NextResponse.json({ data: null, error: "実験結果が見つかりません" }, { status: 404 });
  }
  if (current.promoted_at) {
    return NextResponse.json(
      { data: null, error: "昇格済みの実験結果は編集できません（エビデンスとして参照されるため）" },
      { status: 422 },
    );
  }

  const d = parsed.data;
  const fields: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  let idx = 1;
  const add = (col: string, val: unknown) => {
    fields.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (d.design !== undefined) add("design", d.design);
  if (d.implemented_as_planned !== undefined)
    add("implemented_as_planned", d.implemented_as_planned);
  if (d.deviation_note !== undefined) add("deviation_note", d.deviation_note);
  if (d.period_start !== undefined) add("period_start", d.period_start);
  if (d.period_end !== undefined) add("period_end", d.period_end);
  if (d.sample_size !== undefined) add("sample_size", d.sample_size);
  if (d.primary_outcome !== undefined) add("primary_outcome", d.primary_outcome);
  if (d.result_summary !== undefined) add("result_summary", d.result_summary);
  if (d.effect_direction !== undefined) add("effect_direction", d.effect_direction);
  if (d.effect_size !== undefined) add("effect_size", d.effect_size);
  if (d.status !== undefined) add("status", d.status);

  values.push(params.resultId, params.measureId, params.id);
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE experiment_results SET ${fields.join(", ")}
     WHERE id = $${idx++} AND measure_design_id = $${idx++} AND project_id = $${idx}
     RETURNING ${RESULT_COLUMNS}`,
    values,
  );

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const current = await queryOne<{ id: string; promoted_at: string | null }>(
    `SELECT id, promoted_at::text FROM experiment_results
     WHERE id = $1 AND measure_design_id = $2 AND project_id = $3`,
    [params.resultId, params.measureId, params.id],
  );
  if (!current) {
    return NextResponse.json({ data: null, error: "実験結果が見つかりません" }, { status: 404 });
  }
  if (current.promoted_at) {
    return NextResponse.json(
      { data: null, error: "昇格済みの実験結果は削除できません（エビデンスとして参照されるため）" },
      { status: 422 },
    );
  }

  await queryOne(
    `DELETE FROM experiment_results
     WHERE id = $1 AND measure_design_id = $2 AND project_id = $3 RETURNING id`,
    [params.resultId, params.measureId, params.id],
  );
  return NextResponse.json({ data: { deleted: true }, error: null });
}
