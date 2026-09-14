export const dynamic = "force-dynamic";

/**
 * 版を上げる（集計データ・CSV・同期取込）
 *
 * multipart: as_of（YYYY-MM-DD・必須）/ file / note（任意）。
 * 上限は AGGREGATE_MAX_BYTES / AGGREGATE_MAX_ROWS（Amplify の 30 秒制限の内側で同期処理できる範囲）。
 * 個票データの版はここでは受けない（D5 で庁内変換ツールの zip を非同期取込）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession, addAggregateVersion } from "@/lib/dataset/service";
import { datasetErrorResponse } from "@/lib/dataset/http";

type Params = { params: { id: string; datasetId: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ data: null, error: "フォームデータの解析に失敗しました" }, { status: 400 });
  }
  const file = form.get("file");
  const asOf = form.get("as_of");
  const note = form.get("note");
  if (!(file instanceof File)) return NextResponse.json({ data: null, error: "ファイルが必要です" }, { status: 400 });
  if (typeof asOf !== "string" || !asOf) return NextResponse.json({ data: null, error: "基準日（as_of）が必要です" }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await addAggregateVersion(actorFromSession(session, "ui"), params.id, params.datasetId, {
      asOf,
      fileName: file.name,
      bytes,
      contentType: file.type || "text/csv",
      note: typeof note === "string" ? note : null,
    });
    return NextResponse.json({ data: result, error: null }, { status: 201 });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
