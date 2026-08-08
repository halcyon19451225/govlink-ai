export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function POST(
  _req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  await query(
    `UPDATE knowledge_documents
     SET status = 'pending',
         processing_step = NULL,
         processing_progress = 0,
         processing_log = '[]'::jsonb,
         error_message = NULL,
         chain_token = NULL,
         last_chain_ping_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND status IN ('processing', 'error')`,
    [params.documentId],
  );

  return NextResponse.json({ data: { ok: true }, error: null });
}
