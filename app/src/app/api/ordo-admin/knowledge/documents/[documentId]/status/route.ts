export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";
const STALL_THRESHOLD_MS = 3 * 60 * 1000; // 3分

export async function GET(
  _req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const rows = await query<{
    status: string;
    processing_step: string | null;
    processing_progress: number | null;
    processed_chunks: number | null;
    total_chunks: number | null;
    processing_log: unknown;
    error_message: string | null;
    last_chain_ping_at: string | null;
  }>(
    `SELECT status, processing_step, processing_progress,
            processed_chunks, total_chunks, processing_log, error_message,
            last_chain_ping_at::text
     FROM knowledge_documents
     WHERE id = $1`,
    [params.documentId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ data: null, error: "ドキュメントが見つかりません" }, { status: 404 });
  }

  const row = rows[0]!;

  // ストール検知: processing 中かつ最終 ping が 3分以上前、または一度もpingなし
  let stalled = false;
  if (row.status === "processing") {
    if (!row.last_chain_ping_at) {
      stalled = true; // 一度もpingなし = チェーンが起動していない
    } else {
      const pingAge = Date.now() - new Date(row.last_chain_ping_at).getTime();
      if (pingAge > STALL_THRESHOLD_MS) stalled = true;
    }
  }

  const { last_chain_ping_at: _, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
  return NextResponse.json({ data: { ...rest, stalled }, error: null });
}
