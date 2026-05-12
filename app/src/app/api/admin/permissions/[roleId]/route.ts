export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import type { PermissionLevel } from "@/lib/permissions";

type Params = { params: { roleId: string } };

interface PermRow {
  id: string;
  project_id: string | null;
  project_access: PermissionLevel;
  module_permissions: Record<string, PermissionLevel>;
}

interface ProjectRow {
  id: string;
  title: string;
}

export async function GET(_req: NextRequest, { params }: Params) {
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

  const perms = await query<PermRow>(
    `SELECT id, project_id, project_access, module_permissions
     FROM role_project_permissions WHERE org_role_id = $1`,
    [params.roleId],
  );

  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE municipality_id = $1 ORDER BY created_at",
    [municipalityId],
  );

  const defaultPermission = perms.find((p) => p.project_id === null) ?? null;
  const projectPermissions = perms.filter((p) => p.project_id !== null);

  return NextResponse.json({ data: { defaultPermission, projectPermissions, projects }, error: null });
}

const permLevelEnum = z.enum(["none", "view", "edit", "approve", "admin"]);

const putSchema = z.object({
  rows: z.array(z.object({
    project_id: z.string().uuid().nullable(),
    project_access: permLevelEnum,
    module_permissions: z.record(z.string(), permLevelEnum).optional().default(() => ({})),
  })),
});

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  const actorId = session.user?.userRoleId;
  if (!municipalityId) return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  if (!actorId) return NextResponse.json({ data: null, error: "操作者情報が取得できません" }, { status: 400 });

  const role = await queryOne(
    `SELECT r.id FROM org_roles r JOIN org_units u ON u.id = r.org_unit_id
     WHERE r.id = $1 AND (u.municipality_id = $2 OR u.municipality_id IS NULL)`,
    [params.roleId, municipalityId],
  );
  if (!role) return NextResponse.json({ data: null, error: "役職が見つかりません" }, { status: 404 });

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });

  await transaction(async (client) => {
    for (const row of parsed.data.rows) {
      const oldRes = await client.query<{ project_access: string; module_permissions: unknown }>(
        `SELECT project_access, module_permissions FROM role_project_permissions
         WHERE org_role_id = $1 AND project_id ${row.project_id === null ? "IS NULL" : "= $2"}`,
        row.project_id === null ? [params.roleId] : [params.roleId, row.project_id],
      );
      const oldValue = oldRes.rows[0] ?? null;

      if (row.project_id === null) {
        // UNIQUE constraint doesn't cover NULLs — upsert manually
        await client.query(
          `DELETE FROM role_project_permissions WHERE org_role_id = $1 AND project_id IS NULL`,
          [params.roleId],
        );
        await client.query(
          `INSERT INTO role_project_permissions (org_role_id, project_id, project_access, module_permissions)
           VALUES ($1, NULL, $2, $3)`,
          [params.roleId, row.project_access, JSON.stringify(row.module_permissions)],
        );
      } else {
        await client.query(
          `INSERT INTO role_project_permissions (org_role_id, project_id, project_access, module_permissions)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (org_role_id, project_id) DO UPDATE
             SET project_access = EXCLUDED.project_access,
                 module_permissions = EXCLUDED.module_permissions,
                 updated_at = NOW()`,
          [params.roleId, row.project_id, row.project_access, JSON.stringify(row.module_permissions)],
        );
      }

      await client.query(
        `INSERT INTO permission_audit_log
           (action, actor_user_id, target_role_id, project_id, old_value, new_value)
         VALUES ('update', $1, $2, $3, $4, $5)`,
        [
          actorId,
          params.roleId,
          row.project_id,
          JSON.stringify(oldValue),
          JSON.stringify({ project_access: row.project_access, module_permissions: row.module_permissions }),
        ],
      );
    }
  });

  return NextResponse.json({ data: { updated: parsed.data.rows.length }, error: null });
}
