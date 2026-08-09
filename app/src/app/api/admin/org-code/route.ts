export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, isPgError, PgErrorCode } from "@/lib/db";
import { isOrgAdmin } from "@/lib/permissions";
import { verifyOrgCode, mapOrdoPlanToCoe, invalidateOrgPlanCache } from "@/lib/org-license";

/**
 * 組織コード連携（Ordo 契約との紐づけ）
 * - GET:    現在の紐づけ状況
 * - POST:   { code } を検証して紐づけ（管理者のみ）
 * - DELETE: 紐づけ解除（管理者のみ）
 */

async function getContext(requireAdmin: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 }) };
  }
  const municipalityId = session.user.municipalityId;
  if (!municipalityId) {
    return { error: NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 }) };
  }
  if (requireAdmin) {
    const userRoleId = session.user.userRoleId;
    const admin =
      session.user.role === "admin" ||
      (userRoleId ? await isOrgAdmin(userRoleId) : false);
    if (!admin) {
      return { error: NextResponse.json({ data: null, error: "管理者権限が必要です" }, { status: 403 }) };
    }
  }
  return { municipalityId };
}

export async function GET() {
  const ctx = await getContext(false);
  if (ctx.error) return ctx.error;
  const row = await queryOne<{ org_code: string | null; org_name: string | null; org_linked_at: string | null }>(
    "SELECT org_code, org_name, org_linked_at::text FROM municipalities WHERE id = $1",
    [ctx.municipalityId],
  );
  const code = row?.org_code ?? null;
  return NextResponse.json({
    data: {
      linked: !!code,
      // コードは資格情報のため末尾4文字のみ返す
      codeMasked: code ? `****-${code.slice(-4)}` : null,
      orgName: row?.org_name ?? null,
      linkedAt: row?.org_linked_at ?? null,
    },
    error: null,
  });
}

const postSchema = z.object({ code: z.string().min(4).max(32) });

export async function POST(req: NextRequest) {
  const ctx = await getContext(true);
  if (ctx.error) return ctx.error;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "組織コードが不正です" }, { status: 400 });
  }
  const code = parsed.data.code.trim().toUpperCase();

  let lic;
  try {
    lic = await verifyOrgCode(code);
  } catch {
    return NextResponse.json({ data: null, error: "照会に失敗しました。時間をおいて再度お試しください" }, { status: 502 });
  }
  if (!lic || lic.reason === "not_found") {
    return NextResponse.json({ data: null, error: "組織コードが見つかりません" }, { status: 404 });
  }
  if (lic.reason === "product_mismatch") {
    return NextResponse.json({ data: null, error: "このコードは Coe 用ではありません" }, { status: 400 });
  }
  if (!lic.active) {
    return NextResponse.json({ data: null, error: "この契約は現在有効ではありません。Ordo までお問い合わせください" }, { status: 400 });
  }

  try {
    await query(
      `UPDATE municipalities
       SET org_code = $1, org_name = $2, org_linked_at = NOW()
       WHERE id = $3`,
      [code, lic.orgName, ctx.municipalityId],
    );
  } catch (e) {
    if (isPgError(e) && e.code === PgErrorCode.UNIQUE_VIOLATION) {
      return NextResponse.json({ data: null, error: "この組織コードは既に別の組織で使用されています" }, { status: 409 });
    }
    throw e;
  }
  invalidateOrgPlanCache(ctx.municipalityId);

  return NextResponse.json({
    data: {
      linked: true,
      orgName: lic.orgName,
      plan: mapOrdoPlanToCoe(lic.plan),
      licenseUntil: lic.licenseUntil,
    },
    error: null,
  });
}

export async function DELETE() {
  const ctx = await getContext(true);
  if (ctx.error) return ctx.error;
  await query(
    "UPDATE municipalities SET org_code = NULL, org_name = NULL, org_linked_at = NULL WHERE id = $1",
    [ctx.municipalityId],
  );
  invalidateOrgPlanCache(ctx.municipalityId);
  return NextResponse.json({ data: { linked: false }, error: null });
}
