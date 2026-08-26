export const dynamic = "force-dynamic";

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { sanitizeQuestions, sanitizeTargets } from "@/lib/report/types";

type Params = { params: { id: string; requestId: string } };

const MODULE = "program_evaluation";

/**
 * 実績報告依頼の詳細・編集・送信・締切（S2 C①)
 * GET    … 依頼＋回答一覧（トークンURL含む — 管理者が配布・督促に使う）
 * PATCH  … draft中の編集（title/instruction/form_def/due_date）
 *          action: send  → 対象ごとの回答行＋トークンを発行して sent（1トランザクション）
 *          action: close → 受付終了（公開フォームは以後404相当の案内）
 *          action: reopen → closed を sent に戻す
 * DELETE … draft のみ削除
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const request = await queryOne(
    `SELECT id, kind, fiscal_year, to_char(due_date, 'YYYY-MM-DD') AS due_date,
            title, instruction, form_def, targets, status,
            created_at::text AS created_at, sent_at::text AS sent_at, closed_at::text AS closed_at
     FROM report_requests WHERE id = $1 AND project_id = $2`,
    [params.requestId, params.id],
  );
  if (!request) {
    return NextResponse.json({ data: null, error: "依頼が見つかりません" }, { status: 404 });
  }
  const responses = await query(
    `SELECT id, target_key, token, status, answers,
            answered_at::text AS answered_at, reviewed_note, reviewed_by,
            imported_at::text AS imported_at, reminded_at::text AS reminded_at
     FROM report_responses WHERE request_id = $1 ORDER BY created_at`,
    [params.requestId],
  );
  return NextResponse.json({ data: { request, responses }, error: null });
}

const patchSchema = z.object({
  action: z.enum(["send", "close", "reopen"]).optional(),
  title: z.string().min(1).max(200).optional(),
  instruction: z.string().max(4000).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  form_def: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
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

  const request = await queryOne<{ id: string; status: string; targets: unknown; project_id: string }>(
    `SELECT id, status, targets, project_id FROM report_requests WHERE id = $1 AND project_id = $2`,
    [params.requestId, params.id],
  );
  if (!request) {
    return NextResponse.json({ data: null, error: "依頼が見つかりません" }, { status: 404 });
  }

  // ── 送信: 対象ごとの回答行＋トークンを発行（無確認の自動送信をしない — このボタンが確認） ──
  if (d.action === "send") {
    if (request.status !== "draft") {
      return NextResponse.json({ data: null, error: "すでに送信済みです" }, { status: 409 });
    }
    const targets = sanitizeTargets(request.targets);
    if (targets.length === 0) {
      return NextResponse.json({ data: null, error: "割当先がありません" }, { status: 400 });
    }
    await transaction(async (client) => {
      for (const t of targets) {
        const token = randomBytes(24).toString("base64url");
        await client.query(
          `INSERT INTO report_responses (request_id, target_key, token)
           VALUES ($1, $2, $3)
           ON CONFLICT (request_id, target_key) DO NOTHING`,
          [params.requestId, t.target_key, token],
        );
      }
      await client.query(
        `UPDATE report_requests SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1`,
        [params.requestId],
      );
    });
    return NextResponse.json({ data: { id: params.requestId, status: "sent" }, error: null });
  }

  if (d.action === "close") {
    if (request.status !== "sent") {
      return NextResponse.json({ data: null, error: "送信済みの依頼のみ締め切れます" }, { status: 409 });
    }
    await query(
      `UPDATE report_requests SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
      [params.requestId],
    );
    return NextResponse.json({ data: { id: params.requestId, status: "closed" }, error: null });
  }

  if (d.action === "reopen") {
    if (request.status !== "closed") {
      return NextResponse.json({ data: null, error: "締切済みの依頼のみ再開できます" }, { status: 409 });
    }
    await query(
      `UPDATE report_requests SET status = 'sent', closed_at = NULL, updated_at = now() WHERE id = $1`,
      [params.requestId],
    );
    return NextResponse.json({ data: { id: params.requestId, status: "sent" }, error: null });
  }

  // ── draft 中の編集 ─────────────────────────────
  if (request.status !== "draft") {
    return NextResponse.json(
      { data: null, error: "送信後は設問・依頼文を変更できません（回答との対応が壊れるため）" },
      { status: 409 },
    );
  }
  const sets: string[] = ["updated_at = now()"];
  const vals: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    sets.push(sql.replace("$N", `$${vals.length}`));
  };
  if (d.title !== undefined) add("title = $N", d.title.trim());
  if (d.instruction !== undefined) add("instruction = $N", d.instruction.trim());
  if (d.due_date !== undefined) add("due_date = $N", d.due_date);
  if (d.form_def !== undefined) {
    // 実在ID検証のため現行のKPI・施策集合で再サニタイズ
    const [kpis, measures] = await Promise.all([
      query<{ id: string }>(`SELECT id FROM kpis WHERE project_id = $1`, [params.id]),
      query<{ id: string }>(`SELECT id FROM measure_designs WHERE project_id = $1`, [params.id]),
    ]);
    const questions = sanitizeQuestions(
      d.form_def,
      new Set(kpis.map((k) => k.id)),
      new Set(measures.map((m) => m.id)),
    );
    add("form_def = $N::jsonb", JSON.stringify(questions));
  }
  vals.push(params.requestId);
  const row = await queryOne(
    `UPDATE report_requests SET ${sets.join(", ")} WHERE id = $${vals.length}
     RETURNING id, updated_at::text AS updated_at`,
    vals,
  );
  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string }>(
    `DELETE FROM report_requests WHERE id = $1 AND project_id = $2 AND status = 'draft' RETURNING id`,
    [params.requestId, params.id],
  );
  if (!row) {
    return NextResponse.json(
      { data: null, error: "削除できるのは下書きの依頼のみです（送信済みは締切を使ってください）" },
      { status: 409 },
    );
  }
  return NextResponse.json({ data: { id: row.id }, error: null });
}
