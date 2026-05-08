export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  plan_type: z.enum(["kaigo_hoken", "shougai_fukushi", "kenko_zoshin", "chiiki_fukushi", "custom"]).optional(),
  description: z.string().optional().nullable(),
  plan_period_years: z.number().int().min(1).max(10).optional(),
  module_config: z.record(z.string(), z.object({ enabled: z.boolean() })).optional(),
  is_public: z.boolean().optional(),
});

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  const existing = await query<{ id: string; is_system_template: boolean; created_by: string | null }>(
    "SELECT id, is_system_template, created_by FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = existing[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system_template) {
    return NextResponse.json({ data: null, error: "システムテンプレートは変更できません" }, { status: 403 });
  }
  if (tmpl.created_by && tmpl.created_by !== municipalityId) {
    return NextResponse.json({ data: null, error: "このテンプレートを変更する権限がありません" }, { status: 403 });
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

  const { name, plan_type, description, plan_period_years, module_config, is_public } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined)              { updates.push(`name = $${idx++}`); values.push(name); }
  if (plan_type !== undefined)         { updates.push(`plan_type = $${idx++}`); values.push(plan_type); }
  if (description !== undefined)       { updates.push(`description = $${idx++}`); values.push(description); }
  if (plan_period_years !== undefined) { updates.push(`plan_period_years = $${idx++}`); values.push(plan_period_years); }
  if (module_config !== undefined)     { updates.push(`module_config = $${idx++}::jsonb`); values.push(JSON.stringify(module_config)); }
  if (is_public !== undefined)         { updates.push(`is_public = $${idx++}`); values.push(is_public); }

  if (updates.length === 0) {
    return NextResponse.json({ data: { id: params.id }, error: null });
  }

  updates.push(`updated_at = NOW()`);
  values.push(params.id);
  await query(
    `UPDATE plan_templates SET ${updates.join(", ")} WHERE id = $${idx}`,
    values,
  );

  return NextResponse.json({ data: { id: params.id }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const existing = await query<{ id: string; is_system_template: boolean }>(
    "SELECT id, is_system_template FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = existing[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system_template) {
    return NextResponse.json({ data: null, error: "システムテンプレートは削除できません" }, { status: 403 });
  }

  await query("DELETE FROM plan_templates WHERE id = $1", [params.id]);
  return NextResponse.json({ data: { id: params.id }, error: null });
}
