export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import {
  normalizeMeasure,
  normalizeEvidenceItems,
  normalizeExperiment,
  normalizeSimpleIndicators,
  normalizeBudgetBreakdown,
  canConfirm,
} from "@/lib/measure/types";

type Params = { params: { id: string; measureId: string } };

const SELECT_COLUMNS = `
  id, project_id,
  issue_hypothesis_id, root_cause_snapshot, gap_analysis_ids, measure_dialogue_id,
  title, approach, target_population, target_size::float AS target_size,
  intervention, delivery,
  to_char(period_start, 'YYYY-MM-DD') AS period_start,
  to_char(period_end, 'YYYY-MM-DD') AS period_end,
  evidence_status, evidence_items, experiment,
  structure_indicators, process_indicators,
  kpi_ids_initial, kpi_ids_intermediate,
  total_budget::float AS total_budget, unit_cost::float AS unit_cost,
  cost_per_outcome_note, funding, budget_breakdown,
  owner_department, milestones, risks,
  status, sort_order, committed_at::text, created_at::text, updated_at::text
`;

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  issue_hypothesis_id: z.string().uuid().optional().nullable(),
  gap_analysis_ids: z.array(z.string().uuid()).optional(),
  approach: z.string().optional().nullable(),
  target_population: z.string().optional().nullable(),
  target_size: z.number().optional().nullable(),
  intervention: z.string().optional().nullable(),
  delivery: z.string().optional().nullable(),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  evidence_status: z.enum(["sufficient", "partial", "none"]).optional(),
  evidence_items: z.any().optional(),
  experiment: z.any().optional().nullable(),
  structure_indicators: z.any().optional(),
  process_indicators: z.any().optional(),
  kpi_ids_initial: z.array(z.string().uuid()).optional(),
  kpi_ids_intermediate: z.array(z.string().uuid()).optional(),
  total_budget: z.number().optional().nullable(),
  unit_cost: z.number().optional().nullable(),
  cost_per_outcome_note: z.string().optional().nullable(),
  budget_breakdown: z.any().optional(),
  funding: z.string().optional().nullable(),
  owner_department: z.string().optional().nullable(),
  milestones: z.any().optional(),
  risks: z.any().optional(),
  status: z.enum(["draft", "confirmed"]).optional(),
  sort_order: z.number().int().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${SELECT_COLUMNS} FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [params.measureId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: normalizeMeasure(row), error: null });
}

export async function PATCH(req: NextRequest, { params }: Params) {
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

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const add = (col: string, val: unknown, cast = "") => {
    fields.push(`${col} = $${idx++}${cast}`);
    values.push(val);
  };

  if (d.title !== undefined) add("title", d.title);
  if (d.issue_hypothesis_id !== undefined) add("issue_hypothesis_id", d.issue_hypothesis_id);
  if (d.gap_analysis_ids !== undefined) add("gap_analysis_ids", d.gap_analysis_ids, "::uuid[]");
  if (d.approach !== undefined) add("approach", d.approach);
  if (d.target_population !== undefined) add("target_population", d.target_population);
  if (d.target_size !== undefined) add("target_size", d.target_size);
  if (d.intervention !== undefined) add("intervention", d.intervention);
  if (d.delivery !== undefined) add("delivery", d.delivery);
  if (d.period_start !== undefined) add("period_start", d.period_start);
  if (d.period_end !== undefined) add("period_end", d.period_end);
  if (d.evidence_status !== undefined) add("evidence_status", d.evidence_status);
  // JSONB は正規化してから書く。DBに入る形を常に一定へ（elements.ts と同じ方針）
  if (d.evidence_items !== undefined)
    add("evidence_items", JSON.stringify(normalizeEvidenceItems(d.evidence_items)), "::jsonb");
  if (d.experiment !== undefined) {
    const exp = normalizeExperiment(d.experiment);
    add("experiment", exp ? JSON.stringify(exp) : null, "::jsonb");
  }
  if (d.structure_indicators !== undefined)
    add(
      "structure_indicators",
      JSON.stringify(normalizeSimpleIndicators(d.structure_indicators, "st")),
      "::jsonb",
    );
  if (d.process_indicators !== undefined)
    add(
      "process_indicators",
      JSON.stringify(normalizeSimpleIndicators(d.process_indicators, "pr")),
      "::jsonb",
    );
  if (d.kpi_ids_initial !== undefined) add("kpi_ids_initial", d.kpi_ids_initial, "::uuid[]");
  if (d.kpi_ids_intermediate !== undefined)
    add("kpi_ids_intermediate", d.kpi_ids_intermediate, "::uuid[]");
  if (d.total_budget !== undefined) add("total_budget", d.total_budget);
  if (d.unit_cost !== undefined) add("unit_cost", d.unit_cost);
  if (d.cost_per_outcome_note !== undefined)
    add("cost_per_outcome_note", d.cost_per_outcome_note);
  if (d.budget_breakdown !== undefined)
    add("budget_breakdown", JSON.stringify(normalizeBudgetBreakdown(d.budget_breakdown)), "::jsonb");
  if (d.funding !== undefined) add("funding", d.funding);
  if (d.owner_department !== undefined) add("owner_department", d.owner_department);
  if (d.milestones !== undefined) add("milestones", JSON.stringify(d.milestones ?? []), "::jsonb");
  if (d.risks !== undefined) add("risks", JSON.stringify(d.risks ?? []), "::jsonb");
  if (d.sort_order !== undefined) add("sort_order", d.sort_order);

  // ── 確定（承認済み方針: エビデンス十分 or 実験設計あり）────
  // DBにも同じCHECK制約があるが、ここで先に判定して理由を返す。
  // CHECK違反のエラーは利用者に読めない（無音の失敗と同類になる）ため。
  if (d.status !== undefined) {
    if (d.status === "confirmed") {
      const current = await queryOne<Record<string, unknown>>(
        `SELECT ${SELECT_COLUMNS} FROM measure_designs WHERE id = $1 AND project_id = $2`,
        [params.measureId, params.id],
      );
      if (!current) {
        return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
      }
      // 今回のPATCHで同時に変わる値も反映した状態で判定する
      const merged = normalizeMeasure({ ...current, ...raw as Record<string, unknown> });
      const verdict = canConfirm(merged);
      if (!verdict.ok) {
        return NextResponse.json({ data: null, error: verdict.reason }, { status: 422 });
      }
      add("status", "confirmed");
      fields.push("committed_at = COALESCE(committed_at, now())");
    } else {
      add("status", d.status);
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  values.push(params.measureId, params.id);
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE measure_designs SET ${fields.join(", ")}
     WHERE id = $${idx++} AND project_id = $${idx}
     RETURNING ${SELECT_COLUMNS}`,
    values,
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: normalizeMeasure(row), error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [params.measureId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }
  if (row.status === "confirmed") {
    // 確定済みの施策はロジックモデル・評価が前提にしている可能性がある。
    // 黙って消さず、まず下書きに戻す操作を求める。
    return NextResponse.json(
      { data: null, error: "確定済みの施策は削除できません。先に下書きへ戻してください" },
      { status: 422 },
    );
  }

  await queryOne(
    `DELETE FROM measure_designs WHERE id = $1 AND project_id = $2 RETURNING id`,
    [params.measureId, params.id],
  );
  return NextResponse.json({ data: { deleted: true }, error: null });
}
