export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    description?: string;
    color?: string;
    sort_order?: number;
    is_active?: boolean;
  };

  const sets: string[] = ["updated_at = NOW()"];
  const vals: unknown[] = [];
  let i = 1;

  if (body.name !== undefined) { sets.push(`name = $${i++}`); vals.push(body.name.trim()); }
  if (body.description !== undefined) { sets.push(`description = $${i++}`); vals.push(body.description.trim() || null); }
  if (body.color !== undefined) { sets.push(`color = $${i++}`); vals.push(body.color); }
  if (body.sort_order !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(body.sort_order); }
  if (body.is_active !== undefined) { sets.push(`is_active = $${i++}`); vals.push(body.is_active); }

  if (vals.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  vals.push(params.id);
  await query(
    `UPDATE knowledge_categories SET ${sets.join(", ")} WHERE id = $${i}`,
    vals,
  );

  return NextResponse.json({ data: { id: params.id }, error: null });
}
