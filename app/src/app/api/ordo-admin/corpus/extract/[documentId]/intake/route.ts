export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { sanitizeExtractionProposals } from "@/lib/corpus/types";
import { upsertCorpusMeasure, upsertCorpusEvidence } from "@/lib/corpus/server";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

type Params = { params: { documentId: string } };

/**
 * 抽出提案の取り込み／破棄 — X3
 *
 * POST body:
 *   { action: "intake", extraction_id, measures: [...], evidence: [...] }
 *     — 担当者が確認・修正した内容をコーパスへ取り込む。
 *       運営担当者自身が確認したので status='approved' で入る
 *       （Tier1由来・contributor_key は NULL）
 *   { action: "dismiss", extraction_id }
 *     — 提案を破棄する（コーパスには何も入らない）
 */

const bodySchema = z.object({
  action: z.enum(["intake", "dismiss"]),
  extraction_id: z.string().uuid(),
  measures: z.array(z.record(z.string(), z.unknown())).optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

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

  const extraction = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM knowledge_extractions
     WHERE id = $1 AND document_id = $2`,
    [parsed.data.extraction_id, params.documentId],
  );
  if (!extraction) {
    return NextResponse.json({ data: null, error: "抽出が見つかりません" }, { status: 404 });
  }
  if (extraction.status !== "proposed") {
    return NextResponse.json(
      { data: null, error: "この抽出はすでに処理済みです（再抽出してください）" },
      { status: 422 },
    );
  }

  const email = session.user?.email ?? null;

  if (parsed.data.action === "dismiss") {
    await queryOne(
      `UPDATE knowledge_extractions
       SET status = 'dismissed', decided_by = $1, decided_at = now()
       WHERE id = $2 RETURNING id`,
      [email, extraction.id],
    );
    return NextResponse.json({ data: { dismissed: true }, error: null });
  }

  // 担当者が確認・修正した内容を再サニタイズして取り込む
  const confirmed = sanitizeExtractionProposals({
    measures: parsed.data.measures ?? [],
    evidence: parsed.data.evidence ?? [],
  });

  let measureCount = 0;
  for (let i = 0; i < confirmed.measures.length; i++) {
    const m = confirmed.measures[i];
    if (!m) continue;
    const id = await upsertCorpusMeasure(m, {
      source_kind: "knowledge_extract",
      source_key: `kx:${extraction.id}:m:${i}`,
      contributor_key: null, // Tier1（公開資料）由来
      status: "approved", // 運営担当者が今まさに確認した＝検収済み
    });
    if (id) measureCount++;
  }

  let evidenceCount = 0;
  for (let i = 0; i < confirmed.evidence.length; i++) {
    const e = confirmed.evidence[i];
    if (!e) continue;
    const id = await upsertCorpusEvidence(e, {
      source_kind: "knowledge_extract",
      source_key: `kx:${extraction.id}:e:${i}`,
      contributor_key: null,
      status: "approved",
    });
    if (id) evidenceCount++;
  }

  await queryOne(
    `UPDATE knowledge_extractions
     SET status = 'intaken', decided_by = $1, decided_at = now(),
         intake_result = $2::jsonb
     WHERE id = $3 RETURNING id`,
    [email, JSON.stringify({ measures: measureCount, evidence: evidenceCount }), extraction.id],
  );

  return NextResponse.json({
    data: { intaken: true, measures: measureCount, evidence: evidenceCount },
    error: null,
  });
}
