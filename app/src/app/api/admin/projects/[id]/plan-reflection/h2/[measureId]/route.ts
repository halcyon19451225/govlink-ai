export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 様式H2 前提条件表（施策1件・docx）— 定義は施策側、年次確認の履歴は評価側から写す */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { fiscalYearLabel } from "@/lib/measure/indicators";
import { REFLECT_FORM_VERSION, buildFormDocx } from "@/lib/evaluation/formDocx";
import { docxResponse } from "@/lib/evaluation/formResponse";

type Params = { params: { id: string; measureId: string } };

const H2_HEADERS = ["前提（施策が機能する条件）", "確認方法（年次）", "崩れた場合の対応", "年次確認の履歴"] as const;

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const m = await queryOne<{
    title: string; owner_department: string | null; project_title: string; municipality: string;
    preconditions: { id: string; condition: string; check_method: string; fallback: string }[] | null;
  }>(
    `SELECT md.title, md.owner_department, md.preconditions, p.title AS project_title, mu.name AS municipality
       FROM measure_designs md
       JOIN projects p ON p.id = md.project_id
       JOIN municipalities mu ON mu.id = p.municipality_id
      WHERE md.id = $1 AND md.project_id = $2`,
    [params.measureId, params.id],
  );
  if (!m) return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  const defs = Array.isArray(m.preconditions) ? m.preconditions : [];

  const checks = await query<{ fiscal_year: number | null; status: string; work_code: string | null; checks: { id: string; state: string; note: string | null }[] | null }>(
    `SELECT pe.fiscal_year, pe.status, w.code AS work_code, pe.precondition_checks AS checks
       FROM program_evaluations pe LEFT JOIN measure_works w ON w.id = pe.measure_work_id
      WHERE pe.project_id = $1 AND pe.measure_design_id = $2 AND pe.measure_work_id IS NOT NULL
        AND jsonb_array_length(COALESCE(pe.precondition_checks, '[]'::jsonb)) > 0
      ORDER BY pe.fiscal_year, pe.created_at`,
    [params.id, params.measureId],
  ).catch(() => []);

  const rows = defs.map((d) => {
    const hist = checks
      .flatMap((c) => (c.checks ?? []).filter((x) => x.id === d.id && x.state !== "unchecked").map((x) => ({ ...x, fiscal_year: c.fiscal_year, work_code: c.work_code, approved: c.status === "approved" })))
      .map((h) => `${h.fiscal_year != null ? fiscalYearLabel(h.fiscal_year) : "年度不明"}${h.work_code ? `・${h.work_code}` : ""}: ${h.state === "broken" ? "✗ 不成立" : "○ 成立"}${h.note ? `（${h.note}）` : ""}${h.approved ? "" : "【暫定】"}`);
    return [d.condition, d.check_method || "—", d.fallback || "—", hist.length > 0 ? hist.join("\n") : "年次確認なし"];
  });

  const buffer = await buildFormDocx({
    municipality: m.municipality,
    title: "様式H2 前提条件表",
    subtitle: `${m.project_title}／ ${m.title}${m.owner_department ? `（${m.owner_department}）` : ""} — 期末を待たずに軌道修正する仕掛け`,
    warnings: defs.length === 0 ? ["前提条件が未設定です。新設・移植・実行起因で再設計する施策には添付が必要です。"] : [],
    landscape: true,
    version: REFLECT_FORM_VERSION,
    sections: [
      {
        heading: "前提条件（崩れると施策全体が止まる急所に限定・3〜5項目）",
        note: "年次評価（取組評価）の際に確認方法に沿って成立状況を確認する。崩れていれば改善アクションが自動起票され、進捗管理ルール（中止又は他取組の検討）を起動する。",
        table: { headers: H2_HEADERS, rows, widths: [28, 22, 26, 24], fontSize: 16 },
      },
    ],
  });
  return docxResponse(params.id, `H2_${params.measureId.slice(0, 8)}`, `様式H2_前提条件表_${m.title.slice(0, 20)}`, buffer);
}
