export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const SELECT_COLS = `
  id, project_id, source,
  program_evaluation_id, self_evaluation_entry_id, policy_suggestion_id, checkpoint_id,
  title, detail, root_cause,
  owner_department, owner_name,
  to_char(due_date, 'YYYY-MM-DD') AS due_date,
  fiscal_year, status, priority,
  reflect_schedule_task_id, reflect_kpi_id,
  reflect_logic_model_id, reflect_issue_hypothesis_id,
  reflected_at::text, reflection_note, carry_over,
  created_at::text, updated_at::text`;

// 改善は評価から生まれるため、権限は self_evaluation モジュールで判定する
// （A工程のモジュールキー。program_evaluation を持つ利用者は通常こちらも持つ）
const MODULE = "self_evaluation";

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const status = req.nextUrl.searchParams.get("status");
  const evalId = req.nextUrl.searchParams.get("evaluationId");

  const where: string[] = ["project_id = $1"];
  const vals: unknown[] = [params.id];
  if (status) {
    where.push(`status = $${vals.length + 1}`);
    vals.push(status);
  }
  if (evalId) {
    where.push(`program_evaluation_id = $${vals.length + 1}`);
    vals.push(evalId);
  }

  const rows = await query(
    `SELECT ${SELECT_COLS}
     FROM improvement_actions
     WHERE ${where.join(" AND ")}
     ORDER BY priority NULLS LAST, due_date NULLS LAST, created_at DESC`,
    vals,
  ).catch(() => []);

  return NextResponse.json({ data: rows, error: null });
}

const postSchema = z.object({
  source: z
    .enum([
      "program_evaluation",
      "self_evaluation",
      "ai_suggestion",
      "improvement_dialogue",
      "checkpoint",
      "manual",
    ])
    .default("manual"),
  program_evaluation_id: z.string().uuid().nullable().optional(),
  self_evaluation_entry_id: z.string().uuid().nullable().optional(),
  policy_suggestion_id: z.string().uuid().nullable().optional(),
  checkpoint_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, "改善アクションの見出しは必須です").max(200),
  detail: z.string().nullable().optional(),
  root_cause: z.string().nullable().optional(),
  owner_department: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  fiscal_year: z.number().int().nullable().optional(),
  status: z
    .enum(["proposed", "adopted", "in_progress", "done", "dropped"])
    .default("proposed"),
  priority: z.number().int().nullable().optional(),
  carry_over: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
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

  const row = await queryOne<{ id: string }>(
    `INSERT INTO improvement_actions
       (project_id, source, program_evaluation_id, self_evaluation_entry_id,
        policy_suggestion_id, checkpoint_id, title, detail, root_cause,
        owner_department, owner_name, due_date, fiscal_year, status, priority, carry_over)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      params.id,
      d.source,
      d.program_evaluation_id ?? null,
      d.self_evaluation_entry_id ?? null,
      d.policy_suggestion_id ?? null,
      d.checkpoint_id ?? null,
      d.title,
      d.detail ?? null,
      d.root_cause ?? null,
      d.owner_department ?? null,
      d.owner_name ?? null,
      d.due_date || null,
      d.fiscal_year ?? null,
      d.status,
      d.priority ?? null,
      d.carry_over ?? false,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "登録に失敗しました" }, { status: 500 });
  }

  // AI提案から起票した場合は、提案側にも採用の記録を残す
  if (d.policy_suggestion_id) {
    await queryOne(
      `UPDATE policy_suggestions
       SET status = 'adopted', improvement_action_id = $1
       WHERE id = $2 AND project_id = $3
       RETURNING id`,
      [row.id, d.policy_suggestion_id, params.id],
    ).catch((e) => console.error("policy_suggestions の採用記録に失敗:", e));
  }

  const created = await queryOne(
    `SELECT ${SELECT_COLS} FROM improvement_actions WHERE id = $1`,
    [row.id],
  );

  return NextResponse.json({ data: created, error: null }, { status: 201 });
}
