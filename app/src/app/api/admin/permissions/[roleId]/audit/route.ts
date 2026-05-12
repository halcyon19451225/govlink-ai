export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { roleId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });

  const role = await queryOne(
    `SELECT r.id FROM org_roles r JOIN org_units u ON u.id = r.org_unit_id
     WHERE r.id = $1 AND (u.municipality_id = $2 OR u.municipality_id IS NULL)`,
    [params.roleId, municipalityId],
  );
  if (!role) return NextResponse.json({ data: null, error: "役職が見つかりません" }, { status: 404 });

  const logs = await query<{
    id: string;
    action: string;
    actor_name: string | null;
    actor_email: string | null;
    project_id: string | null;
    project_title: string | null;
    old_value: unknown;
    new_value: unknown;
    created_at: string;
  }>(
    `SELECT
       l.id,
       l.action,
       u.display_name AS actor_name,
       u.email AS actor_email,
       l.project_id,
       p.title AS project_title,
       l.old_value,
       l.new_value,
       l.created_at::text
     FROM permission_audit_log l
     LEFT JOIN user_roles u ON u.id = l.actor_user_id
     LEFT JOIN projects p ON p.id = l.project_id
     WHERE l.target_role_id = $1
     ORDER BY l.created_at DESC
     LIMIT 100`,
    [params.roleId],
  );

  return NextResponse.json({ data: logs, error: null });
}
