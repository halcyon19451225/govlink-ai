export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const schema = z.object({
  org_role_id: z.string().uuid("役職IDが不正です"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  const grantorId = session.user?.userRoleId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  // 対象ユーザーが同じ自治体か確認
  const targetUser = await queryOne<{ id: string }>(
    "SELECT id FROM user_roles WHERE id = $1 AND municipality_id = $2",
    [params.id, municipalityId],
  );
  if (!targetUser) return NextResponse.json({ data: null, error: "ユーザーが見つかりません" }, { status: 404 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });

  const { org_role_id } = parsed.data;

  // 役職が同じ自治体のものか確認
  const role = await queryOne<{ id: string }>(
    `SELECT r.id FROM org_roles r
     JOIN org_units u ON u.id = r.org_unit_id
     WHERE r.id = $1 AND (u.municipality_id = $2 OR u.municipality_id IS NULL)`,
    [org_role_id, municipalityId],
  );
  if (!role) return NextResponse.json({ data: null, error: "指定された役職が見つかりません" }, { status: 404 });

  await queryOne(
    `INSERT INTO user_org_memberships (user_id, org_role_id, granted_by, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (user_id, org_role_id) DO UPDATE SET is_active = true, granted_at = NOW(), granted_by = $3`,
    [params.id, org_role_id, grantorId ?? null],
  );

  return NextResponse.json({ data: { user_id: params.id, org_role_id }, error: null });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const targetUser = await queryOne<{ id: string }>(
    "SELECT id FROM user_roles WHERE id = $1 AND municipality_id = $2",
    [params.id, municipalityId],
  );
  if (!targetUser) return NextResponse.json({ data: null, error: "ユーザーが見つかりません" }, { status: 404 });

  // 全メンバーシップを無効化
  await queryOne(
    `UPDATE user_org_memberships m
     SET is_active = false
     FROM org_roles r JOIN org_units u ON u.id = r.org_unit_id
     WHERE m.org_role_id = r.id
       AND m.user_id = $1
       AND (u.municipality_id = $2 OR u.municipality_id IS NULL)`,
    [params.id, municipalityId],
  );

  return NextResponse.json({ data: { user_id: params.id }, error: null });
}
