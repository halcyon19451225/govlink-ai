export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { HARVEST_ADAPTER_KEYS } from "@/lib/corpus/harvest/adapters";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * 収集ソースのレジストリ — X7a
 * GET  … ソース一覧（直近runの成績つき）
 * POST … ソース追加
 *
 * ガード: license_note が空のソースは有効化できない
 * （許諾・利用規約の確認が最終防衛線 — 設計 §3-1）。
 */

function guard(session: Session | null) {
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  try {
    const rows = await query(
      `SELECT s.id, s.name, s.kind, s.base_url, s.adapter, s.crawl_frequency,
              s.license_note, s.query_config, s.enabled, s.review_mode,
              s.last_crawled_at::text AS last_crawled_at,
              s.created_at::text AS created_at,
              (SELECT row_to_json(r) FROM (
                 SELECT hr.id, hr.status, hr.trigger,
                        hr.started_at::text AS started_at,
                        hr.finished_at::text AS finished_at,
                        hr.items_found, hr.items_new, hr.items_duplicate,
                        hr.items_rejected_by_sanitize, hr.error_summary
                 FROM corpus_harvest_runs hr
                 WHERE hr.source_id = s.id
                 ORDER BY hr.started_at DESC LIMIT 1
               ) r) AS last_run
       FROM corpus_sources s
       ORDER BY s.name`,
    );
    return NextResponse.json({ data: rows, error: null });
  } catch (e) {
    console.error("収集ソース一覧の取得に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        data: null,
        error: `収集ソース一覧の取得に失敗しました（詳細: ${detail}）。042_corpus_harvest.sql の実行状況を確認してください`,
      },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["structured_db", "pdf_repository", "press"]),
  base_url: z.string().url().max(500),
  adapter: z.string().min(1).max(60),
  crawl_frequency: z.enum(["weekly", "monthly", "manual"]).default("manual"),
  license_note: z.string().max(1000).default(""),
  query_config: z.record(z.string(), z.unknown()).optional().nullable(),
  enabled: z.boolean().default(false),
  review_mode: z.enum(["full", "light", "spot"]).default("full"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  if (!HARVEST_ADAPTER_KEYS.includes(d.adapter)) {
    return NextResponse.json(
      { data: null, error: `未実装のアダプタです: ${d.adapter}（実装済み: ${HARVEST_ADAPTER_KEYS.join(", ")}）` },
      { status: 400 },
    );
  }
  if (d.enabled && !d.license_note.trim()) {
    return NextResponse.json(
      { data: null, error: "ライセンス・許諾の注記が空のソースは有効化できません" },
      { status: 400 },
    );
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO corpus_sources (name, kind, base_url, adapter, crawl_frequency, license_note, query_config, enabled, review_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     RETURNING id`,
    [
      d.name,
      d.kind,
      d.base_url,
      d.adapter,
      d.crawl_frequency,
      d.license_note,
      d.query_config ? JSON.stringify(d.query_config) : null,
      d.enabled,
      d.review_mode,
    ],
  );
  return NextResponse.json({ data: { id: row?.id ?? null }, error: null });
}
