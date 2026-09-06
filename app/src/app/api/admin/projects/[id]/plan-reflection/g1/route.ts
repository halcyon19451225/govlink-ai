export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 様式G1 評価・計画対応表（docx・横向き）— 完全対応の担保台帳。行は実データから */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { G1_HEADERS, buildReflectionData, g1RowText } from "@/lib/evaluation/reflectionData";
import { REFLECT_FORM_VERSION, buildFormDocx } from "@/lib/evaluation/formDocx";
import { docxResponse } from "@/lib/evaluation/formResponse";

type Params = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;
  const data = await buildReflectionData(params.id);
  if (!data) return NextResponse.json({ data: null, error: "計画が見つかりません" }, { status: 404 });

  const rc = data.reconciliation;
  const warnings: string[] = [];
  if (data.reports.some((r) => !r.frozen && r.report_no != null)) warnings.push("【暫定】承認されていない主要施策評価の判定を含みます。");
  if (rc.unreconciled > 0) warnings.push(`【照合】行き先のない報告書が ${rc.unreconciled} 件あります。全行「対応済み」が計画決裁の前提です（停止条件）。`);
  if (rc.unsourced > 0) warnings.push(`【照合】次期計画の施策のうち根拠（報告書・クローン系譜）のないものが ${rc.unsourced} 件あります。`);

  const buffer = await buildFormDocx({
    municipality: data.municipality,
    title: "様式G1 評価・計画対応表",
    subtitle: `${data.project_title}（${data.plan_period}）／ 完全対応の担保台帳 — 報告書1件につき1行`,
    warnings,
    landscape: true,
    version: REFLECT_FORM_VERSION,
    sections: [
      {
        heading: "1. 対応表",
        note: "判定・ルート・標準処遇・決定処遇・理由書の有無は共通ヘッダ（主要施策評価の保存値）から自動生成。反映箇所は骨子確定後に記入。",
        table: { headers: G1_HEADERS, rows: data.reports.map((r) => g1RowText(r, data.next_measures)), widths: [12, 13, 7, 8, 14, 16, 5, 15, 10], fontSize: 14 },
      },
      {
        heading: "2. 照合結果（両方向）",
        kv: [
          { label: "順方向: 判定のある報告書", value: `${rc.total} 件（対応済み ${rc.reconciled}／未対応 ${rc.unreconciled}）` },
          { label: "逆方向: 次期計画の施策", value: data.next_project ? `${data.next_measures.length} 件（根拠のないもの ${rc.unsourced}）` : "次期計画（クローン）が未作成のため照合対象なし" },
          { label: "理由書（標準処遇≠決定処遇）", value: `${rc.exceptions} 件${rc.total > 0 && rc.exceptions > rc.total / 2 ? " — 過半を超えています。決定ルール自体の改定を検討" : ""}` },
        ],
      },
    ],
  });
  return docxResponse(params.id, "G1", "様式G1_評価・計画対応表", buffer);
}
