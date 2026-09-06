import "server-only";
import { type Session } from "next-auth";
import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { requireProjectAccess } from "@/lib/tenant";
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

/**
 * モジュール権限ガード。
 * 権限不足時は NextResponse（403）を返す。
 * 十分な場合は null を返す（呼び出し側は null チェックして early return する）。
 *
 * isOrgAdmin（rank≤10）または role='admin' のユーザーは
 * 常に admin 権限扱いで通過する（後方互換）。
 *
 * 使い方:
 *   const deny = await requireModulePermission(session, projectId, "gap_analysis", "edit");
 *   if (deny) return deny;
 */
export async function requireModulePermission(
  session: Session | null,
  projectId: string,
  moduleId: ModuleId,
  required: PermissionLevel,
): Promise<NextResponse | null> {
  if (!session?.user?.id) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  // ⚠ **モジュール権限より先にテナント境界を見る。**
  //   ここは「この人はこのモジュールを編集してよいか」を答える関数であって、
  //   「この政策が自分の自治体のものか」は答えていなかった。そのため下の
  //   `role === "admin"` の早期 return が、**他自治体の政策に対するフルアクセス**に
  //   なっていた（claude/coe-tenant-isolation.md A-5）。
  //   境界は必ず admin バイパスより前に置くこと。
  const outOfTenant = await requireProjectAccess(session, projectId);
  if (outOfTenant) return outOfTenant;

  // isOrgAdmin または role='admin' は常に全権限を持つ（後方互換）
  // ただし上のテナント境界を通った政策に限る
  if (session.user.isOrgAdmin || session.user.role === "admin") {
    return null;
  }

  const effective = await getUserEffectivePermission(session.user.id, projectId, moduleId);
  const ok = PERMISSION_ORDER[effective] >= PERMISSION_ORDER[required];
  if (!ok) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
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
