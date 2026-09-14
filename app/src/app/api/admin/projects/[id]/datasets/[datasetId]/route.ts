export const dynamic = "force-dynamic";

/** 箱の詳細（版の履歴つき）と更新（名称・説明・取得方法） */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession, getDataset, listVersions, updateDataset } from "@/lib/dataset/service";
import { datasetErrorResponse } from "@/lib/dataset/http";

type Params = { params: { id: string; datasetId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  const dataset = await getDataset(params.id, params.datasetId);
  if (!dataset) return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
  const versions = await listVersions(dataset.id);
  return NextResponse.json({ data: { dataset, versions }, error: null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: { name?: string; description?: string | null; acquisition?: Record<string, unknown> | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  try {
    const updated = await updateDataset(actorFromSession(session, "ui"), params.id, params.datasetId, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.acquisition !== undefined ? { acquisition: body.acquisition } : {}),
    });
    return NextResponse.json({ data: updated, error: null });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
