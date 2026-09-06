export const dynamic = "force-dynamic";

/**
 * 指標の実績値（measure_indicator_results — 058）。
 *
 * GET    … ?indicatorId= でその指標の履歴、無指定で施策全体の実績（最新判定は画面側）
 * POST   … 1件登録（手入力）。実績は履歴で持つ — 既存行の上書きはしない
 * PATCH  … 1件修正（入力ミスの訂正）。自動集計値を手で直すと auto_computed が外れる
 * DELETE … 1件削除。自動集計値（auto_tasks）は評価の承認時に凍結されたものなので消せない
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import type { IndicatorResultRow } from "@/lib/measure/results";

type Params = { params: { id: string; measureId: string } };

const RESULT_COLS = `r.id, r.measure_indicator_id, r.checkpoint_id, r.fiscal_year,
       to_char(r.measured_on, 'YYYY-MM-DD') AS measured_on,
       r.value::float AS value, r.value_text, r.note, r.source, r.auto_computed,
       r.created_at::text AS created_at`;

/** 指標がこの計画・この施策のものであることを確かめる（他計画の指標に書かせない） */
async function indicatorOf(projectId: string, measureId: string, indicatorId: string) {
  return queryOne<{ id: string }>(
    `SELECT id FROM measure_indicators
      WHERE id = $1 AND project_id = $2 AND measure_design_id = $3`,
    [indicatorId, projectId, measureId],
  );
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const indicatorId = req.nextUrl.searchParams.get("indicatorId");
  if (indicatorId) {
    const ind = await indicatorOf(params.id, params.measureId, indicatorId);
    if (!ind) {
      return NextResponse.json({ data: null, error: "指標が見つかりません" }, { status: 404 });
    }
    const rows = await query<IndicatorResultRow>(
      `SELECT ${RESULT_COLS}
         FROM measure_indicator_results r
        WHERE r.measure_indicator_id = $1
        ORDER BY COALESCE(r.measured_on, r.created_at::date), r.created_at`,
      [indicatorId],
    );
    return NextResponse.json({ data: rows, error: null });
  }

  const rows = await query<IndicatorResultRow>(
    `SELECT ${RESULT_COLS}
       FROM measure_indicator_results r
       JOIN measure_indicators i ON i.id = r.measure_indicator_id
      WHERE i.project_id = $1 AND i.measure_design_id = $2
      ORDER BY COALESCE(r.measured_on, r.created_at::date), r.created_at
      LIMIT 1000`,
    [params.id, params.measureId],
  );
  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  measure_indicator_id: z.string().uuid(),
  checkpoint_id: z.string().uuid().nullish(),
  fiscal_year: z.number().int().min(1989).max(2200).nullish(),
  measured_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  value: z.number().finite().nullish(),
  value_text: z.string().max(500).nullish(),
  note: z.string().max(2000).nullish(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "入力の形式が不正です" }, { status: 400 });
  }
  const d = parsed.data;
  if (d.value == null && !d.value_text) {
    return NextResponse.json(
      { data: null, error: "実績値（数値または記述）を入力してください" },
      { status: 400 },
    );
  }

  const ind = await indicatorOf(params.id, params.measureId, d.measure_indicator_id);
  if (!ind) {
    return NextResponse.json({ data: null, error: "指標が見つかりません" }, { status: 404 });
  }
  if (d.checkpoint_id) {
    const cp = await queryOne<{ id: string }>(
      `SELECT id FROM measure_indicator_checkpoints
        WHERE id = $1 AND measure_indicator_id = $2`,
      [d.checkpoint_id, d.measure_indicator_id],
    );
    if (!cp) {
      return NextResponse.json({ data: null, error: "評価時点が見つかりません" }, { status: 400 });
    }
  }

  const rows = await query<IndicatorResultRow>(
    `INSERT INTO measure_indicator_results
       (measure_indicator_id, checkpoint_id, fiscal_year, measured_on,
        value, value_text, note, source, auto_computed, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', false, $8)
     RETURNING ${RESULT_COLS.replaceAll("r.", "")}`,
    [
      d.measure_indicator_id,
      d.checkpoint_id ?? null,
      d.fiscal_year ?? null,
      d.measured_on ?? null,
      d.value ?? null,
      d.value_text ?? null,
      d.note ?? null,
      session?.user?.email ?? null,
    ],
  );
  return NextResponse.json({ data: rows[0], error: null });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int().min(1989).max(2200).nullish(),
  measured_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  value: z.number().finite().nullish(),
  value_text: z.string().max(500).nullish(),
  note: z.string().max(2000).nullish(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "入力の形式が不正です" }, { status: 400 });
  }
  const d = parsed.data;

  // 行 → 指標 → この計画・施策のものであることを確かめてから更新
  const rows = await query<IndicatorResultRow>(
    `UPDATE measure_indicator_results r
        SET fiscal_year = COALESCE($2, r.fiscal_year),
            measured_on = COALESCE($3::date, r.measured_on),
            value       = COALESCE($4, r.value),
            value_text  = COALESCE($5, r.value_text),
            note        = COALESCE($6, r.note),
            -- 自動集計値を手で直したら印を外す（auto_filled と同じ規約）
            auto_computed = CASE WHEN $4 IS NOT NULL OR $5 IS NOT NULL
                                 THEN false ELSE r.auto_computed END,
            updated_at  = now()
      WHERE r.id = $1
        AND r.measure_indicator_id IN (
              SELECT id FROM measure_indicators
               WHERE project_id = $7 AND measure_design_id = $8)
      RETURNING ${RESULT_COLS}`,
    [
      d.id,
      d.fiscal_year ?? null,
      d.measured_on ?? null,
      d.value ?? null,
      d.value_text ?? null,
      d.note ?? null,
      params.id,
      params.measureId,
    ],
  );
  if (!rows[0]) {
    return NextResponse.json({ data: null, error: "実績が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: rows[0], error: null });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ data: null, error: "id を指定してください" }, { status: 400 });
  }

  const rows = await query<{ id: string; source: string }>(
    `DELETE FROM measure_indicator_results r
      WHERE r.id = $1
        AND r.source <> 'auto_tasks'  -- 承認時に凍結された自動集計値は消せない
        AND r.measure_indicator_id IN (
              SELECT id FROM measure_indicators
               WHERE project_id = $2 AND measure_design_id = $3)
      RETURNING r.id, r.source`,
    [id, params.id, params.measureId],
  );
  if (!rows[0]) {
    return NextResponse.json(
      { data: null, error: "削除できません（凍結済みの自動集計値か、対象が見つかりません）" },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { id: rows[0].id }, error: null });
}
