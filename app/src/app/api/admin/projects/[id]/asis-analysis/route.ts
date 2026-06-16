export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { openerMessage, type KpiContext } from "@/lib/asis/prompt";
import { EMPTY_SWOT, EMPTY_CROSS } from "@/lib/asis/types";

type Params = { params: { id: string } };

// 紐付いたKPIのコンテキストを取得（ギャップ分析の現状値・ギャップを含む）
async function fetchKpiContext(
  projectId: string,
  kpiId: string,
): Promise<{ label: string; context: KpiContext } | null> {
  const row = await queryOne<{
    label: string;
    target: number | null;
    unit: string;
    achievement_condition: KpiContext["condition"];
    target_deadline: string | null;
    current_value: number | null;
    gap_value: number | null;
  }>(
    `SELECT k.label, k.target::float, k.unit,
            k.achievement_condition,
            to_char(k.target_deadline, 'YYYY-MM-DD') AS target_deadline,
            g.current_value::float AS current_value,
            g.gap_value::float     AS gap_value
     FROM kpis k
     LEFT JOIN gap_analyses g ON g.kpi_id = k.id AND g.project_id = $2
     WHERE k.id = $1 AND k.project_id = $2`,
    [kpiId, projectId],
  );
  if (!row) return null;
  return {
    label: row.label,
    context: {
      indicatorName: row.label,
      targetValue: row.target,
      unit: row.unit,
      condition: row.achievement_condition,
      deadline: row.target_deadline,
      currentValue: row.current_value,
      gapValue: row.gap_value,
    },
  };
}

// 一覧取得 / KPIごとのステータス取得（?byKpi=true）
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "view");
  if (deny) return deny;

  // KPIごとの現状整理ステータス
  if (req.nextUrl.searchParams.get("byKpi") === "true") {
    const statuses = await query<{
      kpi_id: string;
      asis_id: string;
      status: string;
      current_step: string;
    }>(
      `SELECT kpi_id, id AS asis_id, status, current_step
       FROM asis_analyses
       WHERE project_id = $1 AND kpi_id IS NOT NULL
       ORDER BY created_at`,
      [params.id],
    );
    return NextResponse.json({ data: { statuses }, error: null });
  }

  const rows = await query(
    `SELECT a.id, a.kpi_id, a.title, a.status, a.current_step,
            a.messages, a.swot, a.cross_analysis,
            a.created_at::text, a.updated_at::text, k.label AS kpi_label
     FROM asis_analyses a
     LEFT JOIN kpis k ON k.id = a.kpi_id
     WHERE a.project_id = $1
     ORDER BY a.created_at DESC`,
    [params.id],
  );

  return NextResponse.json({ data: rows, error: null });
}

const createSchema = z.object({
  kpi_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

// 新規作成（external フェーズの最初の質問をシード）
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
  let kpiContext: KpiContext | null = null;
  if (kpiId) {
    // 既存レコードがあれば作成せずに返す（find-or-create / 1KPI1件）
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM asis_analyses WHERE project_id = $1 AND kpi_id = $2",
      [params.id, kpiId],
    );
    if (existing) {
      return NextResponse.json(
        { data: { id: existing.id, existed: true }, error: null },
        { status: 200 },
      );
    }

    const kpi = await fetchKpiContext(params.id, kpiId);
    if (!kpi) {
      return NextResponse.json(
        { data: null, error: "指定されたKPIが見つかりません" },
        { status: 404 },
      );
    }
    kpiLabel = kpi.label;
    kpiContext = kpi.context;
  }

  const title = parsed.data.title ?? (kpiLabel ? `現状整理: ${kpiLabel}` : "現状整理");
  const messages = [
    { role: "assistant", content: openerMessage(kpiLabel, kpiContext), step: "external" },
  ];

  const created = await queryOne<{ id: string }>(
    `INSERT INTO asis_analyses
       (project_id, kpi_id, title, status, current_step, messages, swot, cross_analysis)
     VALUES ($1, $2, $3, 'in_progress', 'external', $4::jsonb, $5::jsonb, $6::jsonb)
     RETURNING id`,
    [
      params.id,
      kpiId,
      title,
      JSON.stringify(messages),
      JSON.stringify(EMPTY_SWOT),
      JSON.stringify(EMPTY_CROSS),
    ],
  );

  return NextResponse.json({ data: { id: created!.id }, error: null }, { status: 201 });
}
