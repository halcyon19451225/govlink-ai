export const dynamic = "force-dynamic";

/** その版で上げたファイルをそのまま返す（ダウンロードは操作履歴に残る） */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession, downloadVersion } from "@/lib/dataset/service";
import { datasetErrorResponse } from "@/lib/dataset/http";

type Params = { params: { id: string; datasetId: string; versionId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  try {
    const { fileName, bytes } = await downloadVersion(actorFromSession(session, "ui"), params.id, params.datasetId, params.versionId);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
