export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { SPOT_SAMPLE_RATE } from "@/lib/corpus/harvest/types";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * 一括検収 — X7c §3-2・§3-4
 *
 * POST { kind, action: approve|reject, note?, ids? | harvest_run_id? }
 *  - 1トランザクション。既存PATCHと同じ状態遷移を1件ずつ適用する
 *  - **pending 以外の行は絶対に触らない**（WHERE status='pending'。触れなかった行は skipped で返す）
 *  - 一括でも reviewed_by / reviewed_at を1件ずつ記録（監査可能性は個別承認と同等）
 *  - harvest_run_id 指定は light/spot のまとめ承認用（その収集回の pending 全行が対象）
 *
 * GET ?kind=&harvest_run_id=  … まとめ承認のプレビュー
 *  - 対象件数・サンプル10件・欠損サマリー（light の確認材料）・spot用ランダム10%サンプル
 */

const TABLES: Record<string, string> = {
  measures: "corpus_measures",
  evidence: "corpus_evidence",
  context: "corpus_context",
};

function guard(session: Session | null): NextResponse | null {
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
}

const bodySchema = z
  .object({
    kind: z.enum(["measures", "evidence", "context"]),
    action: z.enum(["approve", "reject"]),
    note: z.string().max(1000).optional().nullable(),
    ids: z.array(z.string().uuid()).min(1).max(500).optional(),
    harvest_run_id: z.string().uuid().optional(),
  })
  .refine((d) => (d.ids != null) !== (d.harvest_run_id != null), {
    message: "ids か harvest_run_id のどちらか一方を指定してください",
  });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;
  const reviewer = session?.user?.email ?? ORDO_ADMIN_EMAIL;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const table = TABLES[d.kind];
  const status = d.action === "approve" ? "approved" : "rejected";
  const note = d.note?.trim() || null;

  try {
    const result = await transaction(async (client) => {
      // 対象 pending 行を確定（FOR UPDATE — 一括操作中の競合を防ぐ）
      const targets = d.ids
        ? await client.query<{ id: string }>(
            `SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) AND status = 'pending' FOR UPDATE`,
            [d.ids],
          )
        : await client.query<{ id: string }>(
            `SELECT id FROM ${table} WHERE harvest_run_id = $1 AND status = 'pending' FOR UPDATE`,
            [d.harvest_run_id],
          );
      const targetIds = targets.rows.map((r) => r.id);
      const requested = d.ids ? d.ids.length : targetIds.length;

      let updated = 0;
      // 既存PATCHと同じ規則を1件ずつ適用（検収メモは共通値を全行に）
      for (const id of targetIds) {
        const res = await client.query(
          `UPDATE ${table}
           SET status = $1,
               review_note = COALESCE($2, review_note),
               reviewed_at = now(),
               reviewed_by = $3,
               updated_at = now()
           WHERE id = $4 AND status = 'pending'`,
          [status, note, reviewer, id],
        );
        updated += res.rowCount ?? 0;
      }
      return { updated, skipped: requested - updated };
    });

    return NextResponse.json({ data: result, error: null });
  } catch (e) {
    console.error("一括検収に失敗:", e);
    return NextResponse.json(
      { data: null, error: "一括検収に失敗しました（トランザクションは巻き戻されています）" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  const kind = req.nextUrl.searchParams.get("kind") ?? "evidence";
  const table = TABLES[kind];
  const runId = req.nextUrl.searchParams.get("harvest_run_id");
  if (!table || !runId) {
    return NextResponse.json(
      { data: null, error: "kind と harvest_run_id を指定してください" },
      { status: 400 },
    );
  }

  try {
    const totalRow = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE harvest_run_id = $1 AND status = 'pending'`,
      [runId],
    );
    const total = Number(totalRow?.n ?? 0);

    // サンプル: light は先頭10件、spot はランダム10%（最低1件・最大30件）
    const spotN = Math.min(30, Math.max(1, Math.ceil(total * SPOT_SAMPLE_RATE)));
    const sample = await query(
      `SELECT t.*, t.created_at::text AS created_at
       FROM ${table} t
       WHERE t.harvest_run_id = $1 AND t.status = 'pending'
       ORDER BY t.created_at LIMIT 10`,
      [runId],
    );
    const spotSample = await query(
      `SELECT t.*, t.created_at::text AS created_at
       FROM ${table} t
       WHERE t.harvest_run_id = $1 AND t.status = 'pending'
       ORDER BY random() LIMIT $2`,
      [runId, spotN],
    );

    // 欠損サマリー（light の確認材料。テーブルにより見る欄が違う）
    const missing =
      kind === "evidence"
        ? await queryOne(
            `SELECT
               count(*) FILTER (WHERE source IS NULL OR source = '')::int AS no_source,
               count(*) FILTER (WHERE url IS NULL)::int AS no_url,
               count(*) FILTER (WHERE year IS NULL)::int AS no_year,
               count(*) FILTER (WHERE effect_size_value IS NULL)::int AS no_effect_size,
               count(*) FILTER (WHERE field_category IS NULL)::int AS no_category,
               count(*) FILTER (WHERE dup_of IS NOT NULL)::int AS dup_suspects
             FROM corpus_evidence WHERE harvest_run_id = $1 AND status = 'pending'`,
            [runId],
          )
        : kind === "context"
          ? await queryOne(
              `SELECT
                 count(*) FILTER (WHERE source_url IS NULL)::int AS no_url,
                 count(*) FILTER (WHERE region_code IS NULL AND region_scope <> 'national')::int AS no_region_code,
                 count(*) FILTER (WHERE field_category IS NULL)::int AS no_category,
                 count(*) FILTER (WHERE dup_of IS NOT NULL)::int AS dup_suspects
               FROM corpus_context WHERE harvest_run_id = $1 AND status = 'pending'`,
              [runId],
            )
          : await queryOne(
              `SELECT
                 count(*) FILTER (WHERE source_note IS NULL)::int AS no_source,
                 count(*) FILTER (WHERE field_category IS NULL)::int AS no_category,
                 count(*) FILTER (WHERE dup_of IS NOT NULL)::int AS dup_suspects
               FROM corpus_measures WHERE harvest_run_id = $1 AND status = 'pending'`,
              [runId],
            );

    return NextResponse.json({
      data: { total, sample, spot_sample: spotSample, missing },
      error: null,
    });
  } catch (e) {
    console.error("一括検収プレビューの取得に失敗:", e);
    return NextResponse.json(
      { data: null, error: "プレビューの取得に失敗しました" },
      { status: 500 },
    );
  }
}
