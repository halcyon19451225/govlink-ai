export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; asisId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "view");
  if (deny) return deny;

  const row = await queryOne(
    `SELECT a.id, a.kpi_id, a.title, a.status, a.current_step,
            a.messages, a.swot, a.cross_analysis,
            a.created_at::text, a.updated_at::text, k.label AS kpi_label
     FROM asis_analyses a
     LEFT JOIN kpis k ON k.id = a.kpi_id
     WHERE a.id = $1 AND a.project_id = $2`,
    [params.asisId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: row, error: null });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["in_progress", "completed"]).optional(),
  swot: z.unknown().optional(),
  cross_analysis: z.unknown().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
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

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (parsed.data.title !== undefined) {
    sets.push(`title = $${i++}`);
    values.push(parsed.data.title);
  }
  if (parsed.data.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(parsed.data.status);
  }
  if (parsed.data.swot !== undefined) {
    sets.push(`swot = $${i++}::jsonb`);
    values.push(JSON.stringify(parsed.data.swot));
  }
  if (parsed.data.cross_analysis !== undefined) {
    sets.push(`cross_analysis = $${i++}::jsonb`);
    values.push(JSON.stringify(parsed.data.cross_analysis));
  }
  if (sets.length === 0) {
    return NextResponse.json({ data: null, error: "更新項目がありません" }, { status: 400 });
  }

  values.push(params.asisId, params.id);
  const rows = await query(
    `UPDATE asis_analyses SET ${sets.join(", ")}
     WHERE id = $${i++} AND project_id = $${i++}
     RETURNING id, status, title`,
    values,
  );
  if (rows.length === 0) {
    return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: rows[0], error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  const rows = await query(
    "DELETE FROM asis_analyses WHERE id = $1 AND project_id = $2 RETURNING id",
    [params.asisId, params.id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ data: null, error: "見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: params.asisId }, error: null });
}
