export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

type Params = { params: { id: string; gapId: string } };

const patchSchema = z.object({
  indicator_name: z.string().min(1).optional(),
  indicator_unit: z.string().optional().nullable(),
  data_source: z.string().optional(),
  current_value: z.number().optional(),
  current_year: z.number().int().optional(),
  target_value: z.number().optional(),
  target_basis: z.string().optional(),
  affected_population: z.number().optional().nullable(),
  trend: z.enum(["improving", "worsening", "stable", "unknown"]).optional(),
  notes: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
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
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (d.indicator_name !== undefined) { fields.push(`indicator_name = $${idx++}`); values.push(d.indicator_name); }
  if (d.indicator_unit !== undefined) { fields.push(`indicator_unit = $${idx++}`); values.push(d.indicator_unit); }
  if (d.data_source !== undefined) { fields.push(`data_source = $${idx++}`); values.push(d.data_source); }
  if (d.current_value !== undefined) { fields.push(`current_value = $${idx++}`); values.push(d.current_value); }
  if (d.current_year !== undefined) { fields.push(`current_year = $${idx++}`); values.push(d.current_year); }
  if (d.target_value !== undefined) { fields.push(`target_value = $${idx++}`); values.push(d.target_value); }
  if (d.target_basis !== undefined) { fields.push(`target_basis = $${idx++}`); values.push(d.target_basis); }
  if (d.affected_population !== undefined) { fields.push(`affected_population = $${idx++}`); values.push(d.affected_population); }
  if (d.trend !== undefined) { fields.push(`trend = $${idx++}`); values.push(d.trend); }
  if (d.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(d.notes); }

  if (fields.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  fields.push(`updated_at = now()`);
  values.push(params.gapId, params.id);

  const row = await queryOne(
    `UPDATE gap_analyses SET ${fields.join(", ")}
     WHERE id = $${idx++} AND project_id = $${idx++}
     RETURNING id`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const row = await queryOne(
    "DELETE FROM gap_analyses WHERE id = $1 AND project_id = $2 RETURNING id",
    [params.gapId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: params.gapId }, error: null });
}
