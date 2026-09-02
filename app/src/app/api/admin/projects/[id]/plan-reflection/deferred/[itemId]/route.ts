export const dynamic = "force-dynamic";

/**
 * 様式H3 の1件の更新（状態機械: deferred → re_proposed → adopted / dropped）。
 * 「見送り」を「消滅」にしない: 行は消さず、取り下げ（dropped）には理由を必須にする。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; itemId: string } };

const ALLOWED: Record<string, string[]> = {
  deferred: ["re_proposed", "dropped"],
  re_proposed: ["adopted", "deferred", "dropped"],
  adopted: [],
  dropped: ["deferred"],
};

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  detail: z.string().max(2000).nullable().optional(),
  source_ref: z.string().max(200).nullable().optional(),
  reason_kind: z.enum(["budget", "staff", "coordination", "verification", "other"]).optional(),
  reason: z.string().max(2000).nullable().optional(),
  review_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  condition: z.string().max(1000).nullable().optional(),
  status: z.enum(["deferred", "re_proposed", "adopted", "dropped"]).optional(),
  re_proposed_fiscal_year: z.number().int().nullable().optional(),
  status_note: z.string().max(1000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
  if (deny) return deny;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const d = parsed.data;
  const cur = await queryOne<{ status: string }>(
    `SELECT status FROM plan_deferred_items WHERE id = $1 AND project_id = $2`,
    [params.itemId, params.id],
  );
  if (!cur) return NextResponse.json({ data: null, error: "台帳の行が見つかりません" }, { status: 404 });
  if (d.status && d.status !== cur.status && !(ALLOWED[cur.status] ?? []).includes(d.status)) {
    return NextResponse.json({ data: null, error: `「${cur.status}」から「${d.status}」へは進められません` }, { status: 400 });
  }
  if (d.status === "dropped" && !(d.status_note ?? "").trim()) {
    return NextResponse.json({ data: null, error: "取り下げには理由（status_note）が必要です。「見送り」を「消滅」にしないため" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  for (const k of ["title", "detail", "source_ref", "reason_kind", "reason", "review_due", "condition", "status", "re_proposed_fiscal_year", "status_note"] as const) {
    if (d[k] !== undefined) add(k, d[k]);
  }
  if (sets.length === 0) return NextResponse.json({ data: null, error: "更新フィールドがありません" }, { status: 400 });
  vals.push(params.itemId, params.id);
  const row = await queryOne(
    `UPDATE plan_deferred_items SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND project_id = $${vals.length}
     RETURNING id, status, title`,
    vals,
  );
  return NextResponse.json({ data: row, error: null });
}
