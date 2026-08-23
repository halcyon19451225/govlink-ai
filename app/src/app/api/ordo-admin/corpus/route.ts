export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * コーパス行の一覧（検収用）— X3
 * GET ?kind=measures|evidence&status=pending|approved|rejected&limit=50
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const kind = req.nextUrl.searchParams.get("kind") === "evidence" ? "evidence" : "measures";
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = ["pending", "approved", "rejected"].includes(statusParam ?? "")
    ? statusParam
    : null;
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.round(rawLimit))) : 50;

  const table = kind === "evidence" ? "corpus_evidence" : "corpus_measures";
  const where = status ? `WHERE t.status = $2` : "";
  const params: unknown[] = status ? [limit, status] : [limit];

  try {
    // t.* と別名 created_at が重複するため、ORDER BY はテーブル修飾で曖昧さを解消する
    // （修飾なしだと PostgreSQL が「ORDER BY "created_at" is ambiguous」で落ちる）
    const rows = await query(
      `SELECT t.*, t.created_at::text AS created_at, t.updated_at::text AS updated_at,
              t.reviewed_at::text AS reviewed_at
       FROM ${table} t
       ${where}
       ORDER BY (t.status = 'pending') DESC, t.created_at DESC
       LIMIT $1`,
      params,
    );
    return NextResponse.json({ data: { kind, rows }, error: null });
  } catch (e) {
    // 典型: 040_corpus.sql 未実行で corpus_* テーブルが無い
    console.error("コーパス一覧の取得に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        data: null,
        error: `コーパス一覧の取得に失敗しました（詳細: ${detail}）。040_corpus.sql の実行状況とDB接続設定を確認してください`,
      },
      { status: 500 },
    );
  }
}
