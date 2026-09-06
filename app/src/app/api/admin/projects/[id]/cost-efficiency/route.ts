export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { ARTIFACT_TYPES } from "@/lib/modules/artifact-types";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const bodySchema = z.object({
  major_policy_name: z.string().optional().nullable(),
  fiscal_year: z.number().int().optional().nullable(),
  evaluation_type: z.enum(["ex_ante", "ex_post"]).default("ex_ante"),
  labor_cost: z.number().optional().nullable(),
  operating_cost: z.number().optional().nullable(),
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
  actual_total_reduction: z.number().optional().nullable(),
  actual_cost_ratio: z.number().optional().nullable(),
  evidence_basis: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  program_evaluation_id: z.string().uuid().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  // program_evaluations → logic_models を JOIN して上流コンテキストを返す（R1-4/R1-5）
  const rows = await query(
    `SELECT cer.id, cer.major_policy_name, cer.fiscal_year, cer.evaluation_type,
            cer.program_evaluation_id,
            cer.labor_cost::float, cer.operating_cost::float, cer.total_investment::float,
            cer.insured_n, cer.utilization_rate::float, cer.unit_benefit::float,
            cer.delta_cert_rate::float, cer.reduction_a::float,
            cer.delta_recep_rate::float, cer.reduction_b::float,
            cer.recipient_count, cer.delta_unit_benefit::float, cer.reduction_c::float,
            cer.total_reduction::float, cer.cost_ratio::float,
            cer.actual_total_reduction::float, cer.actual_cost_ratio::float,
            cer.evidence_basis, cer.notes, cer.created_at::text,
            CASE WHEN pe.id IS NULL THEN NULL ELSE
              json_build_object(
              'id', pe.id,
              'result', pe.result,
              'achievement_rate', pe.achievement_rate,
              'findings', pe.findings,
              'improvement_actions', pe.improvement_actions,
              'next_steps', pe.next_steps
            )
            END AS upstream_program_evaluation,
            CASE WHEN lm.id IS NULL THEN NULL ELSE
              json_build_object(
              'id', lm.id,
              'name', lm.name,
              'inputs', lm.inputs
            )
            END AS upstream_logic_model_prefill
     FROM cost_efficiency_records cer
     LEFT JOIN program_evaluations pe ON pe.id = cer.program_evaluation_id
     LEFT JOIN logic_models lm ON lm.id = pe.logic_model_id
     WHERE cer.project_id = $1
     ORDER BY cer.fiscal_year, cer.evaluation_type`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
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

  // ex_post 作成時にプログラム評価の実績値をプリフィル（R1-5）
  let actualTotalReduction: number | null = d.actual_total_reduction ?? null;
  let actualCostRatio: number | null = d.actual_cost_ratio ?? null;
  if (d.evaluation_type === "ex_post" && d.program_evaluation_id && actualTotalReduction == null) {
    const pe = await queryOne<{ achievement_rate: number | null }>(
      `SELECT achievement_rate::float FROM program_evaluations WHERE id = $1 AND project_id = $2`,
      [d.program_evaluation_id, params.id],
    );
    if (pe?.achievement_rate != null) {
      // 事前評価の投入額があれば事後コスト比率の初期値として achievement_rate から算定
      const laborCost = d.labor_cost ?? 0;
      const opCost = d.operating_cost ?? 0;
      const totalInv = laborCost + opCost;
      const totalRed = d.total_reduction ?? null;
      if (totalRed != null && totalRed > 0) {
        actualTotalReduction = (totalRed * pe.achievement_rate) / 100;
        actualCostRatio = totalInv > 0 ? (totalInv / actualTotalReduction) * 100 : null;
      }
    }
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO cost_efficiency_records
       (project_id, major_policy_name, fiscal_year, evaluation_type,
        labor_cost, operating_cost,
        insured_n, utilization_rate, unit_benefit,
        delta_cert_rate, reduction_a,
        delta_recep_rate, reduction_b,
        recipient_count, delta_unit_benefit, reduction_c,
        actual_total_reduction, actual_cost_ratio,
        evidence_basis, notes, program_evaluation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING id`,
    [
      params.id,
      d.major_policy_name ?? null,
      d.fiscal_year ?? null,
      d.evaluation_type,
      d.labor_cost ?? null,
      d.operating_cost ?? null,
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
      actualTotalReduction,
      actualCostRatio,
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

  // 成果物レジストリに登録（R2-3）
  if (inserted) {
    const artifactType =
      d.evaluation_type === "ex_post"
        ? ARTIFACT_TYPES.cost_efficiency.ex_post
        : ARTIFACT_TYPES.cost_efficiency.ex_ante;
    // cost_efficiency は program_evaluation を経由して logic_model にも繋がる
    const peSourceIds = await resolveArtifactIds(
      params.id,
      "program_evaluation",
      [d.program_evaluation_id],
    );
    // program_evaluation から logic_model の artifact も探す
    let lmSourceIds: string[] = [];
    if (d.program_evaluation_id) {
      const pe = await queryOne<{ logic_model_id: string | null }>(
        `SELECT logic_model_id FROM program_evaluations WHERE id = $1`,
        [d.program_evaluation_id],
      );
      lmSourceIds = await resolveArtifactIds(params.id, "logic_model", [pe?.logic_model_id]);
    }
    await recordArtifact({
      projectId: params.id,
      moduleId: "cost_efficiency",
      artifactType,
      artifactRecordId: (inserted as { id: string }).id,
      sourceArtifactIds: [...peSourceIds, ...lmSourceIds],
      derivationNote: `${d.evaluation_type === "ex_post" ? "事後" : "事前"}コスト効率評価`,
    }).catch((e) => console.error("recordArtifact(cost_efficiency) 失敗:", e));
  }

  return NextResponse.json({ data: inserted, error: null }, { status: 201 });
}
