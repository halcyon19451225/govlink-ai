export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { assemblePackage } from "@/lib/improvement/handover";

type Params = { params: { id: string; handoverId: string } };

const MODULE = "self_evaluation";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().nullable().optional(),
  /** 次期計画のプロジェクトID */
  target_project_id: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "finalized", "consumed"]).optional(),
  /** draft のあいだ、最新データでスナップショットを取り直す */
  refresh: z.boolean().optional(),
});

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
  const d = parsed.data;

  const current = await queryOne<{ status: string; package: Record<string, unknown> }>(
    `SELECT status, package FROM plan_handovers
     WHERE id = $1 AND source_project_id = $2`,
    [params.handoverId, params.id],
  );
  if (!current) {
    return NextResponse.json({ data: null, error: "引き継ぎが見つかりません" }, { status: 404 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if (d.title !== undefined) {
    sets.push(`title = $${i++}`);
    vals.push(d.title);
  }
  if (d.target_project_id !== undefined) {
    sets.push(`target_project_id = $${i++}`);
    vals.push(d.target_project_id);
  }

  // スナップショットの更新は確定前のみ。
  // 確定後は「以後、元データが変わっても引き継ぎ内容は動かない」を守る。
  const wantsSnapshotChange = d.refresh === true || d.notes !== undefined;
  if (wantsSnapshotChange) {
    if (current.status !== "draft") {
      return NextResponse.json(
        { data: null, error: "確定済みの引き継ぎ内容は変更できません" },
        { status: 409 },
      );
    }
    const pkg = d.refresh ? await assemblePackage(params.id) : current.package;
    if (d.notes !== undefined) {
      (pkg as Record<string, unknown>).notes = d.notes ?? "";
    }
    sets.push(`package = $${i++}::jsonb`);
    vals.push(JSON.stringify(pkg));
  }

  if (d.status !== undefined) {
    sets.push(`status = $${i++}`);
    vals.push(d.status);
    if (d.status === "finalized") sets.push("finalized_at = now()");
    if (d.status === "consumed") sets.push("consumed_at = now()");
  }

  if (sets.length === 0) {
    return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  }

  vals.push(params.handoverId, params.id);

  const row = await queryOne(
    `UPDATE plan_handovers SET ${sets.join(", ")}
     WHERE id = $${i++} AND source_project_id = $${i}
     RETURNING id, title, target_project_id, status, package,
               finalized_at::text, consumed_at::text, updated_at::text`,
    vals,
  );

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string }>(
    `DELETE FROM plan_handovers WHERE id = $1 AND source_project_id = $2 RETURNING id`,
    [params.handoverId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "引き継ぎが見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: row.id }, error: null });
}
