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

// 効率性評価（第5階層）の詳細データ。
// efficiency tier の評価作成時に cost_efficiency_records へ連動保存する。
// generated column（total_investment / total_reduction / cost_ratio）は除外する。
const efficiencyDetailSchema = z.object({
  major_policy_name: z.string().optional().nullable(),
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
  actual_total_reduction: z.number().optional().nullable(),
  actual_cost_ratio: z.number().optional().nullable(),
  evidence_basis: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const bodySchema = z.object({
  evaluation_tier: z.enum(["needs", "theory", "process", "outcome", "cost", "efficiency"]),
  fiscal_year: z.number().int().optional().nullable(),
  status: z.enum(["draft", "in_review", "approved"]).default("draft"),
  result: z.string().optional().nullable(),
  achievement_rate: z.number().min(0).max(100).optional().nullable(),
  findings: z.string().optional().nullable(),
  success_factors: z.string().optional().nullable(),
  barrier_factors: z.string().optional().nullable(),
  improvement_actions: z.string().optional().nullable(),
  next_steps: z.string().optional().nullable(),
  flow_decision_path: z.any().optional().nullable(),
  kpi_ids: z.array(z.string().uuid()).optional().nullable(),
  logic_model_id: z.string().uuid().optional().nullable(),
  // efficiency tier の場合のみ参照（cost_efficiency_records へ連動）
  efficiency_detail: efficiencyDetailSchema.optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  // efficiency tier の評価には紐づく cost_efficiency_records（コスト比率等）も同梱する（案B-2）
  const rows = await query(
    `SELECT pe.id, pe.evaluation_tier, pe.fiscal_year, pe.status, pe.result,
            pe.achievement_rate::float, pe.findings, pe.success_factors, pe.barrier_factors,
            pe.improvement_actions, pe.next_steps, pe.flow_decision_path, pe.kpi_ids,
            pe.evaluated_by, pe.ai_commentary, pe.logic_model_id, pe.created_at::text,
            json_build_object(
              'id', lm.id,
              'name', lm.name,
              'inputs', lm.inputs,
              'outputs', lm.outputs,
              'initial_outcomes', lm.initial_outcomes,
              'intermediate_outcomes', lm.intermediate_outcomes
            ) FILTER (WHERE lm.id IS NOT NULL) AS upstream_logic_model,
            json_build_object(
              'id', cer.id,
              'major_policy_name', cer.major_policy_name,
              'evaluation_type', cer.evaluation_type,
              'labor_cost', cer.labor_cost::float,
              'operating_cost', cer.operating_cost::float,
              'total_investment', cer.total_investment::float,
              'total_reduction', cer.total_reduction::float,
              'cost_ratio', cer.cost_ratio::float,
              'actual_total_reduction', cer.actual_total_reduction::float,
              'actual_cost_ratio', cer.actual_cost_ratio::float
            ) FILTER (WHERE cer.id IS NOT NULL) AS efficiency_detail
     FROM program_evaluations pe
     LEFT JOIN logic_models lm ON lm.id = pe.logic_model_id
     LEFT JOIN cost_efficiency_records cer ON cer.program_evaluation_id = pe.id
     WHERE pe.project_id = $1
     ORDER BY pe.fiscal_year, pe.created_at`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
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
  const kpiIds = d.kpi_ids && d.kpi_ids.length > 0 ? d.kpi_ids : null;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO program_evaluations
       (project_id, evaluation_tier, fiscal_year, status, result,
        achievement_rate, findings, success_factors, barrier_factors,
        improvement_actions, next_steps, flow_decision_path, kpi_ids, logic_model_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             COALESCE($13::uuid[], '{}'::uuid[]), $14)
     RETURNING id`,
    [
      params.id,
      d.evaluation_tier,
      d.fiscal_year ?? null,
      d.status,
      d.result ?? null,
      d.achievement_rate ?? null,
      d.findings ?? null,
      d.success_factors ?? null,
      d.barrier_factors ?? null,
      d.improvement_actions ?? null,
      d.next_steps ?? null,
      d.flow_decision_path ?? null,
      kpiIds,
      d.logic_model_id ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  const inserted = await queryOne(
    `SELECT id, evaluation_tier, fiscal_year, status, result,
            achievement_rate::float, findings, flow_decision_path, kpi_ids, created_at::text
     FROM program_evaluations WHERE id = $1`,
    [row.id],
  );

  // efficiency tier（第5階層）の場合、cost_efficiency_records へ詳細データを連動保存し
  // program_evaluation_id で 1対1 紐付けする（案B-2）。
  let efficiencyDetail: unknown = null;
  if (d.evaluation_tier === "efficiency") {
    const ed: z.infer<typeof efficiencyDetailSchema> =
      d.efficiency_detail ?? efficiencyDetailSchema.parse({});
    const cer = await queryOne<{ id: string }>(
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
        ed.major_policy_name ?? null,
        d.fiscal_year ?? null,
        ed.evaluation_type ?? "ex_ante",
        ed.labor_cost ?? null,
        ed.operating_cost ?? null,
        ed.insured_n ?? null,
        ed.utilization_rate ?? null,
        ed.unit_benefit ?? null,
        ed.delta_cert_rate ?? null,
        ed.reduction_a ?? null,
        ed.delta_recep_rate ?? null,
        ed.reduction_b ?? null,
        ed.recipient_count ?? null,
        ed.delta_unit_benefit ?? null,
        ed.reduction_c ?? null,
        ed.actual_total_reduction ?? null,
        ed.actual_cost_ratio ?? null,
        ed.evidence_basis ?? null,
        ed.notes ?? null,
        row.id,
      ],
    );
    if (cer) {
      efficiencyDetail = await queryOne(
        `SELECT id, major_policy_name, evaluation_type,
                labor_cost::float, operating_cost::float, total_investment::float,
                total_reduction::float, cost_ratio::float,
                actual_total_reduction::float, actual_cost_ratio::float, created_at::text
         FROM cost_efficiency_records WHERE id = $1`,
        [cer.id],
      );
    }
  }

  // 成果物レジストリに登録（R2-3）
  if (inserted) {
    const tierToType: Record<string, string> = {
      process: ARTIFACT_TYPES.program_evaluation.process_eval,
      outcome_initial: ARTIFACT_TYPES.program_evaluation.initial_outcome_eval,
      outcome_intermediate: ARTIFACT_TYPES.program_evaluation.intermediate_outcome_eval,
      outcome: ARTIFACT_TYPES.program_evaluation.initial_outcome_eval,
      efficiency: ARTIFACT_TYPES.program_evaluation.efficiency_eval,  // 第5階層（P5: 案B-2）
    };
    const artifactType =
      tierToType[d.evaluation_tier] ?? ARTIFACT_TYPES.program_evaluation.process_eval;
    const sourceIds = await resolveArtifactIds(params.id, "logic_model", [d.logic_model_id]);
    await recordArtifact({
      projectId: params.id,
      moduleId: "program_evaluation",
      artifactType,
      artifactRecordId: (inserted as { id: string }).id,
      sourceArtifactIds: sourceIds,
      derivationNote: d.logic_model_id
        ? `ロジックモデル(${d.logic_model_id})に基づくプログラム評価`
        : undefined,
    }).catch((e) => console.error("recordArtifact(program_evaluation) 失敗:", e));
  }

  const data =
    inserted && efficiencyDetail
      ? { ...(inserted as Record<string, unknown>), efficiency_detail: efficiencyDetail }
      : inserted;

  return NextResponse.json({ data, error: null }, { status: 201 });
}
