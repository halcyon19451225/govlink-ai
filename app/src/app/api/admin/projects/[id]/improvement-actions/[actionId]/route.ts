export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; actionId: string } };

const MODULE = "self_evaluation";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().nullable().optional(),
  root_cause: z.string().nullable().optional(),
  owner_department: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  fiscal_year: z.number().int().nullable().optional(),
  status: z.enum(["proposed", "adopted", "in_progress", "done", "dropped"]).optional(),
  priority: z.number().int().nullable().optional(),
  carry_over: z.boolean().optional(),
  // 反映先（5系統）
  reflect_schedule_task_id: z.string().uuid().nullable().optional(),
  reflect_kpi_id: z.string().uuid().nullable().optional(),
  reflect_measure_design_id: z.string().uuid().nullable().optional(),
  reflect_logic_model_id: z.string().uuid().nullable().optional(),
  reflect_issue_hypothesis_id: z.string().uuid().nullable().optional(),
  reflection_note: z.string().nullable().optional(),
});

const COLS = [
  "title",
  "detail",
  "root_cause",
  "owner_department",
  "owner_name",
  "due_date",
  "fiscal_year",
  "status",
  "priority",
  "carry_over",
  "reflect_schedule_task_id",
  "reflect_kpi_id",
  "reflect_measure_design_id",
  "reflect_logic_model_id",
  "reflect_issue_hypothesis_id",
  "reflection_note",
] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
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
  const d = parsed.data as Record<string, unknown>;

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  for (const col of COLS) {
    if (col in d && d[col] !== undefined) {
      sets.push(`${col} = $${i++}`);
      // 空文字の日付は NULL として扱う
      vals.push(col === "due_date" ? (d[col] || null) : (d[col] ?? null));
    }
  }

  // 反映先がひとつでも設定されたら、反映した時刻を記録する
  const touchesReflect = [
    "reflect_schedule_task_id",
    "reflect_kpi_id",
    "reflect_logic_model_id",
    "reflect_issue_hypothesis_id",
  ].some((k) => k in d && d[k]);
  if (touchesReflect) sets.push("reflected_at = now()");

  if (sets.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  vals.push(params.actionId, params.id);

  const row = await queryOne(
    `UPDATE improvement_actions SET ${sets.join(", ")}
     WHERE id = $${i++} AND project_id = $${i}
     RETURNING id, status, reflected_at::text,
               reflect_schedule_task_id, reflect_kpi_id,
               reflect_logic_model_id, reflect_issue_hypothesis_id,
               carry_over, updated_at::text`,
    vals,
  );

  if (!row) {
    return NextResponse.json(
      { data: null, error: "改善アクションが見つかりません" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string }>(
    `DELETE FROM improvement_actions WHERE id = $1 AND project_id = $2 RETURNING id`,
    [params.actionId, params.id],
  );

  if (!row) {
    return NextResponse.json(
      { data: null, error: "改善アクションが見つかりません" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: { id: row.id }, error: null });
}
