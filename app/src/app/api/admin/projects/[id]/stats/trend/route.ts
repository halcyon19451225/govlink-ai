export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne, query } from "@/lib/db";
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
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
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

  // gap_analysis の成果物 ID を解決して artifact_id に設定（R2-5）
  const artifactRow = await query<{ id: string }>(
    `SELECT ma.id FROM module_artifacts ma
     JOIN gap_analyses ga ON ga.id = ma.artifact_record_id::uuid
     WHERE ma.project_id = $1 AND ma.module_id = 'gap_analysis'
       AND ga.indicator_name = $2
     ORDER BY ma.updated_at DESC LIMIT 1`,
    [params.id, indicator_name],
  );
  const resolvedArtifactId = artifactRow[0]?.id ?? null;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO statistical_analyses
       (project_id, artifact_id, module_id, analysis_type, indicator_name,
        input_data, parameters, results, calculation_steps,
        interpretation, caveats, is_ai_generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      params.id,
      resolvedArtifactId,
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
