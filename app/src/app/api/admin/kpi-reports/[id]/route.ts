export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireChildRowAccess } from "@/lib/tenant";
import { query } from "@/lib/db";
import { actorFromSession } from "@/lib/activity";
import { recordValue } from "@/lib/indicator/service";

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

  const result = await query<{ id: string; kpi_id: string; project_id: string; reported_value: number; report_period: string | null }>(
    `UPDATE kpi_reports
     SET status = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3
     RETURNING id, kpi_id, project_id, reported_value::float, report_period`,
    [status, reviewerId, params.id],
  );

  const report = result[0];
  if (!report) {
    return NextResponse.json({ data: null, error: "報告が見つかりません" }, { status: 404 });
  }

  // 承認時: 指標の実績値を履歴に積む。
  // 069 以降、`current` という上書きされる1列は無い。承認した日を基準日とし、
  // どの報告から入った値かを inputs に残す（設計 §9-4）
  if (status === "approved") {
    await recordValue(actorFromSession(session, "ui"), report.project_id, report.kpi_id, {
      asOf: new Date().toISOString().slice(0, 10),
      scope: "plan",
      value: report.reported_value,
      note: report.report_period ? `実績報告（${report.report_period}）の承認` : "実績報告の承認",
      inputs: { kpi_report_id: report.id },
    });
  }

  return NextResponse.json({ data: { id: params.id, status }, error: null });
}
