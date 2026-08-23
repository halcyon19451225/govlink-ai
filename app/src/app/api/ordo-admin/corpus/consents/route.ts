export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { contributorKeyOf, deleteContributions } from "@/lib/corpus/server";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * コーパス同意（オプトイン）の管理 — X3
 *
 * GET … 全自治体と同意状態・供出済み件数
 * PUT … { municipality_id, opted_in, note? }
 *   - オプトイン: 契約・覚書に基づき運営が設定する（note に契約根拠を残す）
 *   - **オプトアウト: 当該自治体の供出済みコーパス行をすべて削除する**
 *     （自治体のデータは自治体のもの。同意が無くなれば横断利用も止める）
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
    const rows = await query<{
      id: string;
      name: string;
      opted_in: boolean | null;
      note: string | null;
      decided_by: string | null;
      updated_at: string | null;
    }>(
      `SELECT m.id, m.name, c.opted_in, c.note, c.decided_by, c.updated_at::text
       FROM municipalities m
       LEFT JOIN corpus_consents c ON c.municipality_id = m.id
       ORDER BY m.name`,
    );

    // 供出済み件数（contributor_key 単位で集計してから対応付け）
    const counts = await query<{ contributor_key: string; measures: number; evidence: number }>(
      `SELECT k.contributor_key,
              COALESCE(mc.n, 0)::int AS measures,
              COALESCE(ec.n, 0)::int AS evidence
       FROM (
         SELECT contributor_key FROM corpus_measures WHERE contributor_key IS NOT NULL
         UNION
         SELECT contributor_key FROM corpus_evidence WHERE contributor_key IS NOT NULL
       ) k
       LEFT JOIN (SELECT contributor_key, count(*) AS n FROM corpus_measures GROUP BY 1) mc
         ON mc.contributor_key = k.contributor_key
       LEFT JOIN (SELECT contributor_key, count(*) AS n FROM corpus_evidence GROUP BY 1) ec
         ON ec.contributor_key = k.contributor_key`,
    );
    const countByKey = new Map(counts.map((c) => [c.contributor_key, c]));

    const data = rows.map((r) => {
      const key = contributorKeyOf(r.id);
      const c = countByKey.get(key);
      return {
        municipality_id: r.id,
        name: r.name,
        opted_in: r.opted_in === true,
        note: r.note,
        decided_by: r.decided_by,
        updated_at: r.updated_at,
        contributed_measures: c?.measures ?? 0,
        contributed_evidence: c?.evidence ?? 0,
      };
    });

    return NextResponse.json({ data, error: null });
  } catch (e) {
    // 典型: 040_corpus.sql 未実行で corpus_consents 等が無い
    console.error("同意一覧の取得に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        data: null,
        error: `同意一覧の取得に失敗しました（詳細: ${detail}）。040_corpus.sql の実行状況とDB接続設定を確認してください`,
      },
      { status: 500 },
    );
  }
}

const putSchema = z.object({
  municipality_id: z.string().uuid(),
  opted_in: z.boolean(),
  note: z.string().max(400).nullable().optional(),
});

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  try {
    const exists = await queryOne<{ id: string }>(
      "SELECT id FROM municipalities WHERE id = $1",
      [parsed.data.municipality_id],
    );
    if (!exists) {
      return NextResponse.json({ data: null, error: "自治体が見つかりません" }, { status: 404 });
    }

    await queryOne(
      `INSERT INTO corpus_consents (municipality_id, opted_in, note, decided_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (municipality_id) DO UPDATE SET
         opted_in = EXCLUDED.opted_in,
         note = EXCLUDED.note,
         decided_by = EXCLUDED.decided_by,
         updated_at = now()
       RETURNING municipality_id`,
      [
        parsed.data.municipality_id,
        parsed.data.opted_in,
        parsed.data.note ?? null,
        session?.user?.email ?? null,
      ],
    );

    // オプトアウト → 供出済みデータの一括削除
    let removed: { measures: number; evidence: number } | null = null;
    if (!parsed.data.opted_in) {
      removed = await deleteContributions(parsed.data.municipality_id);
    }

    return NextResponse.json({
      data: { opted_in: parsed.data.opted_in, removed },
      error: null,
    });
  } catch (e) {
    console.error("同意の更新に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { data: null, error: `同意の更新に失敗しました（詳細: ${detail}）` },
      { status: 500 },
    );
  }
}
