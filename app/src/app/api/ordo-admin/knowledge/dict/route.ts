export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const row = await queryOne(
    `SELECT id, dict_data, updated_at::text FROM knowledge_dicts WHERE tier = 1 AND municipality_id IS NULL`,
  );

  return NextResponse.json({ data: row, error: null });
}
