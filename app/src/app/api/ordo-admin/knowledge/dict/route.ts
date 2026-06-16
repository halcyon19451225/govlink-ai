export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

interface DictSection {
  pdca_tags?: string[];
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const categoryId = req.nextUrl.searchParams.get("category_id");
  const tagSlug = req.nextUrl.searchParams.get("tag");

  if (categoryId) {
    const rows = await query<{ id: string; dict_data: Record<string, unknown>; version: number; updated_at: string }>(
      `SELECT id, dict_data, version, updated_at::text
       FROM knowledge_dicts
       WHERE tier = 1 AND category_id = $1`,
      [categoryId],
    );

    if (rows.length === 0) {
      return NextResponse.json({
        data: {
          id: null,
          dict_data: { version: 0, sections: [], global_terms: {}, planning_checklist: [] },
          version: 0,
        },
        error: null,
      });
    }

    const row = rows[0]!;
    const dictData = row.dict_data as { sections?: DictSection[]; [k: string]: unknown };
    let sections: DictSection[] = (dictData.sections ?? []) as DictSection[];

    if (tagSlug) {
      sections = sections.filter(
        (s) => Array.isArray(s.pdca_tags) && s.pdca_tags.includes(tagSlug),
      );
    }

    return NextResponse.json({
      data: { ...row, dict_data: { ...dictData, sections } },
      error: null,
    });
  }

  // カテゴリ指定なし（後方互換）
  const rows = await query(
    `SELECT id, dict_data, version, updated_at::text
     FROM knowledge_dicts
     WHERE tier = 1 AND municipality_id IS NULL`,
  );
  return NextResponse.json({ data: rows[0] ?? null, error: null });
}
