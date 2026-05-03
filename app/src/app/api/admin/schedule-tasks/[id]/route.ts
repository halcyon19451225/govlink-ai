import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const bodySchema = z.object({
  action: z.enum(["done", "pending"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "action は done または pending のみ有効です" }, { status: 400 });
  }

  const { action } = parsed.data;
  const completedAt = action === "done" ? "NOW()" : "NULL";

  await query(
    `UPDATE schedule_tasks SET completed_at = ${completedAt} WHERE id = $1`,
    [params.id],
  );

  return NextResponse.json({ data: { id: params.id, action }, error: null });
}
