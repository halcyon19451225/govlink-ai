export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireChildRowAccess } from "@/lib/tenant";
import { query } from "@/lib/db";

const bodySchema = z.object({
  action: z.enum(["done", "pending"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  // テナント境界（claude/coe-tenant-isolation.md A-6）。
  // URL は子リソースの id を指すので、schedule_tasks → projects と辿って所属自治体を確認する
  const outOfTenant = await requireChildRowAccess(session, "schedule_tasks", params.id);
  if (outOfTenant) return outOfTenant;
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
