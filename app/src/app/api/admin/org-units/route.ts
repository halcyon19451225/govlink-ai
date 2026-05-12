export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, transaction } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const units = await query<{
    id: string; name: string; org_type: string; parent_id: string | null;
    path: string; depth: number; sort_order: number;
  }>(
    `SELECT id, name, org_type, parent_id, path, depth, sort_order
     FROM org_units
     WHERE municipality_id = $1 OR municipality_id IS NULL
     ORDER BY depth ASC, sort_order ASC, name ASC`,
    [municipalityId],
  );

  const roles = await query<{
    id: string; org_unit_id: string; name: string; rank: number;
    can_manage_below: boolean; is_default_role: boolean;
  }>(
    `SELECT r.id, r.org_unit_id, r.name, r.rank, r.can_manage_below, r.is_default_role
     FROM org_roles r
     JOIN org_units u ON u.id = r.org_unit_id
     WHERE u.municipality_id = $1 OR u.municipality_id IS NULL
     ORDER BY r.rank ASC`,
    [municipalityId],
  );

  const rolesByUnit: Record<string, typeof roles> = {};
  for (const role of roles) {
    (rolesByUnit[role.org_unit_id] ??= []).push(role);
  }

  const result = units.map((u) => ({ ...u, roles: rolesByUnit[u.id] ?? [] }));
  return NextResponse.json({ data: result, error: null });
}

const postSchema = z.object({
  name: z.string().min(1, "名称は必須です"),
  org_type: z.enum(["ministry","prefecture","municipality","bureau","division","department","section","team","custom"]),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional().default(0),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });

  const { name, org_type, parent_id, sort_order } = parsed.data;

  const newUnit = await transaction(async (client) => {
    let parentPath = "";
    let depth = 0;

    if (parent_id) {
      const parent = await client.query<{ path: string; depth: number }>(
        "SELECT path, depth FROM org_units WHERE id = $1", [parent_id]
      );
      const p = parent.rows[0];
      if (!p) throw new Error("親組織が見つかりません");
      parentPath = p.path;
      depth = p.depth + 1;
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO org_units (name, org_type, parent_id, municipality_id, depth, sort_order, path)
       VALUES ($1, $2, $3, $4, $5, $6, '/__tmp')
       RETURNING id`,
      [name, org_type, parent_id ?? null, municipalityId, depth, sort_order],
    );
    const id = ins.rows[0]!.id;
    const path = parent_id ? `${parentPath}/${id}` : `/${id}`;
    await client.query("UPDATE org_units SET path = $1 WHERE id = $2", [path, id]);

    return { id, name, org_type, parent_id: parent_id ?? null, path, depth, sort_order, roles: [] };
  });

  return NextResponse.json({ data: newUnit, error: null }, { status: 201 });
}
