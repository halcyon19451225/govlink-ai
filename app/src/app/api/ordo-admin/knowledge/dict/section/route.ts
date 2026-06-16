export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

interface DictSection {
  section_id?: string;
  id?: string;
  [key: string]: unknown;
}

interface DictData {
  version?: number;
  sections?: DictSection[];
  [key: string]: unknown;
}

async function getDict(categoryId: string) {
  const rows = await query<{ id: string; dict_data: DictData; version: number }>(
    `SELECT id, dict_data, version FROM knowledge_dicts WHERE tier = 1 AND category_id = $1`,
    [categoryId],
  );
  return rows[0] ?? null;
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json() as {
    categoryId: string;
    sectionId: string;
    patch: Partial<DictSection>;
  };
  const { categoryId, sectionId, patch } = body;

  if (!categoryId || !sectionId) {
    return NextResponse.json({ ok: false, error: "categoryId・sectionIdは必須です" }, { status: 400 });
  }

  const dictRow = await getDict(categoryId);
  if (!dictRow) return NextResponse.json({ ok: false, error: "辞書が見つかりません" }, { status: 404 });

  const sections = dictRow.dict_data.sections ?? [];
  const idx = sections.findIndex((s) => (s.section_id ?? s.id) === sectionId);
  if (idx === -1) return NextResponse.json({ ok: false, error: "セクションが見つかりません" }, { status: 404 });

  sections[idx] = { ...sections[idx]!, ...patch, last_updated: new Date().toISOString() };
  const newVersion = (dictRow.version ?? dictRow.dict_data.version ?? 0) + 1;
  const newDictData = { ...dictRow.dict_data, sections, version: newVersion };

  await query(
    `UPDATE knowledge_dicts SET dict_data = $1::jsonb, version = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(newDictData), newVersion, dictRow.id],
  );

  return NextResponse.json({ ok: true, updatedSection: sections[idx], version: newVersion });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json() as { categoryId: string; sectionId: string };
  const { categoryId, sectionId } = body;

  if (!categoryId || !sectionId) {
    return NextResponse.json({ ok: false, error: "categoryId・sectionIdは必須です" }, { status: 400 });
  }

  const dictRow = await getDict(categoryId);
  if (!dictRow) return NextResponse.json({ ok: false, error: "辞書が見つかりません" }, { status: 404 });

  const sections = (dictRow.dict_data.sections ?? []).filter(
    (s) => (s.section_id ?? s.id) !== sectionId,
  );
  const newVersion = (dictRow.version ?? dictRow.dict_data.version ?? 0) + 1;
  const newDictData = { ...dictRow.dict_data, sections, version: newVersion };

  await query(
    `UPDATE knowledge_dicts SET dict_data = $1::jsonb, version = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(newDictData), newVersion, dictRow.id],
  );

  return NextResponse.json({ ok: true, version: newVersion });
}
