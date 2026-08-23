export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string; dialogueId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const row = await queryOne(
    `SELECT d.id, d.issue_hypothesis_id, d.title, d.status, d.current_step,
            d.messages, d.approaches, d.evidence, d.experiments, d.indicators, d.costs,
            d.committed_at::text, d.created_at::text, d.updated_at::text,
            h.title AS hypothesis_title
     FROM measure_dialogues d
     LEFT JOIN issue_hypotheses h ON h.id = d.issue_hypothesis_id
     WHERE d.id = $1 AND d.project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "対話が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ data: row, error: null });
}
