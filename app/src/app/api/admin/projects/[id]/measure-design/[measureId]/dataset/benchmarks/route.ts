export const dynamic = "force-dynamic";

/**
 * ベンチマーク（measure_indicator_benchmarks — 058）。図7 工程3-2 の比較先。
 * 出典（source_name）必須の手入力。自動取得は将来のアダプタに委ねる（設計 §2-6）。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import type { IndicatorBenchmarkRow } from "@/lib/measure/results";

type Params = { params: { id: string; measureId: string } };

const COLS = `b.id, b.measure_indicator_id, b.comparator, b.value::float AS value,
       b.fiscal_year, b.source_name, b.source_url, b.note`;

async function indicatorOf(projectId: string, measureId: string, indicatorId: string) {
  return queryOne<{ id: string }>(
    `SELECT id FROM measure_indicators
      WHERE id = $1 AND project_id = $2 AND measure_design_id = $3`,
    [indicatorId, projectId, measureId],
  );
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const rows = await query<IndicatorBenchmarkRow>(
    `SELECT ${COLS}
       FROM measure_indicator_benchmarks b
       JOIN measure_indicators i ON i.id = b.measure_indicator_id
      WHERE i.project_id = $1 AND i.measure_design_id = $2
      ORDER BY b.comparator, b.fiscal_year`,
    [params.id, params.measureId],
  );
  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  measure_indicator_id: z.string().uuid(),
  comparator: z.string().min(1).max(100),
  value: z.number().finite(),
  fiscal_year: z.number().int().min(1989).max(2200).nullish(),
  source_name: z.string().min(1).max(300), // 出典必須
  source_url: z.string().url().max(1000).nullish(),
  note: z.string().max(1000).nullish(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: "入力の形式が不正です（比較先・値・出典は必須）" },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const ind = await indicatorOf(params.id, params.measureId, d.measure_indicator_id);
  if (!ind) {
    return NextResponse.json({ data: null, error: "指標が見つかりません" }, { status: 404 });
  }

  const rows = await query<IndicatorBenchmarkRow>(
    `INSERT INTO measure_indicator_benchmarks
       (measure_indicator_id, comparator, value, fiscal_year, source_name, source_url, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLS.replaceAll("b.", "")}`,
    [
      d.measure_indicator_id,
      d.comparator,
      d.value,
      d.fiscal_year ?? null,
      d.source_name,
      d.source_url ?? null,
      d.note ?? null,
    ],
  );
  return NextResponse.json({ data: rows[0], error: null });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ data: null, error: "id を指定してください" }, { status: 400 });
  }
  const rows = await query<{ id: string }>(
    `DELETE FROM measure_indicator_benchmarks b
      WHERE b.id = $1
        AND b.measure_indicator_id IN (
              SELECT id FROM measure_indicators
               WHERE project_id = $2 AND measure_design_id = $3)
      RETURNING b.id`,
    [id, params.id, params.measureId],
  );
  if (!rows[0]) {
    return NextResponse.json({ data: null, error: "対象が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: rows[0].id }, error: null });
}
