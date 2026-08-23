export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { aggregateRate, buildKpiSnapshot } from "@/lib/evaluation/snapshot";

type Params = { params: { id: string; evalId: string } };

const patchSchema = z.object({
  evaluation_tier: z.enum([
    "needs", "theory", "process",
    "outcome",                 // 後方互換
    "outcome_initial",         // 短期アウトカム（概ね1年）
    "outcome_intermediate",    // 中間アウトカム（2〜5年）
    "outcome_long",            // 長期アウトカム（軌道の記録用）
    "cost",                    // 後方互換
    "efficiency",
  ]).optional(),
  fiscal_year: z.number().int().optional().nullable(),
  status: z.enum(["draft", "in_review", "approved"]).optional(),
  result: z.string().optional().nullable(),
  achievement_rate: z.number().min(0).max(100).optional().nullable(),
  findings: z.string().optional().nullable(),
  success_factors: z.string().optional().nullable(),
  barrier_factors: z.string().optional().nullable(),
  improvement_actions: z.string().optional().nullable(),
  next_steps: z.string().optional().nullable(),
  flow_decision_path: z.any().optional().nullable(),
  kpi_ids: z.array(z.string().uuid()).optional().nullable(),
  logic_model_id: z.string().uuid().optional().nullable(),
  measure_design_id: z.string().uuid().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
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

  const d = parsed.data;
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const addField = (col: string, val: unknown) => {
    fields.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (d.evaluation_tier !== undefined) addField("evaluation_tier", d.evaluation_tier);
  if (d.fiscal_year !== undefined) addField("fiscal_year", d.fiscal_year);
  if (d.status !== undefined) addField("status", d.status);
  if (d.result !== undefined) addField("result", d.result);
  if (d.achievement_rate !== undefined) addField("achievement_rate", d.achievement_rate);
  if (d.findings !== undefined) addField("findings", d.findings);
  if (d.success_factors !== undefined) addField("success_factors", d.success_factors);
  if (d.barrier_factors !== undefined) addField("barrier_factors", d.barrier_factors);
  if (d.improvement_actions !== undefined) addField("improvement_actions", d.improvement_actions);
  if (d.next_steps !== undefined) addField("next_steps", d.next_steps);
  if (d.flow_decision_path !== undefined) addField("flow_decision_path", d.flow_decision_path);
  if (d.logic_model_id !== undefined) addField("logic_model_id", d.logic_model_id);
  if (d.measure_design_id !== undefined) addField("measure_design_id", d.measure_design_id);
  if (d.kpi_ids !== undefined) {
    const kpiIds = d.kpi_ids && d.kpi_ids.length > 0 ? d.kpi_ids : null;
    fields.push(`kpi_ids = COALESCE($${idx++}::uuid[], '{}'::uuid[])`);
    values.push(kpiIds);
  }

  // ── 承認時の凍結（C-6）────────────────────────────
  // approved に遷移した時点のKPI実績と算定式を固定する。
  // 以後KPIが更新されても、この評価の数字は書き換わらない。
  if (d.status === "approved") {
    const current = await queryOne<{ kpi_ids: string[] | null; approved_snapshot_at: string | null }>(
      `SELECT kpi_ids, approved_snapshot_at::text
       FROM program_evaluations WHERE id = $1 AND project_id = $2`,
      [params.evalId, params.id],
    );
    // 既に凍結済みなら上書きしない（再承認で数字が動かないようにする）
    if (current && !current.approved_snapshot_at) {
      const ids = d.kpi_ids ?? current.kpi_ids ?? [];
      const snapshot = await buildKpiSnapshot(params.id, ids);
      const computed = aggregateRate(snapshot);

      fields.push(`kpi_snapshot = $${idx++}::jsonb`);
      values.push(JSON.stringify(snapshot));

      fields.push(`computed_achievement_rate = $${idx++}`);
      values.push(computed);

      fields.push("approved_snapshot_at = now()");
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  values.push(params.evalId);
  values.push(params.id);

  const row = await queryOne(
    `UPDATE program_evaluations
     SET ${fields.join(", ")}
     WHERE id = $${idx++} AND project_id = $${idx}
     RETURNING id, evaluation_tier, fiscal_year, status, result,
               achievement_rate::float, computed_achievement_rate::float,
               kpi_snapshot, approved_snapshot_at::text,
               findings, flow_decision_path, created_at::text`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
  if (deny) return deny;

  await queryOne(
    "DELETE FROM program_evaluations WHERE id = $1 AND project_id = $2 RETURNING id",
    [params.evalId, params.id],
  );

  return NextResponse.json({ data: { deleted: true }, error: null });
}
