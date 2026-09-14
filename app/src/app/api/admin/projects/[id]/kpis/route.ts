export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { inferTierFromHorizon } from "@/lib/outcome/tiers";
import { actorFromSession } from "@/lib/activity";
import { IndicatorError, createIndicator } from "@/lib/indicator/service";
import { PLAN_INDICATORS } from "@/lib/indicator/read";

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
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const kpis = await query(
    `SELECT id, label, target::float, current::float, unit,
            goal_id, indicator_type, previous_value::float,
            achievement_condition,
            baseline_value::float AS baseline_value, baseline_year,
            contributes_to_kpi_id,
            to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline,
            created_at
     FROM ${PLAN_INDICATORS} WHERE project_id = $1 ORDER BY created_at`,
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
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
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

  // 069 以降、指標の作成は指標管理のサービス層を通す。ここで INSERT を書かないこと
  // （画面も AI も同じ経路 → activity_log に同じ形で残る。設計 §9-1・§10-5）
  try {
    const created = await createIndicator(actorFromSession(session, "ui"), params.id, {
      label,
      unit,
      indicatorType: indicator_type,
      origin: "plan",
      goalId: goal_id ?? null,
      contributesToId: contributes_to_kpi_id ?? null,
      previousValue: previous_value ?? null,
      target: {
        scope: "plan",
        targetValue: target,
        achievementCondition: achievement_condition ?? "gte",
        targetDeadline: target_deadline ?? null,
        // 基準値が未指定なら、到達度の起点は目標を置いた時点では空のまま
        // （最初の実績が入ったときに、その値が起点になる）
        baselineValue: baseline_value ?? null,
        baselineAsOf: baseline_year != null ? `${String(baseline_year).padStart(4, "0")}-04-01` : null,
      },
    });
    return NextResponse.json({ data: { id: created.id }, error: null }, { status: 201 });
  } catch (e) {
    if (e instanceof IndicatorError) {
      return NextResponse.json({ data: null, error: e.message }, { status: e.status });
    }
    console.error("POST kpis:", e);
    return NextResponse.json({ data: null, error: "指標の登録に失敗しました" }, { status: 500 });
  }
}
