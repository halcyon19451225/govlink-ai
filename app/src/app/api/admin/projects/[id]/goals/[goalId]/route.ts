export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const patchSchema = z.object({
  title:       z.string().min(1).optional(),
  description: z.string().optional(),
  sort_order:  z.number().int().optional(),
});

// PATCH: 目的を更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; goalId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "バリデーションエラー" }, { status: 422 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (parsed.data.title       !== undefined) { sets.push(`title = $${i++}`);       vals.push(parsed.data.title); }
  if (parsed.data.description !== undefined) { sets.push(`description = $${i++}`); vals.push(parsed.data.description); }
  if (parsed.data.sort_order  !== undefined) { sets.push(`sort_order = $${i++}`);  vals.push(parsed.data.sort_order); }
  if (sets.length === 0) return NextResponse.json({ data: null, error: "更新項目がありません" }, { status: 400 });

  vals.push(params.goalId, params.id);
  await query(
    `UPDATE project_goals SET ${sets.join(", ")} WHERE id = $${i} AND project_id = $${i + 1}`,
    vals
  );

  return NextResponse.json({ data: { id: params.goalId }, error: null });
}

// DELETE: 目的を削除
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; goalId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  await query(
    "DELETE FROM project_goals WHERE id = $1 AND project_id = $2",
    [params.goalId, params.id]
  );

  return NextResponse.json({ data: { id: params.goalId }, error: null });
}
