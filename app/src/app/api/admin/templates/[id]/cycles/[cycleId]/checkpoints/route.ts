export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const postSchema = z.object({
  name: z.string().min(1, "チェックポイント名は必須です"),
  description: z.string().optional().nullable(),
  plan_year: z.number().int().min(0),
  month_start: z.number().int().min(1).max(12),
  month_end: z.number().int().min(1).max(12).optional().nullable(),
  evaluation_tiers: z.array(z.string()).default([]),
  modules_involved: z.array(z.string()).default([]),
  qc_step: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  sort_order: z.number().int().default(0),
});

type Params = { params: { id: string; cycleId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  // テンプレート確認 & システムテンプレートチェック
  const tmplRows = await query<{ id: string; is_system_template: boolean }>(
    "SELECT id, is_system_template FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = tmplRows[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system_template) {
    return NextResponse.json({ data: null, error: "システムテンプレートは変更できません" }, { status: 403 });
  }

  // サイクル確認
  const cycleRows = await query<{ id: string }>(
    "SELECT id FROM pdca_cycle_defs WHERE id = $1 AND template_id = $2",
    [params.cycleId, params.id],
  );
  if (!cycleRows[0]) {
    return NextResponse.json({ data: null, error: "サイクルが見つかりません" }, { status: 404 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
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

  const result = await query<{ id: string }>(
    `INSERT INTO pdca_checkpoint_defs
       (cycle_id, name, description, plan_year, month_start, month_end,
        evaluation_tiers, modules_involved, qc_step, instructions, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      params.cycleId, name, description ?? null, plan_year, month_start, month_end ?? null,
      evaluation_tiers, modules_involved, qc_step ?? null, instructions ?? null, sort_order,
    ],
  );

  return NextResponse.json({ data: { id: result[0]?.id }, error: null }, { status: 201 });
}
