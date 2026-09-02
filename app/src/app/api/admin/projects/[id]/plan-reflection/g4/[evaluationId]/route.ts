export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 様式G4 諮問事項整理書（報告書1件につき1葉・docx）— ①〜⑦は共通ヘッダから自動、⑧〜⑫は手入力 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireModulePermission } from "@/lib/permissions";
import { buildReflectionData, g4Sections } from "@/lib/evaluation/reflectionData";
import { REFLECT_FORM_VERSION, buildFormDocx } from "@/lib/evaluation/formDocx";
import { docxResponse } from "@/lib/evaluation/formResponse";

type Params = { params: { id: string; evaluationId: string } };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;
  const data = await buildReflectionData(params.id);
  const r = data?.reports.find((x) => x.evaluation_id === params.evaluationId);
  if (!data || !r) return NextResponse.json({ data: null, error: "報告書が見つかりません" }, { status: 404 });

  const warnings: string[] = [];
  if (!r.frozen) warnings.push("【暫定】未承認の主要施策評価から作成しています。");
  if (r.rationale_required && !r.rationale) warnings.push("【要記入】標準処遇と異なる事務局案ですが、理由書（H4）が未記入です。");
  const buffer = await buildFormDocx({
    municipality: data.municipality,
    title: "様式G4 諮問事項整理書",
    subtitle: `${data.project_title}／ ${r.measure_title} ／ ${r.report_no ? `報告書No.${r.report_no} ${r.report_title}` : r.report_title}`,
    warnings,
    version: REFLECT_FORM_VERSION,
    sections: g4Sections(r, data.next_measures),
  });
  return docxResponse(params.id, `G4_${r.evaluation_id.slice(0, 8)}`, `様式G4_諮問事項整理書_${r.measure_title.slice(0, 20)}`, buffer);
}
