export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { turnStateOf, type TurnColumns } from "@/lib/ai/asyncTurn";

type Params = { params: { id: string; dialogueId: string } };

const MODULE = "self_evaluation";

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  const row = await queryOne<TurnColumns & Record<string, unknown>>(
    `SELECT id, project_id, program_evaluation_id, title, status, current_step,
            messages, proposals, committed_at::text,
            turn_status, turn_error, turn_started_at::text AS turn_started_at,
            created_at::text, updated_at::text
     FROM improvement_dialogues
     WHERE id = $1 AND project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "改善提案が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { ...row, ...turnStateOf(row) }, error: null });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  const row = await queryOne<{ id: string }>(
    `DELETE FROM improvement_dialogues WHERE id = $1 AND project_id = $2 RETURNING id`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "改善提案が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: { id: row.id }, error: null });
}
