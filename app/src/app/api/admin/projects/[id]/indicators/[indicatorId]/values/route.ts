export const dynamic = "force-dynamic";

/**
 * 指標管理 — 値の手入力（D4）
 *
 * 手入力も**履歴の1行**として積む（`current` という上書きされる欄は無い）。
 * 計算で出した値と同じ表に、同じ形で並ぶ。違いは `via` と `inputs` だけ。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession } from "@/lib/activity";
import { indicatorErrorResponse } from "@/lib/indicator/http";
import { listValues, recordValue } from "@/lib/indicator/service";

type Params = { params: { id: string; indicatorId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  return NextResponse.json({ data: await listValues(params.indicatorId, { limit: 200 }), error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: { asOf?: string; value?: number; note?: string | null };
  try {
    body = (await req.json()) as { asOf?: string; value?: number; note?: string | null };
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
    return NextResponse.json({ data: null, error: "値を数値で入力してください" }, { status: 400 });
  }

  try {
    const row = await recordValue(actorFromSession(session, "ui"), params.id, params.indicatorId, {
      asOf: body.asOf ?? new Date().toISOString().slice(0, 10),
      scope: "plan",
      value: body.value,
      note: body.note ?? "手入力",
    });
    return NextResponse.json({ data: row, error: null }, { status: 201 });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}
