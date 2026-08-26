export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadManual } from "@/lib/manual/loader";
import { isValidTopicId, topicOf, CONVENTIONS_ID } from "@/lib/manual/topics";

type Params = { params: { topicId: string } };

/** マニュアル本文の取得（M1）— HelpButton のドロワーが使う。ログイン必須 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }
  if (!isValidTopicId(params.topicId)) {
    return NextResponse.json({ data: null, error: "not found" }, { status: 404 });
  }
  const manual = await loadManual(params.topicId);
  const topic = topicOf(params.topicId);
  const fallbackTitle =
    params.topicId === CONVENTIONS_ID ? "図の読み方" : topic?.label ?? params.topicId;
  return NextResponse.json({
    data: {
      id: params.topicId,
      title: manual?.meta?.title || fallbackTitle,
      updated: manual?.meta?.updated ?? "",
      body: manual?.body ?? "",
      exists: manual != null,
    },
    error: null,
  });
}
