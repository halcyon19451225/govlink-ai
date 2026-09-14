export const dynamic = "force-dynamic";

/**
 * 計画の指標 1件の更新・削除。
 *
 * 069 以降、`kpis` は読み取り専用の互換ビューで、実体は
 *   indicators（定義）／indicator_targets（目標）／indicator_values（値の履歴）
 * に分かれている。**このルートは SQL を書かず、指標管理のサービス層を通す。**
 * 画面からの操作も AI の確定処理も同じ関数を通り、activity_log に同じ形で残る（設計 §10-5）。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { actorFromSession } from "@/lib/activity";
import {
  IndicatorError,
  deleteIndicator,
  listTargets,
  setTarget,
  updateIndicator,
  type SetTargetInput,
  type UpdateIndicatorInput,
} from "@/lib/indicator/service";

const patchSchema = z.object({
  label:                 z.string().min(1).optional(),
  target:                z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
  unit:                  z.string().optional(),
  goal_id:               z.string().nullable().optional(),
  indicator_type:        z.enum(["process","outcome_initial","outcome_mid","outcome_intermediate","outcome_long","efficiency"]).optional(),
  previous_value:        z.number().nullable().optional(),
  achievement_condition: z.enum(["lte","lt","gte","gt","eq"]).nullable().optional(),
  target_deadline:       z.string().nullable().optional(), // "YYYY-MM-DD"
  baseline_value:        z.union([z.number(), z.string()]).transform((v) => Number(v)).nullable().optional(),
  baseline_year:         z.number().int().nullable().optional(),
  contributes_to_kpi_id: z.string().uuid().nullable().optional(),
});

/**
 * 旧 API の `baseline_year`（年の整数）を、目標が持つ基準日に写す。
 * 互換ビューが `EXTRACT(YEAR FROM baseline_as_of)` で年を返すので、
 * 年度の初日にしておくと同じ年が返り、往復しても値が動かない。
 */
const yearToAsOf = (y: number | null | undefined): string | null =>
  y == null ? null : `${String(y).padStart(4, "0")}-04-01`;

function errorResponse(e: unknown) {
  if (e instanceof IndicatorError) {
    return NextResponse.json({ data: null, error: e.message }, { status: e.status });
  }
  console.error("kpis/[kpiId]:", e);
  return NextResponse.json({ data: null, error: "処理に失敗しました" }, { status: 500 });
}

// PATCH: 指標を更新（定義と目標を、それぞれの置き場所へ振り分ける）
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; kpiId: string } }
) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "バリデーションエラー" }, { status: 422 });
  }
  const d = parsed.data;

  // ① 定義（indicators）
  const patch: UpdateIndicatorInput = {};
  if (d.label !== undefined) patch.label = d.label;
  if (d.unit !== undefined) patch.unit = d.unit;
  if (d.goal_id !== undefined) patch.goalId = d.goal_id ?? null;
  if (d.indicator_type !== undefined) patch.indicatorType = d.indicator_type;
  if (d.contributes_to_kpi_id !== undefined) patch.contributesToId = d.contributes_to_kpi_id ?? null;
  if (d.previous_value !== undefined) patch.previousValue = d.previous_value ?? null;

  // ② 目標（indicator_targets・計画スコープ）
  //    PATCH なので、送られてこなかった項目は今の目標の値を残す
  const touchesTarget =
    d.target !== undefined || d.achievement_condition !== undefined ||
    d.target_deadline !== undefined || d.baseline_value !== undefined ||
    d.baseline_year !== undefined;

  try {
    const actor = actorFromSession(session, "ui");

    if (Object.keys(patch).length > 0) {
      await updateIndicator(actor, params.id, params.kpiId, patch);
    }

    if (touchesTarget) {
      const current = (await listTargets(params.kpiId)).find((t) => t.scope === "plan");
      const next: SetTargetInput = {
        scope: "plan",
        targetValue: d.target !== undefined ? d.target : current ? Number(current.target_value) : null,
        achievementCondition:
          d.achievement_condition !== undefined
            ? (d.achievement_condition ?? "gte")
            : (current?.achievement_condition ?? "gte"),
        targetDeadline:
          d.target_deadline !== undefined ? (d.target_deadline ?? null) : (current?.target_deadline ?? null),
        baselineValue:
          d.baseline_value !== undefined
            ? (d.baseline_value ?? null)
            : current?.baseline_value != null
              ? Number(current.baseline_value)
              : null,
        baselineAsOf:
          d.baseline_year !== undefined
            ? yearToAsOf(d.baseline_year)
            : (current?.baseline_as_of ?? null),
        note: current?.note ?? null,
      };
      if (next.targetValue != null && Number.isNaN(next.targetValue)) next.targetValue = null;
      await setTarget(actor, params.id, params.kpiId, next);
    }
  } catch (e) {
    return errorResponse(e);
  }

  return NextResponse.json({ data: { id: params.kpiId }, error: null });
}

// DELETE: 指標を削除（目標・値の履歴も一緒に消える。操作は activity_log に残る）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; kpiId: string } }
) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  try {
    await deleteIndicator(actorFromSession(session, "ui"), params.id, params.kpiId);
  } catch (e) {
    return errorResponse(e);
  }

  return NextResponse.json({ data: { id: params.kpiId }, error: null });
}
