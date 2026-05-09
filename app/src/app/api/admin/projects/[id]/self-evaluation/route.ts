export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

const bodySchema = z.object({
  title: z.string(),
  background: z.string().optional(),
  activities: z.string().optional(),
  target_and_metrics: z.string().optional(),
  evaluation_method: z.string().optional(),
  evaluation_timing: z.string().optional(),
  has_interim_review: z.boolean().default(true),
  program_evaluation_id: z.string().uuid().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const rows = await query(
    `SELECT s.id, s.project_id, s.checkpoint_id, s.program_evaluation_id,
            s.title, s.has_interim_review, s.background, s.activities,
            s.target_and_metrics, s.evaluation_method, s.evaluation_timing,
            s.created_at::text,
            COALESCE(json_agg(
              json_build_object(
                'id', e.id,
                'sheet_id', e.sheet_id,
                'fiscal_year', e.fiscal_year,
                'period_type', e.period_type,
                'actual_activities', e.actual_activities,
                'rating', e.rating,
                'rating_label', e.rating_label,
                'achievement_analysis', e.achievement_analysis,
                'activity_appropriateness', e.activity_appropriateness,
                'improvement_status', e.improvement_status,
                'ideal_gap', e.ideal_gap,
                'challenges', e.challenges,
                'countermeasures', e.countermeasures,
                'next_year_changes', e.next_year_changes,
                'prefecture_support_request', e.prefecture_support_request,
                'created_at', e.created_at::text
              ) ORDER BY e.fiscal_year, e.period_type
            ) FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
     FROM self_evaluation_sheets s
     LEFT JOIN self_evaluation_entries e ON e.sheet_id = s.id
     WHERE s.project_id = $1
     GROUP BY s.id
     ORDER BY s.created_at`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

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

  const d = parsed.data;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO self_evaluation_sheets
       (project_id, title, background, activities, target_and_metrics,
        evaluation_method, evaluation_timing, has_interim_review, program_evaluation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      params.id,
      d.title,
      d.background ?? null,
      d.activities ?? null,
      d.target_and_metrics ?? null,
      d.evaluation_method ?? null,
      d.evaluation_timing ?? null,
      d.has_interim_review,
      d.program_evaluation_id ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: row, error: null }, { status: 201 });
}
