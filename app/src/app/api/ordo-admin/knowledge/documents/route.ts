export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const categoryId = req.nextUrl.searchParams.get("category_id");

  const rows = await query(
    `SELECT
       d.id, d.title, d.description, d.file_name, d.file_type, d.file_size_bytes,
       d.document_category, d.category_id, d.status,
       d.processing_step, d.processing_progress,
       d.error_message, d.created_at::text, d.compiled_at::text,
       COALESCE(
         json_agg(
           json_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'pdca_phase', t.pdca_phase)
         ) FILTER (WHERE t.id IS NOT NULL),
         '[]'
       ) AS tags
     FROM knowledge_documents d
     LEFT JOIN knowledge_document_tags dt ON dt.document_id = d.id
     LEFT JOIN knowledge_tags t ON t.id = dt.tag_id
     WHERE d.tier = 1
       ${categoryId ? "AND d.category_id = $1" : ""}
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
    categoryId ? [categoryId] : [],
  );

  return NextResponse.json({ data: rows, error: null });
}
