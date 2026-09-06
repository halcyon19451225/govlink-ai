export const dynamic = "force-dynamic";

/**
 * 報告書1件分の手入力欄（plan_reflections — 061）の更新と、処遇の確定（G1-6・H4）。
 *
 * PATCH … 部分更新。
 *   - reflect_*（G1-8）／adoption（G2-4）／inquiry_*・opinions・stakeholder_opinions・resource_change（G4）
 *     ／reply_*・decided_on・decision_meeting（答申・H4-3）／set_notes（H1-9）→ plan_reflections へ upsert
 *   - decided_treatment／rationale（処遇の変更）→ program_evaluations（060）を更新し、
 *     履歴（decision_history）に stage 付きで追記。標準処遇と異なれば rationale_required=true
 * 施策構築のデータ（measure_designs）はここから書き換えない。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { treatmentDiffers } from "@/lib/evaluation/judgment";

type Params = { params: { id: string; evaluationId: string } };

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const bodySchema = z.object({
  reflect_kind: z.enum(["measure", "chapter", "not_adopted"]).nullable().optional(),
  reflect_measure_id: z.string().uuid().nullable().optional(),
  reflect_location: z.string().max(300).nullable().optional(),
  reflect_reason: z.string().max(2000).nullable().optional(),
  adoption: z.enum(["adopted", "partial", "rejected"]).nullable().optional(),
  inquiry_no: z.string().max(60).nullable().optional(),
  inquiry_date: dateStr.optional(),
  reply_due: dateStr.optional(),
  opinions: z.object({ a: z.string().max(2000).optional(), b: z.string().max(2000).optional(), c: z.string().max(2000).optional(), d: z.string().max(2000).optional() }).optional(),
  stakeholder_opinions: z.string().max(4000).nullable().optional(),
  resource_change: z
    .object({
      delta_amount: z.number().nullable().optional(),
      released_amount: z.number().nullable().optional(),
      reallocation_to: z.string().max(300).nullable().optional(),
      budget_neutral: z.boolean().nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
    })
    .optional(),
  reply_result: z.string().max(2000).nullable().optional(),
  reply_date: dateStr.optional(),
  decided_on: dateStr.optional(),
  decision_meeting: z.string().max(200).nullable().optional(),
  set_notes: z.record(z.string(), z.string().max(1000)).optional(),
  // 処遇の変更（G1-6・H4）。stage: council=処遇決定会議、reply=答申による修正
  decided_treatment: z.string().max(500).nullable().optional(),
  rationale: z.string().max(4000).nullable().optional(),
  decision_stage: z.enum(["draft", "council", "reply"]).optional(),
  decision_reason: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "edit");
  if (deny) return deny;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }
  const d = parsed.data;

  const ev = await queryOne<{ id: string; measure_design_id: string | null; standard_treatment: string | null; decided_treatment: string | null; rationale: string | null }>(
    `SELECT id, measure_design_id, standard_treatment, decided_treatment, rationale
       FROM program_evaluations WHERE id = $1 AND project_id = $2 AND measure_work_id IS NULL`,
    [params.evaluationId, params.id],
  );
  if (!ev || !ev.measure_design_id) {
    return NextResponse.json({ data: null, error: "主要施策評価が見つかりません" }, { status: 404 });
  }
  if (d.reflect_kind === "not_adopted" && !(d.reflect_reason ?? "").trim()) {
    return NextResponse.json({ data: null, error: "不採用とする場合は理由を記入してください（行き先として有効にするため）" }, { status: 400 });
  }
  if (d.reflect_measure_id) {
    // 次期施策はこの計画のクローンに属するものだけ（他計画を指せない）
    const ok = await queryOne<{ id: string }>(
      `SELECT md.id FROM measure_designs md JOIN projects p ON p.id = md.project_id
        WHERE md.id = $1 AND p.cloned_from_project_id = $2`,
      [d.reflect_measure_id, params.id],
    );
    if (!ok) return NextResponse.json({ data: null, error: "反映先の施策は、この計画の次期計画（クローン）の施策から選んでください" }, { status: 400 });
  }

  // ── 行を確保（無ければ作る）────────────────────────────
  const row = await queryOne<{ id: string; decision_history: unknown[] }>(
    `INSERT INTO plan_reflections (project_id, measure_design_id, evaluation_id, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (evaluation_id) DO UPDATE SET updated_at = now()
     RETURNING id, decision_history`,
    [params.id, ev.measure_design_id, ev.id, session?.user?.email ?? null],
  );
  if (!row) return NextResponse.json({ data: null, error: "保存に失敗しました" }, { status: 500 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown, cast = "") => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}${cast}`);
  };
  if (d.reflect_kind !== undefined) add("reflect_kind", d.reflect_kind);
  if (d.reflect_measure_id !== undefined) add("reflect_measure_id", d.reflect_measure_id);
  if (d.reflect_location !== undefined) add("reflect_location", d.reflect_location?.trim() || null);
  if (d.reflect_reason !== undefined) add("reflect_reason", d.reflect_reason?.trim() || null);
  if (d.adoption !== undefined) add("adoption", d.adoption);
  if (d.inquiry_no !== undefined) add("inquiry_no", d.inquiry_no?.trim() || null);
  if (d.inquiry_date !== undefined) add("inquiry_date", d.inquiry_date);
  if (d.reply_due !== undefined) add("reply_due", d.reply_due);
  if (d.opinions !== undefined) add("opinions", JSON.stringify(d.opinions), "::jsonb");
  if (d.stakeholder_opinions !== undefined) add("stakeholder_opinions", d.stakeholder_opinions?.trim() || null);
  if (d.resource_change !== undefined) add("resource_change", JSON.stringify(d.resource_change), "::jsonb");
  if (d.reply_result !== undefined) add("reply_result", d.reply_result?.trim() || null);
  if (d.reply_date !== undefined) add("reply_date", d.reply_date);
  if (d.decided_on !== undefined) add("decided_on", d.decided_on);
  if (d.decision_meeting !== undefined) add("decision_meeting", d.decision_meeting?.trim() || null);
  if (d.set_notes !== undefined) add("set_notes", JSON.stringify(d.set_notes), "::jsonb");

  // ── 処遇の変更（G1-6 履歴・H4）───────────────────────
  let rationaleRequired: boolean | null = null;
  if (d.decided_treatment !== undefined || d.rationale !== undefined) {
    const decided = d.decided_treatment !== undefined ? (d.decided_treatment?.trim() || null) : ev.decided_treatment;
    const rationale = d.rationale !== undefined ? (d.rationale?.trim() || null) : ev.rationale;
    rationaleRequired = treatmentDiffers(ev.standard_treatment, decided);
    if (rationaleRequired && !rationale && d.decision_stage && d.decision_stage !== "draft") {
      return NextResponse.json({ data: null, error: "標準処遇と異なる決定処遇を確定するには理由書（H4）が必須です" }, { status: 400 });
    }
    await query(
      `UPDATE program_evaluations
          SET decided_treatment = $1, rationale = $2, rationale_required = $3
        WHERE id = $4 AND project_id = $5`,
      [decided, rationale, rationaleRequired, ev.id, params.id],
    );
    if (d.decided_treatment !== undefined && decided !== ev.decided_treatment) {
      const hist = Array.isArray(row.decision_history) ? row.decision_history : [];
      hist.push({
        at: new Date().toISOString(),
        by: session?.user?.email ?? null,
        stage: d.decision_stage ?? "draft",
        decided_treatment: decided,
        reason: d.decision_reason?.trim() || null,
      });
      add("decision_history", JSON.stringify(hist), "::jsonb");
    }
  }

  if (sets.length > 0) {
    vals.push(row.id);
    await query(`UPDATE plan_reflections SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  }

  return NextResponse.json({ data: { id: row.id, rationale_required: rationaleRequired }, error: null });
}
