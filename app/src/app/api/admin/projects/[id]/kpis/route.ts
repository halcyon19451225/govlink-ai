export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { inferTierFromHorizon } from "@/lib/outcome/tiers";

const achievementConditionEnum = z.enum(["lte", "lt", "gte", "gt", "eq"]);

const postSchema = z.object({
  label:                 z.string().min(1, "指標名は必須です"),
  target:                z.union([z.number(), z.string()]).transform((v) => Number(v)),
  unit:                  z.string().default(""),
  goal_id:               z.string().nullable().optional(),
  // 未指定なら target_deadline から推定する（既定値の固定が誤分類の原因だった）
  indicator_type:        z.enum(["process","outcome_initial","outcome_mid","outcome_intermediate","outcome_long","efficiency"]).optional(),
  previous_value:        z.number().nullable().optional(),
  achievement_condition: achievementConditionEnum.nullable().optional(),
  target_deadline:       z.string().nullable().optional(), // "YYYY-MM-DD"
  // 029: 到達度の起点と、三層アウトカムの連鎖
  baseline_value:        z.union([z.number(), z.string()]).transform((v) => Number(v)).nullable().optional(),
  baseline_year:         z.number().int().nullable().optional(),
  contributes_to_kpi_id: z.string().uuid().nullable().optional(),
});

// GET: 全KPI一覧
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const kpis = await query(
    `SELECT id, label, target::float, current::float, unit,
            goal_id, indicator_type, previous_value::float,
            achievement_condition,
            baseline_value::float AS baseline_value, baseline_year,
            contributes_to_kpi_id,
            to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline,
            created_at
     FROM kpis WHERE project_id = $1 ORDER BY created_at`,
    [params.id]
  );
  return NextResponse.json({ data: kpis, error: null });
}

// POST: KPIを追加
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "バリデーションエラー" }, { status: 422 });
  }

  const { label, target, unit, goal_id, previous_value,
          achievement_condition, target_deadline,
          baseline_value, baseline_year, contributes_to_kpi_id } = parsed.data;

  // 指標タイプが明示されていなければ、計画開始日と目標期限から評価スパンを推定する。
  // 推定できない（期限未設定など）場合のみ短期を既定とする。
  let indicator_type = parsed.data.indicator_type;
  if (!indicator_type) {
    const proj = await queryOne<{ plan_start_date: string | null }>(
      "SELECT plan_start_date::text FROM projects WHERE id = $1",
      [params.id],
    );
    indicator_type =
      inferTierFromHorizon(proj?.plan_start_date ?? null, target_deadline ?? null) ??
      "outcome_initial";
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO kpis
       (project_id, label, target, unit, goal_id, indicator_type,
        previous_value, achievement_condition, target_deadline,
        baseline_value, baseline_year, contributes_to_kpi_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      params.id, label, target, unit,
      goal_id ?? null, indicator_type,
      previous_value ?? null,
      achievement_condition ?? null,
      target_deadline ?? null,
      // baseline 未指定時は現在値を起点にする（到達度0%＝策定時から不変）
      baseline_value ?? null,
      baseline_year ?? null,
      contributes_to_kpi_id ?? null,
    ]
  );

  return NextResponse.json({ data: { id: rows[0]?.id }, error: null }, { status: 201 });
}
