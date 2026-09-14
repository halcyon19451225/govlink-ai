export const dynamic = "force-dynamic";

/**
 * 指標管理 — 「最新値の確認」（D4）
 *
 * 設計: claude/coe-dataset-model.md §9-4・§9-5。
 * 基準日（既定は今日）で計算し、**成功したら履歴に1行積む**。
 * 計算できないときは 200 で `{ok:false, missing:[…]}` を返す（**エラーではなく案内**）。
 * 画面はこの構造から「いつ時点の何を上げてほしいか」と、その箱への導線を組み立てる。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession } from "@/lib/activity";
import { indicatorErrorResponse } from "@/lib/indicator/http";
import { computeAndRecord } from "@/lib/indicator/service";
import { describeMissing } from "@/lib/indicator/spec";

type Params = { params: { id: string; indicatorId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: { asOf?: string } = {};
  try { body = (await req.json()) as { asOf?: string }; } catch { /* 本文なしは今日として扱う */ }
  const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);

  try {
    const result = await computeAndRecord(actorFromSession(session, "ui"), params.id, params.indicatorId, asOf);
    if (!result.ok) {
      return NextResponse.json({
        data: {
          ok: false,
          indicatorId: result.indicatorId,
          label: result.label,
          missing: result.missing.map((m) => ({ ...m, message: describeMissing(m) })),
        },
        error: null,
      });
    }
    return NextResponse.json({ data: { ok: true, value: result.value, valueRow: result.valueRow }, error: null });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}
