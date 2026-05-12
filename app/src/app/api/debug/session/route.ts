export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { isOrgAdmin } from "@/lib/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  const userRoleId = session.user?.userRoleId;

  // DBから直接確認
  let dbRow: { id: string; role: string; cognito_user_id: string | null; email: string } | null = null;
  let orgAdminCheck = false;

  try {
    if (userRoleId) {
      dbRow = await queryOne<{ id: string; role: string; cognito_user_id: string | null; email: string }>(
        "SELECT id, role, cognito_user_id, email FROM user_roles WHERE id = $1",
        [userRoleId],
      );
      orgAdminCheck = await isOrgAdmin(userRoleId);
    }
  } catch (e) {
    return NextResponse.json({
      authenticated: true,
      session_user: session.user,
      db_error: String(e),
    });
  }

  return NextResponse.json({
    authenticated: true,
    session_user: session.user,
    db_user_row: dbRow,
    db_isOrgAdmin: orgAdminCheck,
    diagnosis: {
      role_check: session.user?.role === "admin",
      isOrgAdmin_from_session: session.user?.isOrgAdmin,
      isOrgAdmin_from_db: orgAdminCheck,
      userRoleId_set: !!userRoleId,
      would_redirect: !(session.user?.role === "admin" || orgAdminCheck),
    },
  });
}
