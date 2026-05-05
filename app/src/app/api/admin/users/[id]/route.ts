export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const patchSchema = z.object({
  role: z.enum(["admin", "manager", "member", "viewer"]).optional(),
  display_name: z.string().min(1).optional(),
  department: z.string().optional().nullable(),
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

  const { role, display_name, department } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (role !== undefined)         { updates.push(`role = $${idx++}`); values.push(role); }
  if (display_name !== undefined) { updates.push(`display_name = $${idx++}`); values.push(display_name); }
  if (department !== undefined)   { updates.push(`department = $${idx++}`); values.push(department); }

  if (updates.length === 0) {
    return NextResponse.json({ data: { id: params.id }, error: null });
  }

  values.push(params.id, municipalityId);
  const result = await query<{ id: string }>(
    `UPDATE user_roles SET ${updates.join(", ")}
     WHERE id = $${idx} AND municipality_id = $${idx + 1}
     RETURNING id`,
    values,
  );

  if (!result[0]) {
    return NextResponse.json({ data: null, error: "ユーザーが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: params.id }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  await query(
    "DELETE FROM user_roles WHERE id = $1 AND municipality_id = $2",
    [params.id, municipalityId],
  );

  return NextResponse.json({ data: { id: params.id }, error: null });
}
