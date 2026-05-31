export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { recordArtifact, buildDatasetsSnapshot } from "@/lib/modules/recordArtifact";
import { ARTIFACT_TYPES } from "@/lib/modules/artifact-types";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const bodySchema = z.object({
  indicator_name: z.string().min(1, "指標名は必須です"),
  indicator_unit: z.string().optional().nullable(),
  data_source: z.string().min(1, "データソースは必須です"),
  current_value: z.number(),
  current_year: z.number().int(),
  target_value: z.number(),
  target_basis: z.string(),
  affected_population: z.number().optional().nullable(),
  trend: z.enum(["improving", "worsening", "stable", "unknown"]).default("unknown"),
  notes: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "gap_analysis", "view");
  if (deny) return deny;

  const rows = await query(
    `SELECT *,
            gap_value::float,
            current_value::float,
            target_value::float,
            affected_population::float
     FROM gap_analyses
     WHERE project_id = $1
     ORDER BY created_at`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "gap_analysis", "edit");
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

  const row = await queryOne<{ id: string }>(
    `INSERT INTO gap_analyses
       (project_id, indicator_name, indicator_unit, data_source,
        current_value, current_year, target_value, target_basis,
        affected_population, trend, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      params.id,
      d.indicator_name,
      d.indicator_unit ?? null,
      d.data_source,
      d.current_value,
      d.current_year,
      d.target_value,
      d.target_basis,
      d.affected_population ?? null,
      d.trend,
      d.notes ?? null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "DB登録に失敗しました" }, { status: 500 });
  }

  // 成果物レジストリに登録（R2-3/R2-4）
  const snapshot = await buildDatasetsSnapshot(params.id);
  await recordArtifact({
    projectId: params.id,
    moduleId: "gap_analysis",
    artifactType: ARTIFACT_TYPES.gap_analysis.gap_table,
    artifactRecordId: row.id,
    sourceDatasetsSnapshot: snapshot,
    derivationNote: `${d.indicator_name} のギャップ分析`,
  }).catch((e) => console.error("recordArtifact(gap_analysis) 失敗:", e));

  // 挿入したレコードを返す
  const inserted = await queryOne(
    `SELECT *,
            gap_value::float,
            current_value::float,
            target_value::float,
            affected_population::float
     FROM gap_analyses WHERE id = $1`,
    [row.id],
  );

  return NextResponse.json({ data: inserted, error: null }, { status: 201 });
}
