export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { kpiImportRows, sanitizeQuestions, sanitizeTargets } from "@/lib/report/types";

type Params = { params: { id: string; requestId: string; responseId: string } };

const MODULE = "program_evaluation";

/**
 * 回答のレビューと取り込み（S2 C①）
 * PATCH action:
 *   accept     … 受領（フォームを固定。以後KPI取り込みが可能に）
 *   return     … 差し戻し（note必須 — 回答フォームに理由が表示され再回答できる）
 *   remind     … 督促日を記録（reminded_at。URLの再送は管理者がコピーして行う）
 *   import_kpi … 受領済み回答の kpi_id つき数値回答を kpi_reports へ取り込み、
 *                既存の承認動作（reviewed_by/at 記録・kpis.current 更新）と同じ扱いで登録。
 *                取り込みボタンのクリックが人の確認（無確認の自動登録をしない）
 */
const bodySchema = z.object({
  action: z.enum(["accept", "return", "remind", "import_kpi"]),
  note: z.string().max(2000).optional(),
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "入力が不正です" }, { status: 400 });
  }
  const { action, note } = parsed.data;
  const reviewer = session?.user?.email ?? session?.user?.id ?? "unknown";

  // 依頼への帰属をJOINで確認
  const row = await queryOne<{
    id: string;
    status: string;
    answers: unknown;
    imported_at: string | null;
    target_key: string;
    form_def: unknown;
    targets: unknown;
    request_status: string;
    fiscal_year: number | null;
    kind: string;
    title: string;
  }>(
    `SELECT x.id, x.status, x.answers, x.imported_at::text AS imported_at, x.target_key,
            r.form_def, r.targets, r.status AS request_status, r.fiscal_year, r.kind, r.title
     FROM report_responses x
     JOIN report_requests r ON r.id = x.request_id
     WHERE x.id = $1 AND x.request_id = $2 AND r.project_id = $3`,
    [params.responseId, params.requestId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "回答が見つかりません" }, { status: 404 });
  }

  if (action === "accept") {
    if (row.status !== "answered") {
      return NextResponse.json({ data: null, error: "回答済みのもののみ受領できます" }, { status: 409 });
    }
    const updated = await queryOne(
      `UPDATE report_responses SET status = 'accepted', reviewed_by = $1, reviewed_note = $2
       WHERE id = $3 RETURNING id, status`,
      [reviewer, note?.trim() || null, params.responseId],
    );
    return NextResponse.json({ data: updated, error: null });
  }

  if (action === "return") {
    if (row.status !== "answered" && row.status !== "accepted") {
      return NextResponse.json({ data: null, error: "回答済み（または受領済み）のもののみ差し戻せます" }, { status: 409 });
    }
    if (!note?.trim()) {
      return NextResponse.json({ data: null, error: "差し戻し理由を入力してください（回答者に表示されます）" }, { status: 400 });
    }
    const updated = await queryOne(
      `UPDATE report_responses SET status = 'returned', reviewed_by = $1, reviewed_note = $2
       WHERE id = $3 RETURNING id, status`,
      [reviewer, note.trim(), params.responseId],
    );
    return NextResponse.json({ data: updated, error: null });
  }

  if (action === "remind") {
    const updated = await queryOne(
      `UPDATE report_responses SET reminded_at = now() WHERE id = $1
       RETURNING id, reminded_at::text AS reminded_at`,
      [params.responseId],
    );
    return NextResponse.json({ data: updated, error: null });
  }

  // ── import_kpi ─────────────────────────────────
  if (row.status !== "accepted") {
    return NextResponse.json({ data: null, error: "受領済みの回答のみ取り込めます" }, { status: 409 });
  }
  if (row.imported_at) {
    return NextResponse.json({ data: null, error: "この回答は取り込み済みです" }, { status: 409 });
  }
  const kpiRows2 = await query<{ id: string }>(`SELECT id FROM kpis WHERE project_id = $1`, [params.id]);
  const questions = sanitizeQuestions(row.form_def, new Set(kpiRows2.map((k) => k.id)), new Set<string>());
  const rows = kpiImportRows(
    questions,
    (row.answers && typeof row.answers === "object" ? row.answers : {}) as Record<string, unknown>,
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { data: null, error: "取り込めるKPI実績値の回答がありません（kpi_idつき数値設問への回答が必要）" },
      { status: 400 },
    );
  }
  const target = sanitizeTargets(row.targets).find((t) => t.target_key === row.target_key);
  const period = `${row.fiscal_year ?? new Date().getFullYear()}年度 ${row.kind === "annual" ? "年次" : "計画期間"}実績報告`;

  const imported = await transaction(async (client) => {
    let n = 0;
    for (const r of rows) {
      // 既存 kpi-reports 承認と同じ動作: approved で登録し current を更新
      // （受領＋この取り込みクリックが人の確認 — 無確認の自動登録をしない原則は維持）
      await client.query(
        `INSERT INTO kpi_reports
           (kpi_id, project_id, reported_by, reported_by_name, reported_value, report_period, comment,
            status, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, now())`,
        [
          r.kpi_id,
          params.id,
          `report_request:${params.requestId}`,
          target?.owner_department ?? target?.measure_title ?? "実績報告",
          r.value,
          period,
          `実績報告「${row.title}」より取り込み（設問: ${r.label}）`,
          reviewer,
        ],
      );
      await client.query(`UPDATE kpis SET current = $1 WHERE id = $2 AND project_id = $3`, [
        r.value,
        r.kpi_id,
        params.id,
      ]);
      n++;
    }
    await client.query(`UPDATE report_responses SET imported_at = now() WHERE id = $1`, [params.responseId]);
    return n;
  });

  return NextResponse.json({ data: { imported }, error: null });
}
