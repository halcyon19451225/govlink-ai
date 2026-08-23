export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * AIゲートウェイの利用状況（品質モニタの材料）— X1
 *
 * GET ?days=30 … 期間内のタスク別集計（呼び出し数・エラー数・トークン・
 *   平均レイテンシ・採択数）と日別推移を返す。
 *   Ordo運営画面（X5）のウェート判断に使う。
 *
 * 認可は routing と同じ2経路（Ordo管理者セッション or 共有鍵）。
 */

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const key = process.env.AI_ADMIN_API_KEY;
  if (key && req.headers.get("x-ai-admin-key") === key) return null;
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const deny = await authorize(req);
  if (deny) return deny;

  const raw = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.round(raw))) : 30;

  const [byTask, byDay] = await Promise.all([
    query(
      `SELECT task_type,
              provider,
              count(*)::int                                   AS calls,
              count(*) FILTER (WHERE status = 'error')::int   AS errors,
              COALESCE(sum(input_tokens), 0)::bigint          AS input_tokens,
              COALESCE(sum(output_tokens), 0)::bigint         AS output_tokens,
              COALESCE(round(avg(latency_ms)), 0)::int        AS avg_latency_ms,
              count(*) FILTER (WHERE adopted IS TRUE)::int    AS adopted,
              count(*) FILTER (WHERE adopted IS NOT NULL)::int AS adoption_judged
       FROM ai_usage_logs
       WHERE occurred_at >= now() - make_interval(days => $1)
       GROUP BY task_type, provider
       ORDER BY task_type, provider`,
      [days],
    ),
    query(
      `SELECT occurred_at::date::text AS day,
              count(*)::int           AS calls,
              count(*) FILTER (WHERE status = 'error')::int AS errors,
              COALESCE(sum(output_tokens), 0)::bigint       AS output_tokens
       FROM ai_usage_logs
       WHERE occurred_at >= now() - make_interval(days => $1)
       GROUP BY 1 ORDER BY 1`,
      [days],
    ),
  ]);

  return NextResponse.json({ data: { days, by_task: byTask, by_day: byDay }, error: null });
}
