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
  evaluation_tier: z.enum(["needs", "theory", "process", "outcome", "cost"]),
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
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT pe.id, pe.evaluation_tier, pe.fiscal_year, pe.status, pe.result,
            pe.achievement_rate::float, pe.findings, pe.success_factors, pe.barrier_factors,
            pe.improvement_actions, pe.next_steps, pe.flow_decision_path, pe.kpi_ids,
            pe.evaluated_by, pe.ai_commentary, pe.logic_model_id, pe.created_at::text,
            json_build_object(
              'id', lm.id,
              'name', lm.name,
              'outputs', lm.outputs,
              'initial_outcomes', lm.initial_outcomes,
              'intermediate_outcomes', lm.intermediate_outcomes
            ) FILTER (WHERE lm.id IS NOT NULL) AS upstream_logic_model
     FROM program_evaluations pe
     LEFT JOIN logic_models lm ON lm.id = pe.logic_model_id
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

  // 成果物レジストリに登録（R2-3）
  if (inserted) {
    const tierToType: Record<string, string> = {
      process: ARTIFACT_TYPES.program_evaluation.process_eval,
      outcome_initial: ARTIFACT_TYPES.program_evaluation.initial_outcome_eval,
      outcome_intermediate: ARTIFACT_TYPES.program_evaluation.intermediate_outcome_eval,
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

  return NextResponse.json({ data: inserted, error: null }, { status: 201 });
}
