export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { assemblePackage } from "@/lib/improvement/handover";

type Params = { params: { id: string } };

const MODULE = "self_evaluation";

// 一覧＋未確定のプレビュー
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  if (req.nextUrl.searchParams.get("preview") === "true") {
    const pkg = await assemblePackage(params.id);
    return NextResponse.json({ data: { preview: pkg }, error: null });
  }

  const rows = await query(
    `SELECT h.id, h.source_project_id, h.target_project_id, h.title, h.fiscal_year,
            h.package, h.status, h.finalized_at::text, h.consumed_at::text,
            h.created_at::text, h.updated_at::text,
            p.title AS target_project_title
     FROM plan_handovers h
     LEFT JOIN projects p ON p.id = h.target_project_id
     WHERE h.source_project_id = $1
     ORDER BY h.created_at DESC`,
    [params.id],
  ).catch(() => []);

  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  fiscal_year: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  /** true で確定（スナップショットを固定する） */
  finalize: z.boolean().optional(),
});

// 引き継ぎパッケージを生成する
export async function POST(req: NextRequest, { params }: Params) {
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
    raw = {};
  }
  const parsed = createSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const pkg = await assemblePackage(params.id);
  pkg.notes = parsed.data.notes ?? "";

  const finalize = parsed.data.finalize === true;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO plan_handovers
       (source_project_id, title, fiscal_year, package, status, finalized_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING id`,
    [
      params.id,
      parsed.data.title ?? "次期計画への引き継ぎ",
      parsed.data.fiscal_year ?? null,
      JSON.stringify(pkg),
      finalize ? "finalized" : "draft",
      finalize ? new Date().toISOString() : null,
    ],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: row.id, package: pkg }, error: null }, { status: 201 });
}
