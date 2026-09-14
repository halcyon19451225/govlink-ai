export const dynamic = "force-dynamic";

/**
 * 提案の承認・見送り（D6・設計 §10-3・§10-5）
 *
 * **AI は決められない。決めるのは担当者。**
 * 承認すると、画面から登録したときと同じサービス関数（createDatasetTx /
 * createIndicatorTx）を、同じ検証を通って呼ぶ。作成者は承認した担当者で、
 * 経路だけが via='dialogue' になる。だから後から画面で編集・削除できるし、
 * 履歴も画面から作ったものと同じ形で並ぶ。
 *
 * 権限は「編集」を要求する（実体が作られるため。見るだけなら一覧の GET）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession } from "@/lib/activity";
import { approveProposal, declineProposal, ProposalError } from "@/lib/dialogue/service";

type Params = { params: { id: string; dialogueId: string; proposalId: string } };

const bodySchema = z.object({
  action: z.enum(["approve", "decline"]),
  reason: z.string().trim().max(400).nullish(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  // actor は承認した担当者。via='dialogue' は「対話から来た」ことを表すだけで、
  // 責任の所在は人に置く（設計 §10-5）
  const actor = actorFromSession(session, "dialogue", {
    dialogue_kind: "measure",
    dialogue_id: params.dialogueId,
  });

  try {
    if (parsed.data.action === "approve") {
      const result = await approveProposal(actor, params.id, params.proposalId);
      return NextResponse.json({ data: result, error: null });
    }
    const row = await declineProposal(actor, params.id, params.proposalId, parsed.data.reason ?? null);
    return NextResponse.json({ data: { proposal: row }, error: null });
  } catch (e) {
    if (e instanceof ProposalError) {
      return NextResponse.json({ data: null, error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "処理に失敗しました";
    console.error("[measure-dialogue/proposals]", msg);
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
