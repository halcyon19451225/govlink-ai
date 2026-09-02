export const dynamic = "force-dynamic";

/** 様式H3 未反映事項台帳（plan_deferred_items — 061）: GET 一覧 / POST 登録 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const deferredSchema = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(2000).nullable().optional(),
  source_ref: z.string().max(200).nullable().optional(),
  reason_kind: z.enum(["budget", "staff", "coordination", "verification", "other"]).default("other"),
  reason: z.string().max(2000).nullable().optional(),
  review_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  condition: z.string().max(1000).nullable().optional(),
  evaluation_id: z.string().uuid().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;
  const rows = await query(
    `SELECT id, reflection_id, evaluation_id, title, detail, source_ref, reason_kind, reason,
            to_char(review_due, 'YYYY-MM-DD') AS review_due, condition, status, re_proposed_fiscal_year,
            status_note, created_at::text AS created_at
       FROM plan_deferred_items WHERE project_id = $1
      ORDER BY (status = 'deferred') DESC, review_due NULLS LAST, created_at`,
    [params.id],
  );
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
  if (deny) return deny;
  const parsed = deferredSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const d = parsed.data;
  // 出典の評価に紐づく plan_reflections があれば結線する
  const refl = d.evaluation_id
    ? await queryOne<{ id: string }>(`SELECT id FROM plan_reflections WHERE evaluation_id = $1 AND project_id = $2`, [d.evaluation_id, params.id])
    : null;
  const row = await queryOne(
    `INSERT INTO plan_deferred_items
       (project_id, reflection_id, evaluation_id, title, detail, source_ref, reason_kind, reason, review_due, condition, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, title, status, to_char(review_due, 'YYYY-MM-DD') AS review_due`,
    [params.id, refl?.id ?? null, d.evaluation_id ?? null, d.title.trim(), d.detail ?? null, d.source_ref ?? null,
     d.reason_kind, d.reason ?? null, d.review_due ?? null, d.condition ?? null, session?.user?.email ?? null],
  );
  return NextResponse.json({ data: row, error: null }, { status: 201 });
}
