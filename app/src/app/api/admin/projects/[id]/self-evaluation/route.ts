export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { ARTIFACT_TYPES } from "@/lib/modules/artifact-types";
import { requireModulePermission } from "@/lib/permissions";

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
  // PDCAチェックポイントとの紐付け（従来 API がセットしておらず常に NULL だった）
  checkpoint_id: z.string().uuid().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "self_evaluation", "view");
  if (deny) return deny;

  // program_evaluations を JOIN して自己評価記入時のコンテキストを返す（R1-6）
  const rows = await query(
    `SELECT s.id, s.project_id, s.checkpoint_id, s.program_evaluation_id,
            s.title, s.has_interim_review, s.background, s.activities,
            s.target_and_metrics, s.evaluation_method, s.evaluation_timing,
            s.created_at::text,
            CASE WHEN pe.id IS NULL THEN NULL ELSE
              json_build_object(
              'id', pe.id,
              'evaluation_tier', pe.evaluation_tier,
              'fiscal_year', pe.fiscal_year,
              'result', pe.result,
              'achievement_rate', pe.achievement_rate,
              'findings', pe.findings,
              'improvement_actions', pe.improvement_actions,
              'next_steps', pe.next_steps
            )
            END AS upstream_program_evaluation,
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
     LEFT JOIN program_evaluations pe ON pe.id = s.program_evaluation_id
     LEFT JOIN self_evaluation_entries e ON e.sheet_id = s.id
     WHERE s.project_id = $1
     GROUP BY s.id, pe.id
     ORDER BY s.created_at`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

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

  const row = await queryOne<{ id: string }>(
    `INSERT INTO self_evaluation_sheets
       (project_id, title, background, activities, target_and_metrics,
        evaluation_method, evaluation_timing, has_interim_review, program_evaluation_id,
        checkpoint_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      d.checkpoint_id ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  // 成果物レジストリに登録（R2-3）
  const sourceIds = await resolveArtifactIds(
    params.id,
    "program_evaluation",
    [d.program_evaluation_id],
  );
  await recordArtifact({
    projectId: params.id,
    moduleId: "self_evaluation",
    artifactType: ARTIFACT_TYPES.self_evaluation.self_eval_sheet,
    artifactRecordId: (row as { id: string }).id,
    sourceArtifactIds: sourceIds,
    derivationNote: d.program_evaluation_id
      ? `プログラム評価(${d.program_evaluation_id})に基づく自己評価シート`
      : undefined,
  }).catch((e) => console.error("recordArtifact(self_evaluation) 失敗:", e));

  return NextResponse.json({ data: row, error: null }, { status: 201 });
}
