export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const postSchema = z.object({
  title:       z.string().min(1, "タイトルは必須です"),
  description: z.string().default(""),
  sort_order:  z.number().int().default(0),
});

// GET: 全目的一覧
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const goals = await query(
    `SELECT id, goal_number, title, description, sort_order
     FROM project_goals WHERE project_id = $1 ORDER BY sort_order, goal_number`,
    [params.id]
  );
  return NextResponse.json({ data: goals, error: null });
}

// POST: 目的を追加
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "バリデーションエラー" }, { status: 422 });
  }

  // 次の goal_number を採番
  const countRows = await query<{ max_num: number | null }>(
    "SELECT MAX(goal_number) AS max_num FROM project_goals WHERE project_id = $1",
    [params.id]
  );
  const nextNum = (countRows[0]?.max_num ?? 0) + 1;

  const rows = await query<{ id: string }>(
    `INSERT INTO project_goals (project_id, goal_number, title, description, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [params.id, nextNum, parsed.data.title, parsed.data.description, parsed.data.sort_order]
  );

  return NextResponse.json({ data: { id: rows[0]?.id, goal_number: nextNum }, error: null }, { status: 201 });
}
