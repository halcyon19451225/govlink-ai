export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 評価報告書の出力（CA2-5・設計 claude/coe-ca2-design.md §9）
 *
 * GET  … 報告書の中身をJSONで返す（画面のプレビュー用）
 * POST … docx を組んで返す（S3にも保存して痕跡を残す）
 *
 * 報告書は**評価の記録を写すだけ**で、判定をやり直さない。
 * 承認済みの評価なら indicator_snapshot（凍結値）が印字され、
 * 未承認なら暫定である旨を本文に刷る。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { uploadToStorage } from "@/lib/storage";
import { buildEvaluationReportData } from "@/lib/evaluation/reportData";
import { buildEvaluationReportDocx } from "@/lib/evaluation/reportDocx";
import { formOf } from "@/lib/evaluation/reportTemplate";

type Params = { params: { id: string; evalId: string } };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  const data = await buildEvaluationReportData(params.id, params.evalId);
  if (!data) {
    return NextResponse.json({ data: null, error: "評価が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { ...data, form: formOf(data.kind) }, error: null });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  const data = await buildEvaluationReportData(params.id, params.evalId);
  if (!data) {
    return NextResponse.json({ data: null, error: "評価が見つかりません" }, { status: 404 });
  }

  const buffer = await buildEvaluationReportDocx(data);
  const form = formOf(data.kind);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  // ファイル名に使えない文字を落とす（記号のみ除去。日本語はそのまま残す）
  const safeSubject =
    data.subject.replace(/[\\/:*?"<>|\r\n\t]/g, "").trim().slice(0, 40) || "評価";
  const filename = `${form.title}_${safeSubject}_${stamp}.docx`;

  // 保存は best-effort（S3が落ちていてもダウンロードは成立させる）
  try {
    await uploadToStorage(
      "evaluation-reports",
      `${params.id}/${params.evalId}/${stamp}.docx`,
      buffer,
      DOCX_MIME,
    );
  } catch (e) {
    console.warn("[evaluation-report] S3保存に失敗（ダウンロードは継続）:", e);
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
