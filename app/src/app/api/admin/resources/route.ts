export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const bodySchema = z.object({
  resource_type: z.enum(["advisory_board", "meeting", "tool", "other"]),
  name: z.string().min(1, "名称は必須です"),
  purpose: z.string().optional(),
  contact: z.string().optional(),
  schedule_pattern: z.string().optional(),
  notes: z.string().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = (session.user as { municipalityId?: string }).municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  const rows = await query(
    `SELECT id, resource_type, name, purpose, contact, schedule_pattern, notes, created_at
     FROM org_resources
     WHERE municipality_id = $1
     ORDER BY resource_type, name`,
    [municipalityId],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = (session.user as { municipalityId?: string }).municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { resource_type, name, purpose, contact, schedule_pattern, notes } = parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO org_resources
       (municipality_id, resource_type, name, purpose, contact, schedule_pattern, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [municipalityId, resource_type, name, purpose ?? null, contact ?? null, schedule_pattern ?? null, notes ?? null],
  );

  if (!rows[0]) {
    return NextResponse.json({ data: null, error: "登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: rows[0].id }, error: null }, { status: 201 });
}
