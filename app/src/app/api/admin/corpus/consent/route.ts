export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * 自分の自治体のコーパス同意状態 — X3
 * 施策一覧の「コーパスへ供出」ボタンの表示可否に使う。
 * 同意の設定そのものは契約に基づき Ordo 運営側（/ordo-admin/corpus）が行う。
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const municipalityId = session?.user?.municipalityId;
  if (!session || !municipalityId) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  try {
    const row = await queryOne<{ opted_in: boolean; note: string | null }>(
      "SELECT opted_in, note FROM corpus_consents WHERE municipality_id = $1",
      [municipalityId],
    );

    return NextResponse.json({
      data: { opted_in: row?.opted_in === true },
      error: null,
    });
  } catch (e) {
    // 040 未実行時もボタン非表示（opted_in=false 扱い）で画面を壊さない
    console.warn("コーパス同意の照会に失敗:", e);
    return NextResponse.json({ data: { opted_in: false }, error: null });
  }
}
