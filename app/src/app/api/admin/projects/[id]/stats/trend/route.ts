export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { calcTrendRegression } from "@/lib/stats/trend-regression";

type Params = { params: { id: string } };

const bodySchema = z.object({
  indicator_name: z.string().min(1),
  data_points: z.array(
    z.object({
      year: z.number().int(),
      value: z.number(),
    }),
  ).min(2, "データポイントは2件以上必要です"),
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

  const { indicator_name, data_points } = parsed.data;

  let result;
  try {
    result = calcTrendRegression(data_points);
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "計算エラー" },
      { status: 400 },
    );
  }

  const { slope, intercept, rSquared, forecast, calculationSteps } = result;

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
      "trend_regression",
      indicator_name,
      JSON.stringify({ data_points }),
      JSON.stringify({}),
      JSON.stringify({ slope, intercept, rSquared, forecast }),
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
      results: { slope, intercept, rSquared, forecast },
      calculationSteps,
    },
    error: null,
  });
}
