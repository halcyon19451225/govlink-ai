export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const achievementConditionEnum = z.enum(["lte", "lt", "gte", "gt", "eq"]);

const postSchema = z.object({
  label:                 z.string().min(1, "指標名は必須です"),
  target:                z.union([z.number(), z.string()]).transform((v) => Number(v)),
  unit:                  z.string().default(""),
  goal_id:               z.string().nullable().optional(),
  indicator_type:        z.enum(["process","outcome_initial","outcome_mid","outcome_long","efficiency"]).default("outcome_initial"),
  previous_value:        z.number().nullable().optional(),
  achievement_condition: achievementConditionEnum.nullable().optional(),
  target_deadline:       z.string().nullable().optional(), // "YYYY-MM-DD"
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

  const { label, target, unit, goal_id, indicator_type, previous_value,
          achievement_condition, target_deadline } = parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO kpis
       (project_id, label, target, unit, goal_id, indicator_type,
        previous_value, achievement_condition, target_deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      params.id, label, target, unit,
      goal_id ?? null, indicator_type,
      previous_value ?? null,
      achievement_condition ?? null,
      target_deadline ?? null,
    ]
  );

  return NextResponse.json({ data: { id: rows[0]?.id }, error: null }, { status: 201 });
}
