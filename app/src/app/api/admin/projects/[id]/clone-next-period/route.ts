export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { cloneNextPeriod } from "@/lib/plan/clone";

type Params = { params: { id: string } };

/**
 * 次期計画のたたき台を作成（前期計画の複製）— PL1 P①
 *
 * POST { title, plan_start_date?, plan_end_date? }
 * - 1トランザクション（失敗時は全ロールバック — 半端な計画を残さない）
 * - 複製の範囲・FK張り替えは lib/plan/clone.ts（正本）を参照
 * - 前期の finalized な引き継ぎパッケージがあれば target_project_id を自動セット
 *   → 新計画ダッシュボードに「📦 前期からの引き継ぎがあります」バナーが出る（P②の入口）
 */
const bodySchema = z.object({
  title: z.string().min(1).max(200),
  plan_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  plan_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "self_evaluation", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  try {
    const result = await transaction((client) =>
      cloneNextPeriod(client, {
        sourceProjectId: params.id,
        title: d.title.trim(),
        planStartDate: d.plan_start_date ?? null,
        planEndDate: d.plan_end_date ?? null,
      }),
    );
    if (!result) {
      return NextResponse.json({ data: null, error: "複製元の計画が見つかりません" }, { status: 404 });
    }
    return NextResponse.json({ data: result, error: null });
  } catch (e) {
    console.error("次期計画の複製に失敗:", e);
    return NextResponse.json(
      { data: null, error: "複製に失敗しました（変更はすべて巻き戻されています）" },
      { status: 500 },
    );
  }
}
