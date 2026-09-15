export const dynamic = "force-dynamic";

/**
 * 設定パックの書き出し — 庁内の変換ツールに持っていくファイル
 *
 * 設計: claude/coe-dataset-model.md §6-4・§8
 *
 * 変換ツールは庁内で動き、Coe には繋がらない。それでも辞書・キー種別・
 * 粗化のはしご・k/ℓ は Coe の正本と同じでなければならないので、
 * **正本を書き出して人が持っていく**。
 *
 * 鍵は入らない（Coe は鍵を持たない）。個人を特定しうる値も入らない。
 * ダウンロードは activity_log に残る（どの版の決めごとで変換したかを追うため）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { datasetErrorResponse } from "@/lib/dataset/http";
import { actorFromSession, buildProjectConfigPack } from "@/lib/dataset/service";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  // 変換ツールを動かすのは箱を作れる人と同じ範囲にする（閲覧だけの人には出さない）
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  try {
    const pack = await buildProjectConfigPack(
      actorFromSession(session, "ui"),
      params.id,
      session.user?.municipalityId ?? "",
    );
    const name = `coe-config-${pack.project.id}-d${pack.dictionary.version}.json`;
    return new NextResponse(JSON.stringify(pack, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return datasetErrorResponse(err);
  }
}
