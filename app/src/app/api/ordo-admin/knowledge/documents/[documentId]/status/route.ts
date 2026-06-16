export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function GET(
  _req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const rows = await query(
    `SELECT status, processing_step, processing_progress,
            processed_chunks, total_chunks, processing_log, error_message
     FROM knowledge_documents
     WHERE id = $1`,
    [params.documentId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ data: null, error: "ドキュメントが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: rows[0], error: null });
}
