export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { normalizeSections } from "@/lib/plan/document";
import { chaptersOfDocKind, docKindOf, variantOfDocKind } from "@/lib/plan/evalReport";
import { gatherEvalTables } from "@/lib/plan/evalData";

type Params = { params: { id: string } };

const MODULE = "logic_model";

/**
 * 計画書・評価報告書の調製 — 文書のCRUD（PL2 P③ / PL3 A①）
 * doc パラメタで文書を切り替える: plan（variant='full'）/ eval（variant='evaluation_report'）
 * GET   … 文書＋出力履歴＋章定義（eval は印刷ビュー用の実データ表も返す）
 * PATCH … 手動編集（title / sections 全置換 / finalize・definalize）
 *         finalized の文書は編集不可（スナップショット固定 — 再編集は解除してから）
 */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const kind = docKindOf(req.nextUrl.searchParams.get("doc"));
  const variant = variantOfDocKind(kind);

  const doc = await queryOne(
    `SELECT id, project_id, variant, title, status, sections, layout,
            generated_at::text AS generated_at, finalized_at::text AS finalized_at,
            updated_at::text AS updated_at
     FROM plan_documents WHERE project_id = $1 AND variant = $2`,
    [params.id, variant],
  );
  const exports = doc
    ? await query(
        `SELECT id, variant, file_name, file_size_bytes, created_at::text AS created_at
         FROM plan_document_exports WHERE plan_document_id = $1
         ORDER BY created_at DESC LIMIT 30`,
        [(doc as { id: string }).id],
      )
    : [];

  // 評価報告書は印刷ビュー用の実データ表も同梱する（表はAIに書かせず実データから）
  let tables: unknown = null;
  if (kind === "eval") {
    tables = await gatherEvalTables(params.id);
  }
  // 説明資料は対象選択（取組別）用に施策の一覧を同梱する
  let measures: unknown = null;
  if (kind === "deck") {
    measures = await query(
      `SELECT id, title FROM measure_designs WHERE project_id = $1 ORDER BY sort_order, created_at LIMIT 50`,
      [params.id],
    );
  }

  return NextResponse.json({
    data: { doc: doc ?? null, exports, chapters: chaptersOfDocKind(kind), tables, measures },
    error: null,
  });
}

const patchSchema = z.object({
  doc: z.enum(["plan", "eval", "deck"]).optional(),
  title: z.string().min(1).max(200).optional(),
  sections: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  finalize: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
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
  const variant = variantOfDocKind(docKindOf(d.doc));

  const doc = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM plan_documents WHERE project_id = $1 AND variant = $2`,
    [params.id, variant],
  );
  if (!doc) {
    return NextResponse.json({ data: null, error: "文書がまだありません（先に「章立てを起こす」を実行）" }, { status: 404 });
  }
  if (doc.status === "finalized" && d.finalize !== false && (d.title !== undefined || d.sections !== undefined)) {
    return NextResponse.json(
      { data: null, error: "確定済みの文書は編集できません（確定を解除してください）" },
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
  if (d.sections !== undefined) {
    const normalized = normalizeSections(d.sections);
    add("sections = $N::jsonb", JSON.stringify(normalized));
  }
  if (d.finalize === true) {
    sets.push("status = 'finalized'", "finalized_at = now()");
  } else if (d.finalize === false) {
    sets.push("status = 'draft'", "finalized_at = NULL");
  }
  vals.push(doc.id);
  const row = await queryOne(
    `UPDATE plan_documents SET ${sets.join(", ")} WHERE id = $${vals.length}
     RETURNING id, status, finalized_at::text AS finalized_at, updated_at::text AS updated_at`,
    vals,
  );
  return NextResponse.json({ data: row, error: null });
}
