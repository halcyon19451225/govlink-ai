export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const moduleConfigValueSchema = z.object({ enabled: z.boolean() });

const postSchema = z.object({
  name: z.string().min(1, "テンプレート名は必須です"),
  plan_type: z.enum(["kaigo_hoken", "shougai_fukushi", "kenko_zoshin", "chiiki_fukushi", "custom"]),
  description: z.string().optional().nullable(),
  plan_period_years: z.number().int().min(1).max(10).default(3),
  module_config: z.record(z.string(), moduleConfigValueSchema).default({}),
});

export async function GET(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId ?? null;

  const templates = await query<{
    id: string; name: string; plan_type: string; description: string | null;
    plan_period_years: number; module_config: Record<string, { enabled: boolean }>;
    is_system_template: boolean; is_public: boolean;
    cycles: Array<{ id: string; name: string; cycle_type: string; phase: string; recurrence: string; sort_order: number }>;
  }>(
    `SELECT pt.id, pt.name, pt.plan_type, pt.description, pt.plan_period_years,
            pt.module_config, pt.is_system_template, pt.is_public,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', pcd.id, 'name', pcd.name, 'cycle_type', pcd.cycle_type,
                  'phase', pcd.phase, 'recurrence', pcd.recurrence,
                  'sort_order', pcd.sort_order
                ) ORDER BY pcd.sort_order
              ) FILTER (WHERE pcd.id IS NOT NULL),
              '[]'::json
            ) AS cycles
     FROM plan_templates pt
     LEFT JOIN pdca_cycle_defs pcd ON pcd.template_id = pt.id
     WHERE pt.is_system_template = true
        OR pt.is_public = true
        OR ($1::uuid IS NOT NULL AND pt.created_by = $1::uuid)
     GROUP BY pt.id
     ORDER BY pt.is_system_template DESC, pt.name`,
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

  const { name, plan_type, description, plan_period_years, module_config } = parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO plan_templates
       (name, plan_type, description, plan_period_years, module_config,
        is_system_template, is_public, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, false, false, $6)
     RETURNING id`,
    [name, plan_type, description ?? null, plan_period_years,
     JSON.stringify(module_config), municipalityId],
  );

  const templateId = rows[0]?.id;
  if (!templateId) {
    return NextResponse.json({ data: null, error: "テンプレートの作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: templateId }, error: null }, { status: 201 });
}
