export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { sanitizeQuestions, sanitizeTargets, type ReportQuestion } from "@/lib/report/types";

type Params = { params: { id: string } };

const MODULE = "program_evaluation";

/**
 * 受領済み実績報告の所見・課題（S2 C①）— プログラム評価ウィザードの参考情報パネル用
 * GET ?measureId=<uuid> … その施策の受領済み回答から、記述設問（text/textarea）の回答を返す
 * （C工程の入力を評価画面で見られるようにする — 設計 C①-4）
 */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const measureId = req.nextUrl.searchParams.get("measureId");
  if (!measureId) {
    return NextResponse.json({ data: [], error: null });
  }

  const rows = await query<{
    request_title: string;
    fiscal_year: number | null;
    form_def: unknown;
    targets: unknown;
    target_key: string;
    answers: unknown;
    answered_at: string | null;
  }>(
    `SELECT r.title AS request_title, r.fiscal_year, r.form_def, r.targets,
            x.target_key, x.answers, x.answered_at::text AS answered_at
     FROM report_responses x
     JOIN report_requests r ON r.id = x.request_id
     WHERE r.project_id = $1 AND x.status = 'accepted' AND x.target_key = $2
     ORDER BY x.answered_at DESC LIMIT 10`,
    [params.id, measureId],
  );

  const out: {
    request_title: string;
    fiscal_year: number | null;
    answered_at: string | null;
    items: { label: string; value: string }[];
  }[] = [];
  for (const row of rows) {
    const targets = sanitizeTargets(row.targets);
    const target = targets.find((t) => t.target_key === row.target_key);
    const questions: ReportQuestion[] = sanitizeQuestions(row.form_def, new Set<string>(), new Set(targets.map((t) => t.measure_design_id)));
    const answers = (row.answers && typeof row.answers === "object" ? row.answers : {}) as Record<string, unknown>;
    const items = questions
      .filter(
        (q) =>
          (q.type === "text" || q.type === "textarea") &&
          (!q.measure_design_id || q.measure_design_id === (target?.measure_design_id ?? row.target_key)) &&
          typeof answers[q.id] === "string" &&
          String(answers[q.id]).trim(),
      )
      .map((q) => ({ label: q.label, value: String(answers[q.id]).slice(0, 2000) }));
    if (items.length > 0) {
      out.push({
        request_title: row.request_title,
        fiscal_year: row.fiscal_year,
        answered_at: row.answered_at,
        items,
      });
    }
  }
  return NextResponse.json({ data: out, error: null });
}
