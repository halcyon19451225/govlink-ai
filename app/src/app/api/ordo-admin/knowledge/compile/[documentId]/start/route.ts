export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { triggerNextStep } from "@/lib/chain-fetch";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function POST(
  _req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });
  }

  const { documentId } = params;

  // ドキュメント存在確認
  const rows = await query<{ id: string }>(
    `SELECT id FROM knowledge_documents WHERE id = $1`,
    [documentId],
  );
  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: "ドキュメントが見つかりません" }, { status: 404 });
  }

  const chainToken = crypto.randomUUID();
  const now = new Date().toISOString();

  // 状態をリセットして新チェーン開始
  await query(
    `UPDATE knowledge_documents
     SET status = 'processing',
         processing_step = 'extract',
         processing_progress = 0,
         processed_chunks = 0,
         compiled_draft = '[]',
         processing_log = '[]',
         error_message = NULL,
         chain_token = $1,
         chain_started_at = $2,
         last_chain_ping_at = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [chainToken, now, documentId],
  );

  // 最初のステップ（extract）を fire-and-forget で起動
  triggerNextStep(documentId, "extract", undefined, chainToken);

  return NextResponse.json({
    ok: true,
    chainToken,
    status: "processing",
  });
}
