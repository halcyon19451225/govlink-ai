export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

interface KnowledgeTag {
  id: string;
  name: string;
  slug: string;
  pdca_phase: string;
  module_key: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const rows = await query<KnowledgeTag>(
    `SELECT id, name, slug, pdca_phase, module_key, description, sort_order, is_active
     FROM knowledge_tags
     WHERE is_active = true
     ORDER BY sort_order ASC`,
  );

  // pdca_phase でグループ化
  const grouped: Record<string, KnowledgeTag[]> = { P: [], D: [], C: [], A: [], common: [] };
  for (const tag of rows) {
    (grouped[tag.pdca_phase] ??= []).push(tag);
  }

  return NextResponse.json({ data: { tags: rows, grouped }, error: null });
}
