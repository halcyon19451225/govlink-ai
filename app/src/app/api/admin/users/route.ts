import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  const users = await query<{
    id: string;
    cognito_user_id: string;
    email: string;
    display_name: string;
    role: string;
    department: string | null;
    created_at: string;
  }>(
    `SELECT id, cognito_user_id, email, display_name, role, department, created_at::text
     FROM user_roles
     WHERE municipality_id = $1
     ORDER BY created_at DESC`,
    [municipalityId],
  );

  return NextResponse.json({ data: users, error: null });
}

const postSchema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません"),
  display_name: z.string().min(1, "表示名は必須です"),
  role: z.enum(["admin", "manager", "member", "viewer"]),
  department: z.string().optional().nullable(),
  cognito_user_id: z.string().min(1, "ユーザーIDは必須です"),
});

export async function POST(req: NextRequest) {
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

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { email, display_name, role, department, cognito_user_id } = parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO user_roles (municipality_id, cognito_user_id, email, display_name, role, department)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (municipality_id, cognito_user_id)
     DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name,
                   role = EXCLUDED.role, department = EXCLUDED.department
     RETURNING id`,
    [municipalityId, cognito_user_id, email, display_name, role, department ?? null],
  );

  return NextResponse.json({ data: { id: rows[0]?.id }, error: null }, { status: 201 });
}
