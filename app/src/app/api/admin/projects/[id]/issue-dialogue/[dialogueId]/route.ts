export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; dialogueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "view");
  if (deny) return deny;

  const row = await queryOne(
    `SELECT d.id, d.kpi_id, d.gap_analysis_id, d.asis_analysis_id, d.title,
            d.status, d.current_step, d.messages,
            d.problems, d.selection, d.root_causes, d.hypotheses,
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

  return NextResponse.json({ data: row, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
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
