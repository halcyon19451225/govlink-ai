export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isOrdoAdmin } from "@/lib/ordo-admin";
import { query } from "@/lib/db";


export async function POST(
  _req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!isOrdoAdmin(session)) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  await query(
    `UPDATE knowledge_documents
     SET status = 'pending',
         processing_step = 'upload',
         processing_progress = 0,
         processed_chunks = 0,
         error_message = NULL,
         compiled_draft = '[]',
         processing_log = '[]',
         updated_at = NOW()
     WHERE id = $1`,
    [params.documentId],
  );

  return NextResponse.json({ data: { reset: true }, error: null });
}
