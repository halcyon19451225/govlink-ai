export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

type Params = { params: { sourceId: string } };

function guard(session: Session | null) {
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  base_url: z.string().url().max(500).optional(),
  crawl_frequency: z.enum(["weekly", "monthly", "manual"]).optional(),
  license_note: z.string().max(1000).optional(),
  query_config: z.record(z.string(), z.unknown()).optional().nullable(),
  enabled: z.boolean().optional(),
  review_mode: z.enum(["full", "light", "spot"]).optional(),
});

/**
 * 収集ソースの更新・削除 — X7a
 * 有効化ガード: license_note（更新後の値）が空なら enabled=true にできない。
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const current = await queryOne<{ id: string; license_note: string; enabled: boolean }>(
    `SELECT id, license_note, enabled FROM corpus_sources WHERE id = $1`,
    [params.sourceId],
  );
  if (!current) {
    return NextResponse.json({ data: null, error: "ソースが見つかりません" }, { status: 404 });
  }

  const nextLicense = d.license_note !== undefined ? d.license_note : current.license_note;
  const nextEnabled = d.enabled !== undefined ? d.enabled : current.enabled;
  if (nextEnabled && !nextLicense.trim()) {
    return NextResponse.json(
      { data: null, error: "ライセンス・許諾の注記が空のソースは有効化できません" },
      { status: 400 },
    );
  }

  const row = await queryOne<{ id: string }>(
    `UPDATE corpus_sources SET
       name = COALESCE($2, name),
       base_url = COALESCE($3, base_url),
       crawl_frequency = COALESCE($4, crawl_frequency),
       license_note = COALESCE($5, license_note),
       query_config = CASE WHEN $6::boolean THEN $7::jsonb ELSE query_config END,
       enabled = COALESCE($8, enabled),
       review_mode = COALESCE($9, review_mode),
       updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      params.sourceId,
      d.name ?? null,
      d.base_url ?? null,
      d.crawl_frequency ?? null,
      d.license_note ?? null,
      d.query_config !== undefined,
      d.query_config != null ? JSON.stringify(d.query_config) : null,
      d.enabled ?? null,
      d.review_mode ?? null,
    ],
  );
  return NextResponse.json({ data: { id: row?.id ?? null }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  // run 履歴は ON DELETE CASCADE で消えるが、収集済みコーパス行は
  // harvest_run_id が SET NULL になるだけで残る（検収済み資産を失わない）
  const row = await queryOne<{ id: string }>(
    `DELETE FROM corpus_sources WHERE id = $1 RETURNING id`,
    [params.sourceId],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "ソースが見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: row.id }, error: null });
}
