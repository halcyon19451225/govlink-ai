export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * 収集履歴 — X7a
 * GET ?sourceId=&days=30&status=
 * 返り値: runs（明細ログ込み）＋ summary（30日サマリー: ヘッダ常置用）
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const sourceId = req.nextUrl.searchParams.get("sourceId");
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = ["running", "succeeded", "partial", "failed"].includes(statusParam ?? "")
    ? statusParam
    : null;
  const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.round(rawDays))) : 30;
  // lite=1: サマリーのみ（タブの⚠バッジ用の軽量呼び出し）
  const lite = req.nextUrl.searchParams.get("lite") === "1";

  try {
    const conds = [`r.started_at > now() - ($1 || ' days')::interval`];
    const params: unknown[] = [String(days)];
    if (sourceId) {
      params.push(sourceId);
      conds.push(`r.source_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conds.push(`r.status = $${params.length}`);
    }

    const runs = lite
      ? []
      : await query(
      `SELECT r.id, r.source_id, s.name AS source_name, r.trigger, r.status,
              r.started_at::text AS started_at, r.finished_at::text AS finished_at,
              r.pages_fetched, r.items_found, r.items_new, r.items_duplicate,
              r.items_rejected_by_sanitize, r.knowledge_docs_created,
              r.input_tokens::float, r.output_tokens::float, r.error_summary, r.log
       FROM corpus_harvest_runs r
       JOIN corpus_sources s ON s.id = r.source_id
       WHERE ${conds.join(" AND ")}
       ORDER BY r.started_at DESC
       LIMIT 200`,
      params,
    );

    // 30日サマリー（フィルタに依らず固定 — ヘッダ常置用）
    const summary = await queryOne<{
      total_new: string;
      failed_runs: string;
      input_tokens: string;
      output_tokens: string;
    }>(
      `SELECT COALESCE(sum(items_new), 0)::text AS total_new,
              count(*) FILTER (WHERE status = 'failed')::text AS failed_runs,
              COALESCE(sum(input_tokens), 0)::text AS input_tokens,
              COALESCE(sum(output_tokens), 0)::text AS output_tokens
       FROM corpus_harvest_runs
       WHERE started_at > now() - interval '30 days'`,
    );
    const pending = await queryOne<{ evidence: string; measures: string; context: string }>(
      `SELECT (SELECT count(*) FROM corpus_evidence WHERE status = 'pending')::text AS evidence,
              (SELECT count(*) FROM corpus_measures WHERE status = 'pending')::text AS measures,
              (SELECT count(*) FROM corpus_context  WHERE status = 'pending')::text AS context`,
    );

    return NextResponse.json({
      data: {
        runs,
        summary: {
          days: 30,
          total_new: Number(summary?.total_new ?? 0),
          failed_runs: Number(summary?.failed_runs ?? 0),
          input_tokens: Number(summary?.input_tokens ?? 0),
          output_tokens: Number(summary?.output_tokens ?? 0),
          pending_review: {
            evidence: Number(pending?.evidence ?? 0),
            measures: Number(pending?.measures ?? 0),
            context: Number(pending?.context ?? 0),
          },
        },
      },
      error: null,
    });
  } catch (e) {
    console.error("収集履歴の取得に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        data: null,
        error: `収集履歴の取得に失敗しました（詳細: ${detail}）。042_corpus_harvest.sql の実行状況を確認してください`,
      },
      { status: 500 },
    );
  }
}
