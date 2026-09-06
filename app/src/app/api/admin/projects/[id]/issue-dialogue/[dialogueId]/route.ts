export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { turnStateOf, type TurnColumns } from "@/lib/ai/asyncTurn";

type Params = { params: { id: string; dialogueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "view");
  if (deny) return deny;

  const row = await queryOne<TurnColumns & Record<string, unknown>>(
    `SELECT d.id, d.kpi_id, d.gap_analysis_id, d.asis_analysis_id, d.title,
            d.status, d.current_step, d.messages,
            d.problems, d.selection, d.root_causes, d.hypotheses,
            d.turn_status, d.turn_error, d.turn_started_at::text AS turn_started_at,
            d.committed_at::text,
            d.created_at::text, d.updated_at::text,
            k.label AS kpi_label
     FROM issue_dialogues d
     LEFT JOIN kpis k ON k.id = d.kpi_id
     WHERE d.id = $1 AND d.project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json(
      { data: null, error: "課題仮説設定が見つかりません" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: { ...row, ...turnStateOf(row) }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string }>(
    `DELETE FROM issue_dialogues WHERE id = $1 AND project_id = $2 RETURNING id`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json(
      { data: null, error: "課題仮説設定が見つかりません" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: { id: row.id }, error: null });
}
