export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { getUserEffectivePermission, type ModuleId } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ effectiveLevel: "none" });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const moduleId = (url.searchParams.get("moduleId") ?? undefined) as ModuleId | undefined;

  // ⚠ テナント境界は **admin バイパスより前**に置く。
  //   かつては role==="admin" なら projectId を一切見ずに "admin" を返しており、
  //   ある自治体の管理者が他自治体の政策に対しても全権限を主張できた
  //   （claude/coe-tenant-isolation.md A-5 / A-6）。
  //   このエンドポイントは {effectiveLevel} 形式を返す契約なので、
  //   境界違反も 404 ではなく "none" で返す（存在を漏らさない点は同じ）。
  if ((await requireProjectAccess(session, projectId)) !== null) {
    return NextResponse.json({ effectiveLevel: "none" });
  }

  // System admin bypass（自分の自治体の政策に限る）
  if (session.user.role === "admin") {
    return NextResponse.json({ effectiveLevel: "admin" });
  }

  const userId = session.user.userRoleId;
  if (!userId) return NextResponse.json({ effectiveLevel: "none" });

  try {
    const effectiveLevel = await getUserEffectivePermission(userId, projectId, moduleId);
    return NextResponse.json({ effectiveLevel });
  } catch {
    return NextResponse.json({ effectiveLevel: "none" });
  }
}
