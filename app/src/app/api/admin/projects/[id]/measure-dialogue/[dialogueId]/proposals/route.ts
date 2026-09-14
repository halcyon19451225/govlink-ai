export const dynamic = "force-dynamic";

/**
 * 対話からの提案 — 一覧（D6・設計 §10-3）
 *
 * 提案は**承認されるまで何も作らない**。ここは読むだけで、作るのは
 * `[proposalId]/route.ts` の承認だけ。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { listProposals } from "@/lib/dialogue/service";

type Params = { params: { id: string; dialogueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const rows = await listProposals(params.id, "measure", params.dialogueId);
  return NextResponse.json({ data: rows, error: null });
}
