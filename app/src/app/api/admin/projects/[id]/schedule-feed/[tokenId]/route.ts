export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

type Params = { params: { id: string; tokenId: string } };

/** ICSフィードトークンの失効（S1 D②段1）— 行は消さず revoked_at を立てる（棚卸し可能に） */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
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
