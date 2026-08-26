export const dynamic = "force-dynamic";

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

/**
 * ICSフィードトークンの管理（S1 D②段1）
 * GET  … 一覧（有効・失効とも。画面は有効分を表示）
 * POST … 発行 {label} — トークンはサーバーで生成（crypto.randomBytes 24byte → base64url）
 * 失効は [tokenId]/route.ts の DELETE
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }
  const rows = await query(
    `SELECT id, label, token, created_at::text AS created_at, revoked_at::text AS revoked_at
     FROM schedule_feed_tokens
     WHERE project_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [params.id],
  );
  return NextResponse.json({ data: rows, error: null });
}

const postSchema = z.object({
  label: z.string().max(100).optional().default(""),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    /* 空ボディ可 */
  }
  const parsed = postSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "入力が不正です" }, { status: 400 });
  }

  // 発行数の上限（配りっぱなし防止の緩い安全弁）
  const activeCount = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM schedule_feed_tokens
     WHERE project_id = $1 AND revoked_at IS NULL`,
    [params.id],
  );
  if ((activeCount?.n ?? 0) >= 20) {
    return NextResponse.json(
      { data: null, error: "有効なフィードが20件あります。不要なものを失効してから発行してください" },
      { status: 400 },
    );
  }

  const token = randomBytes(24).toString("base64url");
  const row = await queryOne(
    `INSERT INTO schedule_feed_tokens (project_id, label, token, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, label, token, created_at::text AS created_at, revoked_at::text AS revoked_at`,
    [params.id, parsed.data.label.trim(), token, session.user?.email ?? null],
  );
  return NextResponse.json({ data: row, error: null });
}
