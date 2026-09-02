export const dynamic = "force-dynamic";

/** 収束工程の材料（G1・G2・G4・H3）をまとめて返す */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireModulePermission } from "@/lib/permissions";
import { buildReflectionData } from "@/lib/evaluation/reflectionData";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;
  const data = await buildReflectionData(params.id);
  if (!data) return NextResponse.json({ data: null, error: "計画が見つかりません" }, { status: 404 });
  return NextResponse.json({ data, error: null });
}
