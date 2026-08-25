export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { runHarvest } from "@/lib/corpus/harvest/engine";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * 収集の手動実行（「今すぐ収集」）— X7a
 * 管理者セッション認可（cron鍵は不要 — 設計 §2）。
 * スケジュールの期限に関係なく実行できるが、enabled=false のソースは
 * エンジン側が拒否する（ライセンス確認が最終防衛線）。
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = z.object({ source_id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "source_id が不正です" }, { status: 400 });
  }

  try {
    const summary = await runHarvest(parsed.data.source_id, "manual");
    return NextResponse.json({ data: summary, error: null });
  } catch (e) {
    console.error("コーパス収集(手動)に失敗:", e);
    return NextResponse.json(
      { data: null, error: e instanceof Error ? e.message : "収集に失敗しました" },
      { status: 500 },
    );
  }
}
