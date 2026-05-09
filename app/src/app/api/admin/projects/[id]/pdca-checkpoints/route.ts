export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const checkpoints = await query(
    `SELECT id, name, cycle_type, phase, description, evaluation_tiers, modules_involved,
            qc_step, instructions,
            to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            to_char(scheduled_date_end, 'YYYY-MM-DD') AS scheduled_date_end,
            status, started_at::text, completed_at::text, completion_notes, sort_order
     FROM project_pdca_checkpoints
     WHERE project_id = $1
     ORDER BY sort_order, scheduled_date`,
    [params.id],
  );

  return NextResponse.json({ data: checkpoints, error: null });
}
