export const dynamic = "force-dynamic";

/**
 * 指標管理 — 1件の詳細・更新・削除（D4）
 *
 * 詳細では「定義」「目標（スコープ別）」「値の履歴」をまとめて返す。
 * 画面はこの3つを1つの画面に並べる（どう測るか・どこまで目指すか・いくつだったか）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession } from "@/lib/activity";
import { indicatorErrorResponse } from "@/lib/indicator/http";
import {
  deleteIndicator,
  getIndicator,
  listTargets,
  listValues,
  setTarget,
  updateIndicator,
  type SetTargetInput,
  type UpdateIndicatorInput,
} from "@/lib/indicator/service";
import { validateSpec } from "@/lib/indicator/spec";

type Params = { params: { id: string; indicatorId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  const indicator = await getIndicator(params.id, params.indicatorId);
  if (!indicator) return NextResponse.json({ data: null, error: "指標が見つかりません" }, { status: 404 });
  const [targets, values] = await Promise.all([
    listTargets(params.indicatorId),
    listValues(params.indicatorId, { limit: 200 }),
  ]);
  return NextResponse.json({ data: { indicator, targets, values }, error: null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: UpdateIndicatorInput & { target?: SetTargetInput };
  try {
    body = (await req.json()) as UpdateIndicatorInput & { target?: SetTargetInput };
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }

  // 設定を変えるときは、変えた後の形で検査する（壊れた設定を保存させない）
  if (body.spec !== undefined) {
    const existing = await getIndicator(params.id, params.indicatorId);
    const calcType = body.calcType ?? existing?.calc_type ?? "manual";
    if (calcType !== "manual") {
      const errs = validateSpec(body.spec);
      if (errs.length > 0) return NextResponse.json({ data: null, error: errs[0], details: errs }, { status: 400 });
    }
  }

  try {
    const actor = actorFromSession(session, "ui");
    const { target, ...patch } = body;
    const updated = Object.keys(patch).length > 0
      ? await updateIndicator(actor, params.id, params.indicatorId, patch)
      : await getIndicator(params.id, params.indicatorId);
    if (target) await setTarget(actor, params.id, params.indicatorId, target);
    return NextResponse.json({ data: updated, error: null });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  try {
    await deleteIndicator(actorFromSession(session, "ui"), params.id, params.indicatorId);
    return NextResponse.json({ data: { id: params.indicatorId }, error: null });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}
