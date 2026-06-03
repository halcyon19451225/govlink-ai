export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, transaction } from "@/lib/db";

// ─── PATCH スキーマ ────────────────────────────────────────────────────────
const patchSchema = z.object({
  title:           z.string().min(1).optional(),
  description:     z.string().optional(),
  department_name: z.string().optional(),
  status:          z.enum(["draft", "active", "completed", "archived"]).optional(),
  plan_start_date: z.string().nullable().optional(),
  plan_end_date:   z.string().nullable().optional(),
  purpose:         z.string().nullable().optional(),
  major_policy:    z.string().nullable().optional(),
});

const goalSchema = z.object({
  id:          z.string().optional(),  // 既存の場合
  goal_number: z.number().int(),
  title:       z.string().min(1),
  description: z.string().default(""),
  sort_order:  z.number().int().default(0),
});

const patchBodySchema = patchSchema.extend({
  goals: z.array(goalSchema).optional(),
});

// ─── PATCH ───────────────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "バリデーションエラー" },
      { status: 422 }
    );
  }

  const { goals, ...fields } = parsed.data;

  // 更新フィールドを動的に組み立て
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  const fieldMap: Record<string, string> = {
    title:           "title",
    description:     "description",
    department_name: "department_name",
    status:          "status",
    plan_start_date: "plan_start_date",
    plan_end_date:   "plan_end_date",
    purpose:         "purpose",
    major_policy:    "major_policy",
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in fields && fields[key as keyof typeof fields] !== undefined) {
      setClauses.push(`${col} = $${paramIdx}`);
      values.push(fields[key as keyof typeof fields] ?? null);
      paramIdx++;
    }
  }

  setClauses.push(`updated_at = now()`);

  try {
    await transaction(async (client) => {
      // projects 更新
      if (setClauses.length > 1) {
        values.push(params.id);
        await client.query(
          `UPDATE projects SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
          values
        );
      }

      // goals の更新（提供された場合は全置換）
      if (goals !== undefined) {
        await client.query(
          "DELETE FROM project_goals WHERE project_id = $1",
          [params.id]
        );
        for (const g of goals) {
          await client.query(
            `INSERT INTO project_goals (project_id, goal_number, title, description, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [params.id, g.goal_number, g.title, g.description, g.sort_order]
          );
        }
      }
    });

    return NextResponse.json({ data: { id: params.id }, error: null });
  } catch (err) {
    console.error("PATCH /api/admin/projects/[id]", err);
    return NextResponse.json({ data: null, error: "更新に失敗しました" }, { status: 500 });
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const rows = await query(
    `SELECT p.id, p.title, p.description, p.status,
            p.department_name,
            p.plan_start_date::text, p.plan_end_date::text,
            p.purpose, p.major_policy,
            p.created_at,
            m.name AS municipality_name
     FROM projects p
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE p.id = $1`,
    [params.id]
  );

  if (!rows[0]) {
    return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
  }

  const goals = await query(
    `SELECT id, goal_number, title, description, sort_order
     FROM project_goals WHERE project_id = $1 ORDER BY sort_order, goal_number`,
    [params.id]
  );

  return NextResponse.json({ data: { ...rows[0], goals }, error: null });
}
