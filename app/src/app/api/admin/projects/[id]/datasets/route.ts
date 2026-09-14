export const dynamic = "force-dynamic";

/**
 * データセット管理 — 箱の一覧と作成（D2）
 *
 * 設計: claude/coe-dataset-model.md §4・§10-5。
 * 実処理はサービス層（lib/dataset/service.ts）にある。ここは認証・テナント境界・権限と
 * 入出力の整形だけを担う。AI の対話からの登録も同じサービス関数を通る。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { queryOne } from "@/lib/db";
import { datasetErrorResponse } from "@/lib/dataset/http";
import {
  actorFromSession,
  createDataset,
  listDatasets,
  listTemplates,
  type CreateDatasetInput,
} from "@/lib/dataset/service";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界（claude/coe-tenant-isolation.md A-4）。拒否は 404
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  const project = await queryOne<{ plan_type: string | null }>(`SELECT plan_type FROM projects WHERE id = $1`, [params.id]);
  const [datasets, templates] = await Promise.all([listDatasets(params.id), listTemplates(project?.plan_type ?? null)]);
  return NextResponse.json({ data: { datasets, templates }, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: Partial<CreateDatasetInput>;
  try {
    body = (await req.json()) as Partial<CreateDatasetInput>;
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  try {
    const created = await createDataset(actorFromSession(session, "ui"), params.id, {
      kind: body.kind === "individual" ? "individual" : "aggregate",
      name: String(body.name ?? ""),
      description: body.description ?? null,
      templateId: body.templateId ?? null,
      ...(Array.isArray(body.columnSchema) ? { columnSchema: body.columnSchema } : {}),
      ...(Array.isArray(body.attrKeys) ? { attrKeys: body.attrKeys } : {}),
      acquisition: body.acquisition ?? null,
      ...(body.timeGranularity ? { timeGranularity: body.timeGranularity } : {}),
    });
    return NextResponse.json({ data: created, error: null }, { status: 201 });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
