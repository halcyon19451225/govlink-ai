export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

// プロジェクトに紐付いたナレッジを返す（辞書セクション込み）
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;

  const links = await query<{
    id: string; knowledge_dict_id: string; linked_section_ids: string[];
  }>(
    `SELECT id, knowledge_dict_id, linked_section_ids
     FROM project_knowledge_links WHERE project_id = $1`,
    [params.id],
  );

  if (links.length === 0) return NextResponse.json({ data: { links: [], sections: [] }, error: null });

  // Tier1 + Tier2辞書からセクションを集める
  const tier1 = await queryOne<{ dict_data: { sections?: unknown[] } }>(
    `SELECT dict_data FROM knowledge_dicts WHERE tier = 1 AND municipality_id IS NULL`,
  );
  const tier2 = municipalityId
    ? await queryOne<{ dict_data: { sections?: unknown[] } }>(
        `SELECT dict_data FROM knowledge_dicts WHERE tier = 2 AND municipality_id = $1`,
        [municipalityId],
      )
    : null;

  const allSections = [
    ...((tier1?.dict_data.sections ?? []) as Array<{ id: string }>),
    ...((tier2?.dict_data.sections ?? []) as Array<{ id: string }>),
  ];

  const linkedSectionIds = new Set(links.flatMap((l) => l.linked_section_ids ?? []));
  const filteredSections = linkedSectionIds.size > 0
    ? allSections.filter((s) => linkedSectionIds.has(s.id))
    : allSections;

  return NextResponse.json({ data: { links, sections: filteredSections }, error: null });
}

const linkSchema = z.object({
  knowledge_dict_id: z.string().uuid(),
  linked_section_ids: z.array(z.string()).optional().default([]),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = linkSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  const { knowledge_dict_id, linked_section_ids } = parsed.data;

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM project_knowledge_links WHERE project_id = $1 AND knowledge_dict_id = $2`,
    [params.id, knowledge_dict_id],
  );

  if (existing) {
    await query(
      `UPDATE project_knowledge_links SET linked_section_ids = $1 WHERE id = $2`,
      [linked_section_ids, existing.id],
    );
  } else {
    await query(
      `INSERT INTO project_knowledge_links (project_id, knowledge_dict_id, linked_section_ids, linked_by)
       VALUES ($1, $2, $3, $4)`,
      [params.id, knowledge_dict_id, linked_section_ids, session.user?.userRoleId ?? null],
    );
  }

  return NextResponse.json({ data: { success: true }, error: null });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dictId = searchParams.get("dictId");
  if (!dictId) return NextResponse.json({ data: null, error: "dictId が必要です" }, { status: 400 });

  await query(
    `DELETE FROM project_knowledge_links WHERE project_id = $1 AND knowledge_dict_id = $2`,
    [params.id, dictId],
  );

  return NextResponse.json({ data: { success: true }, error: null });
}
