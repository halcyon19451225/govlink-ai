export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const users = await query<{
    id: string;
    email: string;
    display_name: string;
    role: string;
    department: string | null;
    avatar_url: string | null;
    created_at: string;
  }>(
    `SELECT id, email, display_name, role, department, avatar_url, created_at::text
     FROM user_roles
     WHERE municipality_id = $1
     ORDER BY created_at DESC`,
    [municipalityId],
  );

  const memberships = await query<{
    user_id: string;
    membership_id: string;
    org_role_id: string;
    role_name: string;
    rank: number;
    org_unit_id: string;
    org_unit_name: string;
    granted_at: string;
    expires_at: string | null;
  }>(
    `SELECT
       m.user_id,
       m.id AS membership_id,
       r.id AS org_role_id,
       r.name AS role_name,
       r.rank,
       u.id AS org_unit_id,
       u.name AS org_unit_name,
       m.granted_at::text,
       m.expires_at::text
     FROM user_org_memberships m
     JOIN org_roles r ON r.id = m.org_role_id
     JOIN org_units u ON u.id = r.org_unit_id
     WHERE m.is_active = true
       AND (m.expires_at IS NULL OR m.expires_at > NOW())
       AND (u.municipality_id = $1 OR u.municipality_id IS NULL)`,
    [municipalityId],
  );

  const membershipsByUser: Record<string, typeof memberships> = {};
  for (const m of memberships) {
    (membershipsByUser[m.user_id] ??= []).push(m);
  }

  const data = users.map((u) => ({
    ...u,
    memberships: membershipsByUser[u.id] ?? [],
  }));

  return NextResponse.json({ data, error: null });
}
