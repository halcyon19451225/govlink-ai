export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireChildRowAccess } from "@/lib/tenant";
import { query } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  comment: z.string().optional().nullable(),
});

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界（claude/coe-tenant-isolation.md A-6）。
  // URL は子リソースの id を指すので、kpi_reports → projects と辿って所属自治体を確認する
  const outOfTenant = await requireChildRowAccess(session, "kpi_reports", params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const reviewerId = session.user?.id ?? "unknown";

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { status } = parsed.data;

  const result = await query<{ id: string; kpi_id: string; reported_value: number }>(
    `UPDATE kpi_reports
     SET status = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3
     RETURNING id, kpi_id, reported_value::float`,
    [status, reviewerId, params.id],
  );

  const report = result[0];
  if (!report) {
    return NextResponse.json({ data: null, error: "報告が見つかりません" }, { status: 404 });
  }

  // 承認時: KPIのcurrent値を更新
  if (status === "approved") {
    await query(
      "UPDATE kpis SET current = $1 WHERE id = $2",
      [report.reported_value, report.kpi_id],
    );
  }

  return NextResponse.json({ data: { id: params.id, status }, error: null });
}
