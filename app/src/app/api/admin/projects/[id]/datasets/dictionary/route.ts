export const dynamic = "force-dynamic";

/**
 * 属性辞書 — その計画で使える属性の一覧と、自治体ごとの追加
 *
 * 辞書は3層（コア／分野パック／テナント拡張）を DB で重ねたもの。
 * **分野を固定しないため、画面はコード上の定数ではなくここから取る。**
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { queryOne } from "@/lib/db";
import { datasetErrorResponse } from "@/lib/dataset/http";
import { actorFromSession, resolveDictionary, upsertTenantAttribute, type TenantAttributeInput } from "@/lib/dataset/service";
import { packFor } from "@/lib/dataset/domains";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  const project = await queryOne<{ plan_type: string | null }>(`SELECT plan_type FROM projects WHERE id = $1`, [params.id]);
  const attributes = await resolveDictionary(params.id, session.user?.municipalityId ?? "");
  const pack = packFor(project?.plan_type);
  return NextResponse.json({
    data: {
      attributes,
      planType: project?.plan_type ?? null,
      domain: pack ? { planType: pack.planType, label: pack.label, reviewed: pack.reviewed } : null,
    },
    error: null,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: TenantAttributeInput;
  try {
    body = (await req.json()) as TenantAttributeInput;
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  try {
    const saved = await upsertTenantAttribute(actorFromSession(session, "ui"), params.id, body);
    return NextResponse.json({ data: saved, error: null }, { status: 201 });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
