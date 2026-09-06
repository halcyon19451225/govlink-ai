export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { normalizeExperiment, EXPERIMENT_DESIGN_META } from "@/lib/measure/types";
import type { ExperimentDesignKey } from "@/lib/measure/types";
import { EXPERIMENT_RESULT_COLUMNS as RESULT_COLUMNS } from "@/lib/measure/experimentResult";

type Params = { params: { id: string; measureId: string } };

// 実験結果の一覧・記録 — X2（エビデンス循環）
// 施策の実験設計（D区画）を実施した結果をここに記録し、
// 確定 → 昇格で「参照可能なエビデンス」になる。

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT ${RESULT_COLUMNS} FROM experiment_results
     WHERE measure_design_id = $1 AND project_id = $2
     ORDER BY created_at DESC`,
    [params.measureId, params.id],
  );
  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  design: z
    .enum(["rct", "cluster_rct", "stepped_wedge", "waitlist", "did", "matching", "prepost"])
    .optional(),
  implemented_as_planned: z.boolean().optional(),
  deviation_note: z.string().max(2000).optional().nullable(),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  sample_size: z.number().int().min(0).optional().nullable(),
  primary_outcome: z.string().max(400).optional().nullable(),
  result_summary: z.string().trim().min(1, "結果の要約は必須です").max(4000),
  effect_direction: z.enum(["improved", "no_change", "worsened", "unclear"]).optional(),
  effect_size: z.string().max(400).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const measure = await queryOne<{ id: string; experiment: unknown }>(
    `SELECT id, experiment FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [params.measureId, params.id],
  );
  if (!measure) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }

  // 設計は明示指定が無ければ施策のD区画から写す（何の設計で得た結果かを固定する）
  let design: ExperimentDesignKey | null = parsed.data.design ?? null;
  if (!design) {
    const exp = normalizeExperiment(measure.experiment);
    design = exp?.design ?? null;
  }
  if (!design || !EXPERIMENT_DESIGN_META[design]) {
    return NextResponse.json(
      {
        data: null,
        error:
          "実験設計が特定できません。施策に実験設計（D区画）が無い場合は design を指定してください",
      },
      { status: 422 },
    );
  }

  const d = parsed.data;
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO experiment_results
       (project_id, measure_design_id, design, implemented_as_planned, deviation_note,
        period_start, period_end, sample_size, primary_outcome,
        result_summary, effect_direction, effect_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${RESULT_COLUMNS}`,
    [
      params.id,
      params.measureId,
      design,
      d.implemented_as_planned ?? true,
      d.deviation_note ?? null,
      d.period_start ?? null,
      d.period_end ?? null,
      d.sample_size ?? null,
      d.primary_outcome ?? null,
      d.result_summary,
      d.effect_direction ?? "unclear",
      d.effect_size ?? null,
    ],
  );

  return NextResponse.json({ data: row, error: null }, { status: 201 });
}
