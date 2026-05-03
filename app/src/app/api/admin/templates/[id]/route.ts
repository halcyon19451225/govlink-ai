import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum([
    "elderly_care","disability","child","health",
    "urban","disaster","environment","education","other",
  ]).optional(),
  legal_basis: z.string().optional().nullable(),
  plan_period_years: z.number().int().optional().nullable(),
  is_composite: z.boolean().optional(),
  description: z.string().optional().nullable(),
  share: z.boolean().optional(),
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

  // 所有権確認（システムテンプレートは変更不可）
  const existing = await query<{ id: string; is_system: boolean; shared_by_municipality_id: string | null }>(
    "SELECT id, is_system, shared_by_municipality_id FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = existing[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system) {
    return NextResponse.json({ data: null, error: "システムテンプレートは変更できません" }, { status: 403 });
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

  const { name, category, legal_basis, plan_period_years, is_composite, description, share } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined)               { updates.push(`name = $${idx++}`); values.push(name); }
  if (category !== undefined)           { updates.push(`category = $${idx++}`); values.push(category); }
  if (legal_basis !== undefined)        { updates.push(`legal_basis = $${idx++}`); values.push(legal_basis); }
  if (plan_period_years !== undefined)  { updates.push(`plan_period_years = $${idx++}`); values.push(plan_period_years); }
  if (is_composite !== undefined)       { updates.push(`is_composite = $${idx++}`); values.push(is_composite); }
  if (description !== undefined)        { updates.push(`description = $${idx++}`); values.push(description); }
  if (share !== undefined)              {
    updates.push(`shared_by_municipality_id = $${idx++}`);
    values.push(share ? municipalityId : null);
  }

  if (updates.length === 0) {
    return NextResponse.json({ data: { id: params.id }, error: null });
  }

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

  const existing = await query<{ id: string; is_system: boolean }>(
    "SELECT id, is_system FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = existing[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system) {
    return NextResponse.json({ data: null, error: "システムテンプレートは削除できません" }, { status: 403 });
  }

  await query("DELETE FROM plan_templates WHERE id = $1", [params.id]);
  return NextResponse.json({ data: { id: params.id }, error: null });
}
