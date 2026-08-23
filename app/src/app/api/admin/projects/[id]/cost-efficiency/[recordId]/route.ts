export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; recordId: string } };

const patchSchema = z.object({
  major_policy_name: z.string().optional().nullable(),
  fiscal_year: z.number().int().optional().nullable(),
  evaluation_type: z.enum(["ex_ante", "ex_post"]).optional(),
  labor_cost: z.number().optional().nullable(),
  operating_cost: z.number().optional().nullable(),
  insured_n: z.number().int().optional().nullable(),
  unit_benefit: z.number().optional().nullable(),
  delta_cert_rate: z.number().optional().nullable(),
  reduction_a: z.number().optional().nullable(),
  delta_recep_rate: z.number().optional().nullable(),
  reduction_b: z.number().optional().nullable(),
  recipient_count: z.number().int().optional().nullable(),
  delta_unit_benefit: z.number().optional().nullable(),
  reduction_c: z.number().optional().nullable(),
  // total_reduction / cost_ratio / total_investment は GENERATED ALWAYS AS STORED 列のため除外
  actual_total_reduction: z.number().optional().nullable(),
  actual_cost_ratio: z.number().optional().nullable(),
  evidence_basis: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
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
  let i = 1;

  const add = (col: string, val: unknown) => {
    setClauses.push(`${col} = $${i++}`);
    values.push(val);
  };

  if ("major_policy_name" in d) add("major_policy_name", d.major_policy_name ?? null);
  if ("fiscal_year" in d) add("fiscal_year", d.fiscal_year ?? null);
  if ("evaluation_type" in d) add("evaluation_type", d.evaluation_type);
  if ("labor_cost" in d) add("labor_cost", d.labor_cost ?? null);
  if ("operating_cost" in d) add("operating_cost", d.operating_cost ?? null);
  if ("insured_n" in d) add("insured_n", d.insured_n ?? null);
  if ("unit_benefit" in d) add("unit_benefit", d.unit_benefit ?? null);
  if ("delta_cert_rate" in d) add("delta_cert_rate", d.delta_cert_rate ?? null);
  if ("reduction_a" in d) add("reduction_a", d.reduction_a ?? null);
  if ("delta_recep_rate" in d) add("delta_recep_rate", d.delta_recep_rate ?? null);
  if ("reduction_b" in d) add("reduction_b", d.reduction_b ?? null);
  if ("recipient_count" in d) add("recipient_count", d.recipient_count ?? null);
  if ("delta_unit_benefit" in d) add("delta_unit_benefit", d.delta_unit_benefit ?? null);
  if ("reduction_c" in d) add("reduction_c", d.reduction_c ?? null);
  // total_reduction / cost_ratio / total_investment は GENERATED ALWAYS AS STORED のため SET 不可
  if ("actual_total_reduction" in d) add("actual_total_reduction", d.actual_total_reduction ?? null);
  if ("actual_cost_ratio" in d) add("actual_cost_ratio", d.actual_cost_ratio ?? null);
  if ("evidence_basis" in d) add("evidence_basis", d.evidence_basis ?? null);
  if ("notes" in d) add("notes", d.notes ?? null);

  if (setClauses.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  values.push(params.recordId, params.id);

  const row = await queryOne(
    `UPDATE cost_efficiency_records
     SET ${setClauses.join(", ")}
     WHERE id = $${i++} AND project_id = $${i}
     RETURNING id, major_policy_name, fiscal_year, evaluation_type,
               labor_cost::float, operating_cost::float, total_investment::float,
               insured_n, unit_benefit::float,
               delta_cert_rate::float, reduction_a::float,
               delta_recep_rate::float, reduction_b::float,
               recipient_count, delta_unit_benefit::float, reduction_c::float,
               total_reduction::float, cost_ratio::float,
               actual_total_reduction::float, actual_cost_ratio::float,
               evidence_basis, notes, created_at::text`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
  if (deny) return deny;

  const row = await queryOne(
    "DELETE FROM cost_efficiency_records WHERE id = $1 AND project_id = $2 RETURNING id",
    [params.recordId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: params.recordId }, error: null });
}
