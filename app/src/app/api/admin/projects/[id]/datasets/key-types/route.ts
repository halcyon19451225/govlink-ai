export const dynamic = "force-dynamic";

/**
 * キー種別 — 庁内キーの語彙（どの業務システムのどの番号を仮名化の入力にするか）
 *
 * コアが持つのは正規化の「型」だけで、種別の実体は自治体が登録する。
 * コードは sid の導出に入るので、登録後は変えられない。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { datasetErrorResponse } from "@/lib/dataset/http";
import { actorFromSession, createKeyType, listKeyTypes, type KeyTypeInput } from "@/lib/dataset/service";
import { NORMALIZATION_STYLES } from "@/lib/dataset/keyTypes";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  const keyTypes = await listKeyTypes(session.user?.municipalityId ?? "");
  return NextResponse.json({ data: { keyTypes, styles: NORMALIZATION_STYLES }, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: KeyTypeInput;
  try {
    body = (await req.json()) as KeyTypeInput;
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  try {
    const saved = await createKeyType(actorFromSession(session, "ui"), params.id, body);
    return NextResponse.json({ data: saved, error: null }, { status: 201 });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
