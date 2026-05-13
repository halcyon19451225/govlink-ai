export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const rows = await query(
    `SELECT id, title, description, file_name, file_type, file_size_bytes,
            document_category, status, error_message, created_at::text, compiled_at::text
     FROM knowledge_documents
     WHERE tier = 1
     ORDER BY created_at DESC`,
  );

  return NextResponse.json({ data: rows, error: null });
}
