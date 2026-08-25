export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

type Params = { params: { kind: string; rowId: string } };

/**
 * コーパス行の検収・整備 — X3 / X7c で context・reviewed_by・GET を追加
 * GET   … 1行の全項目＋接地使用回数＋収集run情報（重複比較・詳細ドロワー用）
 * PATCH { status?, field_category?, population_band?, review_note? }
 * - approved にすると参照対象（X4のコーパス接地の検索範囲）になる
 * - rejected は残す（同じ source_key の再供出時に上書き・再検収される）
 * - status 変更時は reviewed_by / reviewed_at を記録（X7c: 一括承認と同等の監査記録）
 * DELETE は提供しない（供出元のオプトアウトで一括削除される設計）
 */

function tableOf(kind: string): string | null {
  return kind === "evidence"
    ? "corpus_evidence"
    : kind === "measures"
      ? "corpus_measures"
      : kind === "context"
        ? "corpus_context"
        : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  const table = tableOf(params.kind);
  if (!table) {
    return NextResponse.json(
      { data: null, error: "kind は measures / evidence / context です" },
      { status: 400 },
    );
  }

  const row = await queryOne(
    `SELECT t.*, t.created_at::text AS created_at, t.reviewed_at::text AS reviewed_at
     FROM ${table} t WHERE t.id = $1`,
    [params.rowId],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "行が見つかりません" }, { status: 404 });
  }

  // 接地に使われた回数（ai_grounding_logs の配列参照。context は X7e で配線予定）
  let groundingUsed = 0;
  if (params.kind === "evidence" || params.kind === "measures") {
    const col = params.kind === "evidence" ? "corpus_evidence_ids" : "corpus_measure_ids";
    const g = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM ai_grounding_logs WHERE $1 = ANY(${col})`,
      [params.rowId],
    );
    groundingUsed = Number(g?.n ?? 0);
  }

  // 収集runへの逆リンク
  let harvestRun: unknown = null;
  const runId = (row as Record<string, unknown>)["harvest_run_id"];
  if (typeof runId === "string" && runId) {
    harvestRun = await queryOne(
      `SELECT r.id, r.status, r.started_at::text AS started_at, s.name AS source_name
       FROM corpus_harvest_runs r JOIN corpus_sources s ON s.id = r.source_id
       WHERE r.id = $1`,
      [runId],
    );
  }

  return NextResponse.json({
    data: { row, grounding_used: groundingUsed, harvest_run: harvestRun },
    error: null,
  });
}

const patchSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  field_category: z.string().max(60).nullable().optional(),
  population_band: z.string().max(20).nullable().optional(),
  review_note: z.string().max(1000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const table = tableOf(params.kind);
  if (!table) {
    return NextResponse.json(
      { data: null, error: "kind は measures / evidence / context です" },
      { status: 400 },
    );
  }

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
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const add = (col: string, v: unknown) => {
    values.push(v);
    sets.push(`${col} = $${values.length}`);
  };
  if (d.status !== undefined) {
    add("status", d.status);
    sets.push("reviewed_at = now()");
    add("reviewed_by", session.user?.email ?? ORDO_ADMIN_EMAIL);
  }
  if (d.field_category !== undefined) add("field_category", d.field_category);
  if (d.population_band !== undefined) add("population_band", d.population_band);
  if (d.review_note !== undefined) add("review_note", d.review_note);

  values.push(params.rowId);
  const row = await queryOne(
    `UPDATE ${table} SET ${sets.join(", ")}
     WHERE id = $${values.length}
     RETURNING id, status, field_category, population_band, review_note,
               reviewed_at::text, updated_at::text`,
    values,
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "行が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: row, error: null });
}
