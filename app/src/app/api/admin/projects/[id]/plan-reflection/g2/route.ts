export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 様式G2 反映状況報告書（docx）— 標準処遇に対する採否と理由を、計画と併せて公表する */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { G2_HEADERS, buildReflectionData, g2RowText } from "@/lib/evaluation/reflectionData";
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

  const rows = data.reports.filter((r) => r.report_no != null || r.exemption);
  const exceptions = rows.filter((r) => r.adoption_effective && r.adoption_effective !== "adopted");
  const buffer = await buildFormDocx({
    municipality: data.municipality,
    title: "様式G2 反映状況報告書",
    subtitle: `${data.project_title}（${data.plan_period}）／ 評価結果の次期計画への反映状況（計画と併せて公表）`,
    warnings: data.reports.some((r) => !r.frozen && r.report_no != null) ? ["【暫定】承認されていない主要施策評価の判定を含みます。"] : [],
    landscape: true,
    version: REFLECT_FORM_VERSION,
    sections: [
      {
        heading: "1. 反映状況",
        note: "「決定」は標準処遇に対する採否（採用・一部採用・不採用）。不採用・変更の理由は理由書（H4）の要旨。",
        table: { headers: G2_HEADERS, rows: rows.map((r) => g2RowText(r, data.next_measures)), widths: [16, 26, 16, 10, 18, 14], fontSize: 14 },
      },
      {
        heading: "2. 例外の件数（審議会の確認対象）",
        kv: [
          { label: "報告書の件数", value: `${rows.length} 件` },
          { label: "標準処遇と異なる決定（一部採用・不採用）", value: `${exceptions.length} 件${rows.length > 0 && exceptions.length > rows.length / 2 ? " — 過半を超えています。決定ルール自体の改定を検討（ルールが実態に合わない兆候）" : ""}` },
        ],
      },
    ],
  });
  return docxResponse(params.id, "G2", "様式G2_反映状況報告書", buffer);
}
