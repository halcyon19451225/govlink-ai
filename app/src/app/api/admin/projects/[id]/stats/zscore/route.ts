export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { calcZScore } from "@/lib/stats/z-score";

type Params = { params: { id: string } };

const bodySchema = z.object({
  indicator_name: z.string().min(1),
  items: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ).min(1, "データが必要です"),
});

export async function POST(req: NextRequest, { params }: Params) {
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

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { indicator_name, items } = parsed.data;

  let result;
  try {
    result = calcZScore(items);
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "計算エラー" },
      { status: 400 },
    );
  }

  const { mean, stddev, calculationSteps } = result;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO statistical_analyses
       (project_id, artifact_id, module_id, analysis_type, indicator_name,
        input_data, parameters, results, calculation_steps,
        interpretation, caveats, is_ai_generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      params.id,
      null,
      "gap_analysis",
      "zscore",
      indicator_name,
      JSON.stringify({ items }),
      JSON.stringify({}),
      JSON.stringify(result),
      JSON.stringify(calculationSteps),
      calculationSteps.interpretation,
      null,
      false,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      results: { mean, stddev, items: result.items },
      calculationSteps,
    },
    error: null,
  });
}
