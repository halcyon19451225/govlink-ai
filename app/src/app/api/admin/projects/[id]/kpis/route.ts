export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const postSchema = z.object({
  label:          z.string().min(1, "指標名は必須です"),
  target:         z.union([z.number(), z.string()]).transform((v) => Number(v)),
  unit:           z.string().default(""),
  goal_id:        z.string().nullable().optional(),
  indicator_type: z.enum(["process","outcome_initial","outcome_mid","outcome_long","efficiency"]).default("outcome_initial"),
  previous_value: z.number().nullable().optional(),
  // evaluation_timing はカラムがないため metadata として扱う（現状は無視）
});

// GET: 全KPI一覧（goal_id付き）
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const kpis = await query(
    `SELECT id, label, target::float, current::float, unit,
            goal_id, indicator_type, previous_value::float, created_at
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

  const { label, target, unit, goal_id, indicator_type, previous_value } = parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO kpis (project_id, label, target, unit, goal_id, indicator_type, previous_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [params.id, label, target, unit, goal_id ?? null, indicator_type, previous_value ?? null]
  );

  return NextResponse.json({ data: { id: rows[0]?.id }, error: null }, { status: 201 });
}
