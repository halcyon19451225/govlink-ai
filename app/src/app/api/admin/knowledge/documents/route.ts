export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const rows = await query(
    `SELECT id, title, file_name, file_type, document_category, status, created_at::text
     FROM knowledge_documents
     WHERE tier = 2 AND municipality_id = $1
     ORDER BY created_at DESC`,
    [municipalityId],
  );

  return NextResponse.json({ data: rows, error: null });
}
