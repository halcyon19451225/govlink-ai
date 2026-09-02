export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 様式H1 評価総括表（収束工程 段階1）
 *
 * GET  … 行をJSONで返す（画面用）
 * POST … docx を組んで返す（横向き）
 *
 * 全指標セットを1行1セットで一覧化し、施策単位の処遇案に束ねる。
 * 表は実データから組み、判定は主要施策評価が保存した値を写すだけ（作り直さない）。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireModulePermission } from "@/lib/permissions";
import { uploadToStorage } from "@/lib/storage";
import { H1_HEADERS, buildH1Data, h1RowText } from "@/lib/evaluation/reflectionData";
import { REFLECT_FORM_VERSION, buildFormDocx } from "@/lib/evaluation/formDocx";
import { ROUTE_META } from "@/lib/evaluation/judgment";

type Params = { params: { id: string } };
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;
  const data = await buildH1Data(params.id);
  if (!data) return NextResponse.json({ data: null, error: "計画が見つかりません" }, { status: 404 });
  return NextResponse.json({ data, error: null });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;
  const data = await buildH1Data(params.id);
  if (!data) return NextResponse.json({ data: null, error: "計画が見つかりません" }, { status: 404 });

  const provisional = data.rows.some((r) => r.judgment && !r.judgment.frozen);
  const buffer = await buildFormDocx({
    municipality: data.municipality,
    title: "様式H1 評価総括表",
    subtitle: `${data.project_title}（${data.plan_period}）／ 収束工程 段階1 — 1行1指標セット（アウトプット→初期→中間）`,
    warnings: provisional ? ["【暫定】承認されていない主要施策評価の判定を含みます（該当行に【暫定】と表示）。"] : [],
    landscape: true,
    version: REFLECT_FORM_VERSION,
    sections: [
      {
        heading: "1. 指標セット一覧",
        note: "達否: ○=達成 ×=未達 －=判定不能。◎=主たる中間アウトカム。事業費・財政効果率は施策計（セットへの按分はしない）。",
        table: { headers: H1_HEADERS, rows: data.rows.map(h1RowText), widths: [5, 14, 13, 13, 15, 14, 10, 5, 11], fontSize: 14 },
      },
      {
        heading: "2. 施策単位の集約（集約ルール: 主たる中間アウトカム／最重ルート B>D>C>A）",
        table: {
          headers: ["施策", "セット数", "判定→報告書No.", "ルート", "標準処遇", "決定処遇（事務局案）", "理由書", "財政効果率"],
          rows: data.measures.map((m) => [
            m.measure_title,
            String(m.sets),
            m.judgment ? (m.judgment.report_no ? `${m.judgment.path} → No.${m.judgment.report_no} ${m.judgment.report_title}` : `${m.judgment.path} → 判定保留`) : "－（データなし）",
            m.judgment?.route ? `${m.judgment.route} ${ROUTE_META[m.judgment.route].name}` : m.exemption ? "適用除外" : "—",
            m.judgment?.standard_treatment ?? "—",
            m.judgment?.decided_treatment ?? "—",
            m.judgment?.rationale_required ? "○" : "—",
            m.fiscal_rate != null ? `${m.fiscal_rate}%` : "算定不能",
          ]),
          widths: [22, 6, 20, 10, 14, 14, 6, 8],
          fontSize: 15,
        },
      },
    ],
  });

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  try {
    await uploadToStorage("evaluation-reports", `${params.id}/reflection/H1_${stamp}.docx`, buffer, DOCX_MIME);
  } catch (e) {
    console.warn("[plan-reflection/h1] S3保存に失敗（ダウンロードは継続）:", e);
  }
  const filename = `様式H1_評価総括表_${stamp}.docx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
