export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; sheetId: string } };

const bodySchema = z.object({
  fiscal_year: z.number().int(),
  period_type: z.enum(["interim", "final"]),
  actual_activities: z.string().optional(),
  rating: z.enum(["achieved", "mostly_achieved", "not_achieved", "ongoing"]).optional(),
  rating_label: z.string().optional(),
  achievement_analysis: z.string().optional(),
  activity_appropriateness: z.string().optional(),
  improvement_status: z.string().optional(),
  ideal_gap: z.string().optional(),
  challenges: z.string().optional(),
  countermeasures: z.string().optional(),
  next_year_changes: z.string().optional(),
  prefecture_support_request: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "self_evaluation", "edit");
  if (deny) return deny;

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

  const row = await queryOne(
    `INSERT INTO self_evaluation_entries
       (sheet_id, fiscal_year, period_type, actual_activities, rating, rating_label,
        achievement_analysis, activity_appropriateness, improvement_status,
        ideal_gap, challenges, countermeasures, next_year_changes, prefecture_support_request)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (sheet_id, fiscal_year, period_type) DO UPDATE SET
       actual_activities = EXCLUDED.actual_activities,
       rating = EXCLUDED.rating,
       rating_label = EXCLUDED.rating_label,
       achievement_analysis = EXCLUDED.achievement_analysis,
       activity_appropriateness = EXCLUDED.activity_appropriateness,
       improvement_status = EXCLUDED.improvement_status,
       ideal_gap = EXCLUDED.ideal_gap,
       challenges = EXCLUDED.challenges,
       countermeasures = EXCLUDED.countermeasures,
       next_year_changes = EXCLUDED.next_year_changes,
       prefecture_support_request = EXCLUDED.prefecture_support_request
     RETURNING *`,
    [
      params.sheetId,
      d.fiscal_year,
      d.period_type,
      d.actual_activities ?? null,
      d.rating ?? null,
      d.rating_label ?? null,
      d.achievement_analysis ?? null,
      d.activity_appropriateness ?? null,
      d.improvement_status ?? null,
      d.ideal_gap ?? null,
      d.challenges ?? null,
      d.countermeasures ?? null,
      d.next_year_changes ?? null,
      d.prefecture_support_request ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: row, error: null }, { status: 201 });
}
