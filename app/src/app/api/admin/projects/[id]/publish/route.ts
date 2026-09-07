export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";

/**
 * 住民向け公開ページに出す／取り下げる
 *
 * 背景（claude/coe-tenant-isolation.md §11）:
 *   `/public/[slug]` は「その自治体で一番新しく作られた政策」を、status も見ずに
 *   公開していた。**何を公開するかを誰も選んでいなかった。**
 *   migration 064 で `projects.published_at` を追加し、既定を非公開にしたので、
 *   公開は明示的な操作になる。その操作の入口がここ。
 *
 * ⚠ 公開は住民に見せる行為なので、テナント境界に加えて
 *   **自治体の管理者（role=admin もしくは isOrgAdmin）**を要求する。
 *   モジュール別 RBAC（requireModulePermission）は使わない。
 *   公開は特定モジュールの編集ではなく、政策そのものの扱いを決める行為であり、
 *   対応する ModuleId も存在しないため。
 */
const bodySchema = z.object({
  published: z.boolean(),
});

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);

  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;

  if (!(session?.user?.isOrgAdmin || session?.user?.role === "admin")) {
    return NextResponse.json(
      { data: null, error: "公開の切り替えは管理者のみ行えます" },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { published } = parsed.data;

  await query(
    `UPDATE projects
        SET published_at = ${published ? "COALESCE(published_at, now())" : "NULL"},
            updated_at = now()
      WHERE id = $1`,
    [params.id],
  );

  const row = await queryOne<{ published_at: string | null; slug: string }>(
    `SELECT to_char(p.published_at, 'YYYY-MM-DD HH24:MI') AS published_at, m.slug
       FROM projects p
       JOIN municipalities m ON m.id = p.municipality_id
      WHERE p.id = $1`,
    [params.id],
  );

  console.warn(
    `[public] project=${params.id} を${published ? "公開" : "非公開に"}しました` +
      `（userRoleId=${session?.user?.userRoleId ?? "-"}）`,
  );

  return NextResponse.json({
    data: {
      published: row?.published_at != null,
      publishedAt: row?.published_at ?? null,
      // 公開URLは自治体スラグ単位。同じ自治体で複数公開した場合は
      // 最後に公開したものが出る（api/public/projects/[slug] の ORDER BY published_at DESC）
      publicPath: row?.slug ? `/public/${row.slug}` : null,
    },
    error: null,
  });
}
