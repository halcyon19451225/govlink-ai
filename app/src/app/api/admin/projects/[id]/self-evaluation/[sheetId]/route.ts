export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; sheetId: string } };

const patchSchema = z.object({
  title: z.string().optional(),
  background: z.string().optional(),
  activities: z.string().optional(),
  target_and_metrics: z.string().optional(),
  evaluation_method: z.string().optional(),
  evaluation_timing: z.string().optional(),
  has_interim_review: z.boolean().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "self_evaluation", "view");
  if (deny) return deny;

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
     WHERE s.id = $1 AND s.project_id = $2
     GROUP BY s.id`,
    [params.sheetId, params.id],
  );

  const sheet = rows[0] ?? null;
  if (!sheet) {
    return NextResponse.json({ data: null, error: "シートが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: sheet, error: null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "self_evaluation", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const d = parsed.data;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const addField = (col: string, val: unknown) => {
    if (val !== undefined) {
      setClauses.push(`${col} = $${idx++}`);
      values.push(val);
    }
  };

  addField("title", d.title);
  addField("background", d.background);
  addField("activities", d.activities);
  addField("target_and_metrics", d.target_and_metrics);
  addField("evaluation_method", d.evaluation_method);
  addField("evaluation_timing", d.evaluation_timing);
  addField("has_interim_review", d.has_interim_review);

  if (setClauses.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  values.push(params.sheetId, params.id);
  const row = await queryOne(
    `UPDATE self_evaluation_sheets SET ${setClauses.join(", ")}
     WHERE id = $${idx} AND project_id = $${idx + 1}
     RETURNING id`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "シートが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: row, error: null });
}
