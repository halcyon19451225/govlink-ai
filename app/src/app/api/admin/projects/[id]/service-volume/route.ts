export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

const bodySchema = z.object({
  service_name: z.string(),
  service_category: z.string().optional(),
  fiscal_year: z.number().int(),
  planned_cert_rate: z.number().optional(),
  planned_recep_rate: z.number().optional(),
  planned_unit_benefit: z.number().optional(),
  planned_users: z.number().int().optional(),
  planned_benefit: z.number().optional(),
  actual_cert_rate: z.number().optional(),
  actual_recep_rate: z.number().optional(),
  actual_unit_benefit: z.number().optional(),
  actual_users: z.number().int().optional(),
  actual_benefit: z.number().optional(),
  deviation_notes: z.string().optional(),
  checkpoint_id: z.string().uuid().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const rows = await query(
    `SELECT id, project_id, checkpoint_id, service_name, service_category, fiscal_year,
            planned_cert_rate::float, planned_recep_rate::float, planned_unit_benefit::float,
            planned_users, planned_benefit::float,
            actual_cert_rate::float, actual_recep_rate::float, actual_unit_benefit::float,
            actual_users, actual_benefit::float,
            cert_deviation_pct::float,
            deviation_analysis, deviation_notes, ai_deviation_analysis,
            created_at::text
     FROM service_volume_plans
     WHERE project_id = $1
     ORDER BY fiscal_year, service_name`,
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
    `INSERT INTO service_volume_plans
       (project_id, checkpoint_id, service_name, service_category, fiscal_year,
        planned_cert_rate, planned_recep_rate, planned_unit_benefit, planned_users, planned_benefit,
        actual_cert_rate, actual_recep_rate, actual_unit_benefit, actual_users, actual_benefit,
        deviation_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (project_id, service_name, fiscal_year) DO UPDATE SET
       checkpoint_id = EXCLUDED.checkpoint_id,
       service_category = EXCLUDED.service_category,
       planned_cert_rate = EXCLUDED.planned_cert_rate,
       planned_recep_rate = EXCLUDED.planned_recep_rate,
       planned_unit_benefit = EXCLUDED.planned_unit_benefit,
       planned_users = EXCLUDED.planned_users,
       planned_benefit = EXCLUDED.planned_benefit,
       actual_cert_rate = EXCLUDED.actual_cert_rate,
       actual_recep_rate = EXCLUDED.actual_recep_rate,
       actual_unit_benefit = EXCLUDED.actual_unit_benefit,
       actual_users = EXCLUDED.actual_users,
       actual_benefit = EXCLUDED.actual_benefit,
       deviation_notes = EXCLUDED.deviation_notes
     RETURNING id`,
    [
      params.id,
      d.checkpoint_id ?? null,
      d.service_name,
      d.service_category ?? null,
      d.fiscal_year,
      d.planned_cert_rate ?? null,
      d.planned_recep_rate ?? null,
      d.planned_unit_benefit ?? null,
      d.planned_users ?? null,
      d.planned_benefit ?? null,
      d.actual_cert_rate ?? null,
      d.actual_recep_rate ?? null,
      d.actual_unit_benefit ?? null,
      d.actual_users ?? null,
      d.actual_benefit ?? null,
      d.deviation_notes ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null }, { status: 201 });
}
