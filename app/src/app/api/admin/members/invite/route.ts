export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { PgErrorCode, isPgError } from "@/lib/db";

const schema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません"),
  org_role_id: z.string().uuid("役職IDが不正です"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  const grantorId = session.user?.userRoleId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });

  const { email, org_role_id } = parsed.data;

  // 対象ユーザーをメールアドレスで検索
  const targetUser = await queryOne<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM user_roles WHERE email = $1 AND municipality_id = $2",
    [email, municipalityId],
  );
  if (!targetUser) {
    return NextResponse.json({ data: null, error: `${email} はこの自治体に登録されていません。先にユーザー管理からアカウントを作成してください。` }, { status: 404 });
  }

  // 役職が同じ自治体のものか確認
  const role = await queryOne<{ id: string; rank: number }>(
    `SELECT r.id, r.rank FROM org_roles r
     JOIN org_units u ON u.id = r.org_unit_id
     WHERE r.id = $1 AND (u.municipality_id = $2 OR u.municipality_id IS NULL)`,
    [org_role_id, municipalityId],
  );
  if (!role) return NextResponse.json({ data: null, error: "指定された役職が見つかりません" }, { status: 404 });

  try {
    await queryOne(
      `INSERT INTO user_org_memberships (user_id, org_role_id, granted_by, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, org_role_id) DO UPDATE SET is_active = true, granted_at = NOW(), granted_by = $3`,
      [targetUser.id, org_role_id, grantorId ?? null],
    );
  } catch (e) {
    if (isPgError(e) && e.code === PgErrorCode.FOREIGN_KEY_VIOLATION) {
      return NextResponse.json({ data: null, error: "役職が存在しません" }, { status: 400 });
    }
    throw e;
  }

  return NextResponse.json({ data: { user_id: targetUser.id, display_name: targetUser.display_name }, error: null }, { status: 201 });
}
