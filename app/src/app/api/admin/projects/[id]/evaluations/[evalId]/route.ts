export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

type Params = { params: { id: string; evalId: string } };

const patchSchema = z.object({
  evaluation_tier: z.enum(["needs", "theory", "process", "outcome", "cost"]).optional(),
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
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

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
  if (d.kpi_ids !== undefined) {
    const kpiIds = d.kpi_ids && d.kpi_ids.length > 0 ? d.kpi_ids : null;
    fields.push(`kpi_ids = COALESCE($${idx++}::uuid[], '{}'::uuid[])`);
    values.push(kpiIds);
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
               achievement_rate::float, findings, flow_decision_path, created_at::text`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  await queryOne(
    "DELETE FROM program_evaluations WHERE id = $1 AND project_id = $2 RETURNING id",
    [params.evalId, params.id],
  );

  return NextResponse.json({ data: { deleted: true }, error: null });
}
