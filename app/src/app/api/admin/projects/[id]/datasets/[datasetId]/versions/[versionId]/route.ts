export const dynamic = "force-dynamic";

/** 版の詳細（検証結果・先頭行・操作履歴）と無効化 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession, getVersion, rejectVersion, sampleRows, versionActivity } from "@/lib/dataset/service";
import { datasetErrorResponse } from "@/lib/dataset/http";

type Params = { params: { id: string; datasetId: string; versionId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  const version = await getVersion(params.id, params.datasetId, params.versionId);
  if (!version) return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
  const [rows, activity] = await Promise.all([sampleRows(version.id), versionActivity(version.id)]);
  // この版を使っている指標値は指標管理（D4）で入る。いまは常に空
  return NextResponse.json({ data: { version, rows, activity, indicator_values: [] }, error: null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: { status?: string; note?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  if (body.status !== "rejected") {
    // 版は削除も復活もしない。できるのは「無効にする」だけ
    return NextResponse.json({ data: null, error: "版に対して行える操作は「無効にする」（status: rejected）だけです" }, { status: 400 });
  }
  try {
    const v = await rejectVersion(actorFromSession(session, "ui"), params.id, params.datasetId, params.versionId, body.note ?? null);
    return NextResponse.json({ data: v, error: null });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
