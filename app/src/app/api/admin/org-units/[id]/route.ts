export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne, transaction } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  org_type: z.enum(["ministry","prefecture","municipality","bureau","division","department","section","team","custom"]).optional(),
  sort_order: z.number().int().optional(),
  // 役職の追加/更新
  role: z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    rank: z.number().int().min(1),
    can_manage_below: z.boolean(),
    is_default_role: z.boolean().optional().default(false),
  }).optional(),
  // 役職削除
  delete_role_id: z.string().uuid().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const unit = await queryOne("SELECT id FROM org_units WHERE id = $1 AND (municipality_id = $2 OR municipality_id IS NULL)", [params.id, municipalityId]);
  if (!unit) return NextResponse.json({ data: null, error: "組織が見つかりません" }, { status: 404 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });

  const { name, org_type, sort_order, role, delete_role_id } = parsed.data;

  await transaction(async (client) => {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
    if (org_type !== undefined) { sets.push(`org_type = $${i++}`); vals.push(org_type); }
    if (sort_order !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(sort_order); }
    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      vals.push(params.id);
      await client.query(`UPDATE org_units SET ${sets.join(", ")} WHERE id = $${i}`, vals);
    }

    if (role) {
      if (role.id) {
        await client.query(
          `UPDATE org_roles SET name=$1, rank=$2, can_manage_below=$3, is_default_role=$4 WHERE id=$5 AND org_unit_id=$6`,
          [role.name, role.rank, role.can_manage_below, role.is_default_role, role.id, params.id],
        );
      } else {
        await client.query(
          `INSERT INTO org_roles (org_unit_id, name, rank, can_manage_below, is_default_role) VALUES ($1,$2,$3,$4,$5)`,
          [params.id, role.name, role.rank, role.can_manage_below, role.is_default_role],
        );
      }
    }

    if (delete_role_id) {
      await client.query("DELETE FROM org_roles WHERE id=$1 AND org_unit_id=$2", [delete_role_id, params.id]);
    }
  });

  const updated = await queryOne(
    `SELECT u.*, COALESCE(json_agg(r ORDER BY r.rank) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
     FROM org_units u LEFT JOIN org_roles r ON r.org_unit_id = u.id
     WHERE u.id = $1 GROUP BY u.id`,
    [params.id],
  );

  return NextResponse.json({ data: updated, error: null });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const unit = await queryOne("SELECT id FROM org_units WHERE id = $1 AND municipality_id = $2", [params.id, municipalityId]);
  if (!unit) return NextResponse.json({ data: null, error: "組織が見つかりません" }, { status: 404 });

  await queryOne("DELETE FROM org_units WHERE id = $1", [params.id]);
  return NextResponse.json({ data: { id: params.id }, error: null });
}
