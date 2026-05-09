export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

const bodySchema = z.object({
  major_policy_name: z.string().optional().nullable(),
  fiscal_year: z.number().int().optional().nullable(),
  evaluation_type: z.enum(["pre", "post"]).default("pre"),
  labor_cost: z.number().optional().nullable(),
  operating_cost: z.number().optional().nullable(),
  total_investment: z.number().optional().nullable(),
  insured_n: z.number().int().optional().nullable(),
  utilization_rate: z.number().optional().nullable(),
  unit_benefit: z.number().optional().nullable(),
  delta_cert_rate: z.number().optional().nullable(),
  reduction_a: z.number().optional().nullable(),
  delta_recep_rate: z.number().optional().nullable(),
  reduction_b: z.number().optional().nullable(),
  recipient_count: z.number().int().optional().nullable(),
  delta_unit_benefit: z.number().optional().nullable(),
  reduction_c: z.number().optional().nullable(),
  total_reduction: z.number().optional().nullable(),
  cost_ratio: z.number().optional().nullable(),
  evidence_basis: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  program_evaluation_id: z.string().uuid().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const rows = await query(
    `SELECT id, major_policy_name, fiscal_year, evaluation_type,
            labor_cost::float, operating_cost::float, total_investment::float,
            insured_n, utilization_rate::float, unit_benefit::float,
            delta_cert_rate::float, reduction_a::float,
            delta_recep_rate::float, reduction_b::float,
            recipient_count, delta_unit_benefit::float, reduction_c::float,
            total_reduction::float, cost_ratio::float,
            actual_total_reduction::float, actual_cost_ratio::float,
            evidence_basis, notes, created_at::text
     FROM cost_efficiency_records
     WHERE project_id = $1
     ORDER BY fiscal_year, evaluation_type`,
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
    `INSERT INTO cost_efficiency_records
       (project_id, major_policy_name, fiscal_year, evaluation_type,
        labor_cost, operating_cost, total_investment,
        insured_n, utilization_rate, unit_benefit,
        delta_cert_rate, reduction_a,
        delta_recep_rate, reduction_b,
        recipient_count, delta_unit_benefit, reduction_c,
        total_reduction, cost_ratio,
        evidence_basis, notes, program_evaluation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     RETURNING id`,
    [
      params.id,
      d.major_policy_name ?? null,
      d.fiscal_year ?? null,
      d.evaluation_type,
      d.labor_cost ?? null,
      d.operating_cost ?? null,
      d.total_investment ?? null,
      d.insured_n ?? null,
      d.utilization_rate ?? null,
      d.unit_benefit ?? null,
      d.delta_cert_rate ?? null,
      d.reduction_a ?? null,
      d.delta_recep_rate ?? null,
      d.reduction_b ?? null,
      d.recipient_count ?? null,
      d.delta_unit_benefit ?? null,
      d.reduction_c ?? null,
      d.total_reduction ?? null,
      d.cost_ratio ?? null,
      d.evidence_basis ?? null,
      d.notes ?? null,
      d.program_evaluation_id ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  const inserted = await queryOne(
    `SELECT id, major_policy_name, fiscal_year, evaluation_type,
            total_investment::float, total_reduction::float, cost_ratio::float, created_at::text
     FROM cost_efficiency_records WHERE id = $1`,
    [row.id],
  );

  return NextResponse.json({ data: inserted, error: null }, { status: 201 });
}
