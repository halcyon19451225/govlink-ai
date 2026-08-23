export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

type Params = { params: { kind: string; rowId: string } };

/**
 * コーパス行の検収・整備 — X3
 * PATCH { status?, field_category?, population_band?, review_note? }
 * - approved にすると参照対象（X4のコーパス接地の検索範囲）になる
 * - rejected は残す（同じ source_key の再供出時に上書き・再検収される）
 * DELETE は提供しない（供出元のオプトアウトで一括削除される設計）
 */

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

  const table =
    params.kind === "evidence"
      ? "corpus_evidence"
      : params.kind === "measures"
        ? "corpus_measures"
        : null;
  if (!table) {
    return NextResponse.json({ data: null, error: "kind は measures か evidence です" }, { status: 400 });
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
