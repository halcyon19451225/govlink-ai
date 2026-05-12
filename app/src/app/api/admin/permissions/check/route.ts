export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserEffectivePermission, type ModuleId } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ effectiveLevel: "none" });

  // System admin bypass
  if (session.user.role === "admin") {
    return NextResponse.json({ effectiveLevel: "admin" });
  }

  const userId = session.user.userRoleId;
  if (!userId) return NextResponse.json({ effectiveLevel: "none" });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const moduleId = (url.searchParams.get("moduleId") ?? undefined) as ModuleId | undefined;

  try {
    const effectiveLevel = await getUserEffectivePermission(userId, projectId, moduleId);
    return NextResponse.json({ effectiveLevel });
  } catch {
    return NextResponse.json({ effectiveLevel: "none" });
  }
}
