export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

type Params = { params: { id: string; cycleId: string } };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  // テンプレート存在確認 & システムテンプレートチェック
  const existing = await query<{ id: string; is_system_template: boolean }>(
    "SELECT id, is_system_template FROM plan_templates WHERE id = $1",
    [params.id],
  );
  const tmpl = existing[0];
  if (!tmpl) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }
  if (tmpl.is_system_template) {
    return NextResponse.json({ data: null, error: "システムテンプレートは変更できません" }, { status: 403 });
  }

  // サイクルの存在確認
  const cycleRows = await query<{ id: string }>(
    "SELECT id FROM pdca_cycle_defs WHERE id = $1 AND template_id = $2",
    [params.cycleId, params.id],
  );
  if (!cycleRows[0]) {
    return NextResponse.json({ data: null, error: "サイクルが見つかりません" }, { status: 404 });
  }

  // CASCADE で checkpoint_defs も削除される前提
  await query("DELETE FROM pdca_cycle_defs WHERE id = $1", [params.cycleId]);

  return NextResponse.json({ data: { id: params.cycleId }, error: null });
}
