import "server-only";
import { query, queryOne } from "@/lib/db";
export type { PermissionLevel, ModuleId } from "@/lib/permission-types";
export { PERMISSION_ORDER } from "@/lib/permission-types";
import { PERMISSION_ORDER, type PermissionLevel, type ModuleId } from "@/lib/permission-types";

const PERMISSION_LEVELS = ["none", "view", "edit", "approve", "admin"] as const;

function numToLevel(n: number): PermissionLevel {
  return PERMISSION_LEVELS[Math.min(n, 4)] ?? "none";
}

// ユーザーの実効権限を取得
export async function getUserEffectivePermission(
  userId: string,
  projectId: string,
  moduleId?: ModuleId,
): Promise<PermissionLevel> {
  const memberships = await query<{
    role_id: string;
    rank: number;
    org_unit_id: string;
    unit_path: string;
  }>(
    `SELECT r.id AS role_id, r.rank, r.org_unit_id, u.path AS unit_path
     FROM user_org_memberships m
     JOIN org_roles r ON r.id = m.org_role_id
     JOIN org_units u ON u.id = r.org_unit_id
     WHERE m.user_id = $1
       AND m.is_active = true
       AND (m.expires_at IS NULL OR m.expires_at > NOW())`,
    [userId],
  );

  if (memberships.length === 0) return "none";

  let maxLevel = 0;

  for (const membership of memberships) {
    const perms = await query<{
      project_access: PermissionLevel;
      module_permissions: Record<string, PermissionLevel>;
    }>(
      `SELECT project_access, module_permissions
       FROM role_project_permissions
       WHERE org_role_id = $1
         AND (project_id = $2 OR project_id IS NULL)
       ORDER BY project_id NULLS LAST
       LIMIT 2`,
      [membership.role_id, projectId],
    );

    for (const perm of perms) {
      const lvl = PERMISSION_ORDER[perm.project_access] ?? 0;
      maxLevel = Math.max(maxLevel, lvl);

      if (moduleId && perm.module_permissions[moduleId]) {
        const modLvl = PERMISSION_ORDER[perm.module_permissions[moduleId]] ?? 0;
        maxLevel = Math.max(maxLevel, modLvl);
      }
    }
  }

  return numToLevel(maxLevel);
}

// 権限の委譲可否チェック
export async function canGrantPermission(
  grantorUserId: string,
  targetPermission: PermissionLevel,
  projectId: string,
  moduleId?: ModuleId,
): Promise<boolean> {
  const grantorPermission = await getUserEffectivePermission(
    grantorUserId,
    projectId,
    moduleId,
  );
  return PERMISSION_ORDER[grantorPermission] >= PERMISSION_ORDER[targetPermission];
}

// ユーザーがシステム管理者相当（rank <= 10）かチェック
export async function isOrgAdmin(userRoleId: string): Promise<boolean> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM user_org_memberships m
     JOIN org_roles r ON r.id = m.org_role_id
     WHERE m.user_id = $1
       AND m.is_active = true
       AND r.rank <= 10
       AND (m.expires_at IS NULL OR m.expires_at > NOW())`,
    [userRoleId],
  );
  return parseInt(row?.count ?? "0", 10) > 0;
}
