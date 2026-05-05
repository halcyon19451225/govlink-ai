export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const postSchema = z.object({
  name: z.string().min(1, "テンプレート名は必須です"),
  category: z.enum([
    "elderly_care","disability","child","health",
    "urban","disaster","environment","education","other",
  ]),
  legal_basis: z.string().optional().nullable(),
  plan_period_years: z.number().int().optional().nullable(),
  is_composite: z.boolean().default(false),
  description: z.string().optional().nullable(),
  share: z.boolean().default(false),
  kpi_suggestions: z.array(z.object({
    label: z.string().min(1),
    unit: z.string().optional().nullable(),
    indicator_type: z.enum(["process","outcome_initial","outcome_mid","outcome_long","efficiency"]).default("process"),
    evaluation_timing: z.string().optional().nullable(),
    sort_order: z.number().int().default(0),
  })).default([]),
});

export async function GET(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId ?? null;

  const templates = await query<{
    id: string; name: string; category: string;
    legal_basis: string | null; plan_period_years: number | null;
    is_composite: boolean; description: string | null;
    is_system: boolean; shared_by_municipality_id: string | null;
    kpi_suggestions: Array<{
      id: string; label: string; unit: string | null;
      indicator_type: string; evaluation_timing: string | null;
      sort_order: number;
    }>;
  }>(
    `SELECT pt.id, pt.name, pt.category, pt.legal_basis, pt.plan_period_years,
            pt.is_composite, pt.description, pt.is_system, pt.shared_by_municipality_id,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', tks.id, 'label', tks.label, 'unit', tks.unit,
                  'indicator_type', tks.indicator_type,
                  'evaluation_timing', tks.evaluation_timing,
                  'sort_order', tks.sort_order
                ) ORDER BY tks.sort_order
              ) FILTER (WHERE tks.id IS NOT NULL),
              '[]'::json
            ) AS kpi_suggestions
     FROM plan_templates pt
     LEFT JOIN template_kpi_suggestions tks ON tks.template_id = pt.id
     WHERE pt.is_system = true
        OR pt.shared_by_municipality_id IS NOT NULL
        OR ($1::uuid IS NOT NULL AND pt.shared_by_municipality_id = $1::uuid)
     GROUP BY pt.id
     ORDER BY pt.is_system DESC, pt.category, pt.name`,
    [municipalityId],
  );

  return NextResponse.json({ data: templates, error: null });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { name, category, legal_basis, plan_period_years, is_composite, description, share, kpi_suggestions } = parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO plan_templates
       (name, category, legal_basis, plan_period_years, is_composite, description,
        is_system, shared_by_municipality_id)
     VALUES ($1, $2, $3, $4, $5, $6, false, $7)
     RETURNING id`,
    [name, category, legal_basis ?? null, plan_period_years ?? null, is_composite,
     description ?? null, share ? municipalityId : null],
  );
  const templateId = rows[0]?.id;
  if (!templateId) {
    return NextResponse.json({ data: null, error: "テンプレートの作成に失敗しました" }, { status: 500 });
  }

  for (const kpi of kpi_suggestions) {
    await query(
      `INSERT INTO template_kpi_suggestions
         (template_id, label, unit, indicator_type, evaluation_timing, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [templateId, kpi.label, kpi.unit ?? null, kpi.indicator_type,
       kpi.evaluation_timing ?? null, kpi.sort_order],
    );
  }

  return NextResponse.json({ data: { id: templateId }, error: null }, { status: 201 });
}
