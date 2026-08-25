export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import {
  pickDueSource,
  countDueSources,
  countPendingReview,
  runHarvest,
  REVIEW_BACKLOG_LIMIT,
} from "@/lib/corpus/harvest/engine";

/**
 * 自律コーパス収集の cron 入口 — X7a
 *
 * EventBridge Scheduler → Lambda（fetch POST）→ このルート。
 * 認証: ヘッダ x-cron-key = env CORPUS_CRON_KEY（LICENSE_API_KEY と同じ共有鍵方式）。
 *
 * 1回の呼び出しで「期限が来た enabled ソースを1つだけ」処理して返す
 * （Amplify のAPIタイムアウト対策）。応答の remaining > 0 なら Lambda 側で
 * 再呼び出しする（最大N回は Lambda 側で制御）。
 *
 * 検収残が REVIEW_BACKLOG_LIMIT（2,000件）を超えている間はスケジュール収集を
 * 一時停止する（溜めすぎ防止 — 設計 §3-4。手動実行は可能なまま）。
 */
export async function POST(req: NextRequest) {
  const configured = process.env.CORPUS_CRON_KEY;
  if (!configured) {
    return NextResponse.json(
      { data: null, error: "CORPUS_CRON_KEY が設定されていません" },
      { status: 500 },
    );
  }
  const key = req.headers.get("x-cron-key");
  if (key !== configured) {
    return NextResponse.json({ data: null, error: "認証に失敗しました" }, { status: 401 });
  }

  try {
    const backlog = await countPendingReview();
    if (backlog > REVIEW_BACKLOG_LIMIT) {
      return NextResponse.json({
        data: {
          processed: null,
          remaining: 0,
          skipped: `検収待ちが${backlog}件（上限${REVIEW_BACKLOG_LIMIT}件）のため巡回を一時停止しています。検収を進めてください`,
        },
        error: null,
      });
    }

    const due = await pickDueSource();
    if (!due) {
      return NextResponse.json({ data: { processed: null, remaining: 0 }, error: null });
    }

    const summary = await runHarvest(due.id, "scheduled");
    const remaining = await countDueSources();
    return NextResponse.json({ data: { processed: summary, remaining }, error: null });
  } catch (e) {
    console.error("コーパス収集(cron)に失敗:", e);
    return NextResponse.json(
      { data: null, error: e instanceof Error ? e.message : "収集に失敗しました" },
      { status: 500 },
    );
  }
}
