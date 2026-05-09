export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["upcoming", "in_progress", "completed", "skipped"]).optional(),
  completion_notes: z.string().optional().nullable(),
});

type Params = { params: { id: string; cpId: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { status, completion_notes } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (status !== undefined) {
    updates.push(`status = $${idx++}`);
    values.push(status);

    if (status === "in_progress") {
      updates.push(`started_at = COALESCE(started_at, NOW())`);
    } else if (status === "completed") {
      updates.push(`completed_at = NOW()`);
    }
  }

  if (completion_notes !== undefined) {
    updates.push(`completion_notes = $${idx++}`);
    values.push(completion_notes);
  }

  if (updates.length === 0) {
    return NextResponse.json({ data: { id: params.cpId }, error: null });
  }

  // プロジェクトIDもWHEREに含めてセキュリティを確保
  values.push(params.cpId);
  values.push(params.id);
  await query(
    `UPDATE project_pdca_checkpoints SET ${updates.join(", ")} WHERE id = $${idx} AND project_id = $${idx + 1}`,
    values,
  );

  return NextResponse.json({ data: { id: params.cpId }, error: null });
}
