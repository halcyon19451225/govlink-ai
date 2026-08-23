export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { normalizeMeasure } from "@/lib/measure/types";

type Params = { params: { id: string } };

// 施策データセット（EBPM）の一覧と作成。
// 形の定義は src/lib/measure/types.ts が正本。

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

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const rows = await query<Record<string, unknown>>(
    `SELECT ${SELECT_COLUMNS}
     FROM measure_designs
     WHERE project_id = $1
     ORDER BY sort_order, created_at`,
    [params.id],
  );

  return NextResponse.json({ data: rows.map(normalizeMeasure), error: null });
}

const postSchema = z.object({
  title: z.string().min(1, "施策名は必須です").max(200),
  issue_hypothesis_id: z.string().uuid().optional().nullable(),
  approach: z.string().optional().nullable(),
  target_population: z.string().optional().nullable(),
  intervention: z.string().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // 起点にした真因を写しとして保存する。
  // 課題仮説が後で修正されても「この施策が何を前提に設計されたか」が動かないように。
  let rootCauseSnapshot: string | null = null;
  if (d.issue_hypothesis_id) {
    const hyp = await queryOne<{ root_cause: string | null }>(
      `SELECT root_cause FROM issue_hypotheses WHERE id = $1 AND project_id = $2`,
      [d.issue_hypothesis_id, params.id],
    );
    rootCauseSnapshot = hyp?.root_cause ?? null;
  }

  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO measure_designs
       (project_id, title, issue_hypothesis_id, root_cause_snapshot,
        approach, target_population, intervention,
        sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM measure_designs WHERE project_id = $1))
     RETURNING ${SELECT_COLUMNS}`,
    [
      params.id,
      d.title,
      d.issue_hypothesis_id ?? null,
      rootCauseSnapshot,
      d.approach ?? null,
      d.target_population ?? null,
      d.intervention ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "登録に失敗しました" }, { status: 500 });
  }

  // 成果物レジストリ: 課題仮説 → 施策 のリネージ
  const sourceIds = await resolveArtifactIds(params.id, "issue_hypothesis", [
    d.issue_hypothesis_id,
  ]).catch(() => [] as string[]);
  await recordArtifact({
    projectId: params.id,
    moduleId: "measure_design",
    artifactType: "measure_dataset",
    artifactRecordId: String(row["id"]),
    sourceArtifactIds: sourceIds,
    derivationNote: d.issue_hypothesis_id
      ? `課題仮説(${d.issue_hypothesis_id})の真因から施策を構築`
      : undefined,
  }).catch((e) => console.error("recordArtifact(measure_design) 失敗:", e));

  return NextResponse.json({ data: normalizeMeasure(row), error: null }, { status: 201 });
}
