export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { issueOpenerMessage, type IssueKpiContext } from "@/lib/issue/prompt";
import { fetchAsisSource, fetchIssueKpiContext, pickProblemSeeds } from "@/lib/issue/context";
import { EMPTY_ISSUE_DATA } from "@/lib/issue/types";

type Params = { params: { id: string } };

// 一覧取得 / KPIごとのステータス取得（?byKpi=true）
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "view");
  if (deny) return deny;

  if (req.nextUrl.searchParams.get("byKpi") === "true") {
    const statuses = await query<{
      kpi_id: string;
      dialogue_id: string;
      status: string;
      current_step: string;
    }>(
      `SELECT kpi_id, id AS dialogue_id, status, current_step
       FROM issue_dialogues
       WHERE project_id = $1 AND kpi_id IS NOT NULL
       ORDER BY created_at`,
      [params.id],
    );
    return NextResponse.json({ data: { statuses }, error: null });
  }

  const rows = await query(
    `SELECT d.id, d.kpi_id, d.gap_analysis_id, d.asis_analysis_id, d.title,
            d.status, d.current_step, d.messages,
            d.problems, d.selection, d.root_causes, d.hypotheses,
            d.committed_at::text,
            d.created_at::text, d.updated_at::text,
            k.label AS kpi_label
     FROM issue_dialogues d
     LEFT JOIN kpis k ON k.id = d.kpi_id
     WHERE d.project_id = $1
     ORDER BY d.created_at DESC`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  kpi_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

// 新規作成（problems フェーズの最初の質問をシード）
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const kpiId = parsed.data.kpi_id ?? null;
  let kpiLabel: string | null = null;
  let kpiContext: IssueKpiContext | null = null;
  let gapAnalysisId: string | null = null;

  if (kpiId) {
    // 1KPI1件（find-or-create）
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM issue_dialogues WHERE project_id = $1 AND kpi_id = $2",
      [params.id, kpiId],
    );
    if (existing) {
      return NextResponse.json(
        { data: { id: existing.id, existed: true }, error: null },
        { status: 200 },
      );
    }

    const kpi = await fetchIssueKpiContext(params.id, kpiId);
    if (!kpi) {
      return NextResponse.json(
        { data: null, error: "指定されたKPIが見つかりません" },
        { status: 404 },
      );
    }
    kpiLabel = kpi.context.indicatorName;
    kpiContext = kpi.context;
    gapAnalysisId = kpi.gapAnalysisId;
  }

  const asis = await fetchAsisSource(params.id, kpiId);
  const hasAsis = asis.asis_status === "completed";

  const title = parsed.data.title ?? (kpiLabel ? `課題仮説: ${kpiLabel}` : "課題仮説設定");
  const messages = [
    {
      role: "assistant",
      content: issueOpenerMessage({
        kpiContext,
        hasAsis,
        problemSeeds: hasAsis ? pickProblemSeeds(asis.swot, asis.cross_analysis) : [],
      }),
      step: "problems",
    },
  ];

  const created = await queryOne<{ id: string }>(
    `INSERT INTO issue_dialogues
       (project_id, kpi_id, gap_analysis_id, asis_analysis_id, title,
        status, current_step, messages, problems, selection, root_causes, hypotheses)
     VALUES ($1, $2, $3, $4, $5, 'in_progress', 'problems',
             $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
     RETURNING id`,
    [
      params.id,
      kpiId,
      gapAnalysisId,
      asis.asis_analysis_id,
      title,
      JSON.stringify(messages),
      JSON.stringify(EMPTY_ISSUE_DATA.problems),
      JSON.stringify(EMPTY_ISSUE_DATA.selection),
      JSON.stringify(EMPTY_ISSUE_DATA.root_causes),
      JSON.stringify(EMPTY_ISSUE_DATA.hypotheses),
    ],
  );

  if (!created) {
    return NextResponse.json({ data: null, error: "作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: created.id }, error: null }, { status: 201 });
}
