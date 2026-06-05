export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const bodySchema = z.object({
  // kpi_id を指定した場合は個別分析、省略した場合は全KPI一括分析
  kpi_id: z.string().optional(),
  // フロントから現状値を渡す（ユーザー手入力値）
  current_values: z.array(z.object({
    kpi_id: z.string(),
    current_value: z.number(),
    data_source: z.string().default("手入力"),
  })),
});

// achievement_condition に基づいてギャップ・達成率・優先度を算出
function calcGap(target: number, current: number, condition: string | null) {
  const cond = condition ?? "gte";
  // 目標値との差（条件方向を考慮）
  // gte/gt: 現状 >= 目標 が良い → ギャップ = 目標 - 現状（負なら達成）
  // lte/lt: 現状 <= 目標 が良い → ギャップ = 現状 - 目標（負なら達成）
  let gapValue: number;
  let achieved: boolean;

  if (cond === "lte" || cond === "lt") {
    gapValue = current - target;   // 現状が目標を超えていれば正（要改善）
    achieved = cond === "lte" ? current <= target : current < target;
  } else {
    gapValue = target - current;   // 現状が目標未満なら正（要改善）
    achieved = cond === "eq" ? current === target
      : cond === "gt" ? current > target
      : current >= target;
  }

  // 達成率（%）
  const achievementRate = target !== 0 ? Math.round((current / target) * 1000) / 10 : null;

  // 優先度スコア（0〜100: ギャップが大きいほど高い）
  const absGap = Math.abs(gapValue);
  const priorityScore = achieved ? 0
    : target !== 0 ? Math.min(100, Math.round((absGap / Math.abs(target)) * 100))
    : 50;

  return { gapValue, achieved, achievementRate, priorityScore };
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "gap_analysis", "edit");
  if (deny) return deny;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  const { kpi_id, current_values } = parsed.data;

  // 対象KPIを取得
  let kpis;
  if (kpi_id) {
    kpis = await query<{
      id: string; label: string; target: number; unit: string;
      achievement_condition: string | null; target_deadline: string | null;
      goal_id: string | null;
    }>(
      `SELECT id, label, target::float, unit, achievement_condition,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline, goal_id
       FROM kpis WHERE id = $1 AND project_id = $2`,
      [kpi_id, params.id]
    );
  } else {
    kpis = await query<{
      id: string; label: string; target: number; unit: string;
      achievement_condition: string | null; target_deadline: string | null;
      goal_id: string | null;
    }>(
      `SELECT id, label, target::float, unit, achievement_condition,
              to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline, goal_id
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id]
    );
  }

  const currentMap = new Map(current_values.map((cv) => [cv.kpi_id, cv]));
  const results: Array<{
    kpi_id: string; gap_id: string; gapValue: number;
    achieved: boolean; priorityScore: number; achievementRate: number | null;
  }> = [];

  for (const kpi of kpis) {
    const cv = currentMap.get(kpi.id);
    if (cv === undefined) continue; // 現状値がなければスキップ

    const { gapValue, achieved, achievementRate, priorityScore } =
      calcGap(kpi.target, cv.current_value, kpi.achievement_condition);

    const condLabel =
      kpi.achievement_condition === "lte" ? "以下" :
      kpi.achievement_condition === "lt"  ? "未満" :
      kpi.achievement_condition === "gt"  ? "超"   :
      kpi.achievement_condition === "eq"  ? "達成" : "以上";

    const aiComment =
      achieved
        ? `${kpi.label}は目標（${kpi.target}${kpi.unit}${condLabel}）を達成しています。`
        : `${kpi.label}は現状${cv.current_value}${kpi.unit}で、目標（${kpi.target}${kpi.unit}${condLabel}）まで${Math.abs(gapValue).toFixed(1)}${kpi.unit}のギャップがあります。`;

    // gap_analyses を upsert（kpi_id で既存を更新 or 新規作成）
    const existing = await query<{ id: string }>(
      "SELECT id FROM gap_analyses WHERE project_id = $1 AND kpi_id = $2 LIMIT 1",
      [params.id, kpi.id]
    );

    let gapId: string;
    if (existing[0]) {
      gapId = existing[0].id;
      await query(
        `UPDATE gap_analyses SET
           indicator_name = $1, indicator_unit = $2, data_source = $3,
           current_value = $4, target_value = $5,
           priority_score = $6, ai_analysis = $7, updated_at = now()
         WHERE id = $8`,
        [
          kpi.label, kpi.unit, cv.data_source,
          cv.current_value, kpi.target,
          priorityScore, aiComment,
          gapId,
        ]
      );
    } else {
      const row = await query<{ id: string }>(
        `INSERT INTO gap_analyses
           (project_id, kpi_id, indicator_name, indicator_unit, data_source,
            current_value, current_year, target_value, target_basis,
            priority_score, ai_analysis, trend)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          params.id, kpi.id, kpi.label, kpi.unit, cv.data_source,
          cv.current_value,
          new Date().getFullYear(),
          kpi.target,
          kpi.achievement_condition ?? "gte",
          priorityScore, aiComment,
          achieved ? "improving" : "unknown",
        ]
      );
      gapId = row[0]!.id;
    }

    results.push({ kpi_id: kpi.id, gap_id: gapId, gapValue, achieved, priorityScore, achievementRate });
  }

  return NextResponse.json({ data: results, error: null });
}
