export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; planId: string } };

const patchSchema = z.object({
  service_name: z.string().optional(),
  service_category: z.string().optional(),
  fiscal_year: z.number().int().optional(),
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
  ai_deviation_analysis: z.string().optional(),
  deviation_analysis: z.unknown().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "service_volume", "edit");
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

  addField("service_name", d.service_name);
  addField("service_category", d.service_category);
  addField("fiscal_year", d.fiscal_year);
  addField("planned_cert_rate", d.planned_cert_rate);
  addField("planned_recep_rate", d.planned_recep_rate);
  addField("planned_unit_benefit", d.planned_unit_benefit);
  addField("planned_users", d.planned_users);
  addField("planned_benefit", d.planned_benefit);
  addField("actual_cert_rate", d.actual_cert_rate);
  addField("actual_recep_rate", d.actual_recep_rate);
  addField("actual_unit_benefit", d.actual_unit_benefit);
  addField("actual_users", d.actual_users);
  addField("actual_benefit", d.actual_benefit);
  addField("deviation_notes", d.deviation_notes);
  addField("ai_deviation_analysis", d.ai_deviation_analysis);
  if (d.deviation_analysis !== undefined) {
    addField("deviation_analysis", JSON.stringify(d.deviation_analysis));
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  values.push(params.planId, params.id);
  const row = await queryOne(
    `UPDATE service_volume_plans SET ${setClauses.join(", ")}
     WHERE id = $${idx} AND project_id = $${idx + 1}
     RETURNING id`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "レコードが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ data: row, error: null });
}
