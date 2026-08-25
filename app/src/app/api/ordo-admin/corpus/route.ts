export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * コーパス行の一覧（検収用）— X3 / X7c で絞り込みと context を追加
 * GET ?kind=measures|evidence|context&status=pending|approved|rejected&limit=50
 *     &sourceId=<収集ソース> &level=<1-5・evidenceのみ> &category=<分野・部分一致>
 *     &dupOnly=1（重複疑いのみ） &harvestRunId=<収集回>
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const kindParam = p.get("kind");
  const kind = kindParam === "evidence" ? "evidence" : kindParam === "context" ? "context" : "measures";
  const table =
    kind === "evidence" ? "corpus_evidence" : kind === "context" ? "corpus_context" : "corpus_measures";

  const statusParam = p.get("status");
  const status = ["pending", "approved", "rejected"].includes(statusParam ?? "") ? statusParam : null;
  const rawLimit = Number(p.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.round(rawLimit))) : 50;

  const conds: string[] = [];
  const params: unknown[] = [limit];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    conds.push(cond.replaceAll("$N", `$${params.length}`));
  };

  if (status) add("t.status = $N", status);
  if (p.get("dupOnly") === "1") conds.push("t.dup_of IS NOT NULL");
  const category = p.get("category")?.trim();
  if (category) add("t.field_category ILIKE '%' || $N || '%'", category);
  const level = Number(p.get("level"));
  if (kind === "evidence" && Number.isFinite(level) && level >= 1 && level <= 5) {
    add("t.evidence_level = $N", Math.round(level));
  }
  const harvestRunId = p.get("harvestRunId");
  if (harvestRunId) add("t.harvest_run_id = $N", harvestRunId);
  const sourceId = p.get("sourceId");
  if (sourceId) {
    add(
      "t.harvest_run_id IN (SELECT id FROM corpus_harvest_runs WHERE source_id = $N)",
      sourceId,
    );
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

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
    // 典型: 040/042 未実行で corpus_* テーブルが無い
    console.error("コーパス一覧の取得に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        data: null,
        error: `コーパス一覧の取得に失敗しました（詳細: ${detail}）。040/042/043 のマイグレーション実行状況とDB接続設定を確認してください`,
      },
      { status: 500 },
    );
  }
}
