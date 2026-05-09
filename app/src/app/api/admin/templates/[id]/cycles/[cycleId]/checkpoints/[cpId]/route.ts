export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  plan_year: z.number().int().min(0).optional(),
  month_start: z.number().int().min(1).max(12).optional(),
  month_end: z.number().int().min(1).max(12).optional().nullable(),
  evaluation_tiers: z.array(z.string()).optional(),
  modules_involved: z.array(z.string()).optional(),
  qc_step: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
});

type Params = { params: { id: string; cycleId: string; cpId: string } };

async function checkAccess(templateId: string, cycleId: string, cpId: string) {
  const tmplRows = await query<{ id: string; is_system_template: boolean }>(
    "SELECT id, is_system_template FROM plan_templates WHERE id = $1",
    [templateId],
  );
  const tmpl = tmplRows[0];
  if (!tmpl) return { error: "テンプレートが見つかりません", status: 404 };
  if (tmpl.is_system_template) return { error: "システムテンプレートは変更できません", status: 403 };

  const cpRows = await query<{ id: string }>(
    `SELECT pcd.id FROM pdca_checkpoint_defs pcd
     JOIN pdca_cycle_defs cyc ON cyc.id = pcd.cycle_id
     WHERE pcd.id = $1 AND pcd.cycle_id = $2 AND cyc.template_id = $3`,
    [cpId, cycleId, templateId],
  );
  if (!cpRows[0]) return { error: "チェックポイントが見つかりません", status: 404 };

  return { error: null, status: 200 };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const access = await checkAccess(params.id, params.cycleId, params.cpId);
  if (access.error) {
    return NextResponse.json({ data: null, error: access.error }, { status: access.status });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const {
    name, description, plan_year, month_start, month_end,
    evaluation_tiers, modules_involved, qc_step, instructions, sort_order,
  } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined)               { updates.push(`name = $${idx++}`); values.push(name); }
  if (description !== undefined)        { updates.push(`description = $${idx++}`); values.push(description); }
  if (plan_year !== undefined)          { updates.push(`plan_year = $${idx++}`); values.push(plan_year); }
  if (month_start !== undefined)        { updates.push(`month_start = $${idx++}`); values.push(month_start); }
  if (month_end !== undefined)          { updates.push(`month_end = $${idx++}`); values.push(month_end); }
  if (evaluation_tiers !== undefined)   { updates.push(`evaluation_tiers = $${idx++}`); values.push(evaluation_tiers); }
  if (modules_involved !== undefined)   { updates.push(`modules_involved = $${idx++}`); values.push(modules_involved); }
  if (qc_step !== undefined)            { updates.push(`qc_step = $${idx++}`); values.push(qc_step); }
  if (instructions !== undefined)       { updates.push(`instructions = $${idx++}`); values.push(instructions); }
  if (sort_order !== undefined)         { updates.push(`sort_order = $${idx++}`); values.push(sort_order); }

  if (updates.length === 0) {
    return NextResponse.json({ data: { id: params.cpId }, error: null });
  }

  values.push(params.cpId);
  await query(
    `UPDATE pdca_checkpoint_defs SET ${updates.join(", ")} WHERE id = $${idx}`,
    values,
  );

  return NextResponse.json({ data: { id: params.cpId }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const access = await checkAccess(params.id, params.cycleId, params.cpId);
  if (access.error) {
    return NextResponse.json({ data: null, error: access.error }, { status: access.status });
  }

  await query("DELETE FROM pdca_checkpoint_defs WHERE id = $1", [params.cpId]);

  return NextResponse.json({ data: { id: params.cpId }, error: null });
}
