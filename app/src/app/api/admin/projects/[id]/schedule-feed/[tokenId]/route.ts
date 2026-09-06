export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne } from "@/lib/db";

type Params = { params: { id: string; tokenId: string } };

/** ICSフィードトークンの失効（S1 D②段1）— 行は消さず revoked_at を立てる（棚卸し可能に） */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }
  const row = await queryOne<{ id: string }>(
    `UPDATE schedule_feed_tokens SET revoked_at = now()
     WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [params.tokenId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "フィードが見つかりません（すでに失効済みの可能性）" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: row.id }, error: null });
}
