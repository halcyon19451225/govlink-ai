export const dynamic = "force-dynamic";

/**
 * 指標管理 — 一覧と登録（D4）
 *
 * 設計: claude/coe-dataset-model.md §9・§10-5。
 * 実処理はサービス層（lib/indicator/service.ts）にある。ここは認証・テナント境界・権限と
 * 入出力の整形だけを担う。**AI の対話からの登録も同じサービス関数を通る。**
 *
 * 権限はデータセット管理（dataset_manager）と同じ区分で見る。
 * 指標はデータセットを読んで値を出す仕組みで、扱える人の範囲が同じため。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import { actorFromSession } from "@/lib/activity";
import { indicatorErrorResponse } from "@/lib/indicator/http";
import { createIndicator, listIndicators, type CreateIndicatorInput } from "@/lib/indicator/service";
import { validateSpec } from "@/lib/indicator/spec";

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "view");
  if (deny) return deny;

  // 設定画面で「どの箱の・どの列／属性を見るか」を選ぶために、箱と版の状況も返す
  const [indicators, datasets] = await Promise.all([
    listIndicators(params.id),
    query(
      `SELECT d.id, d.name, d.kind, d.schema, d.time_granularity,
              (SELECT max(v.as_of)::text FROM dataset_versions v
                WHERE v.dataset_id = d.id AND v.status = 'validated') AS latest_as_of,
              (SELECT count(*)::int FROM dataset_versions v
                WHERE v.dataset_id = d.id AND v.status = 'validated') AS version_count
         FROM datasets d WHERE d.project_id = $1 ORDER BY d.created_at`,
      [params.id],
    ),
  ]);
  return NextResponse.json({ data: { indicators, datasets }, error: null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: Partial<CreateIndicatorInput> & { spec?: unknown };
  try {
    body = (await req.json()) as Partial<CreateIndicatorInput> & { spec?: unknown };
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }

  // 手入力以外は設定（spec）の構造検査を通ってからでないと登録できない。
  // 「登録はできたが計算できない指標」を作らないため
  const calcType = body.calcType ?? "manual";
  if (calcType !== "manual") {
    const errs = validateSpec(body.spec);
    if (errs.length > 0) return NextResponse.json({ data: null, error: errs[0], details: errs }, { status: 400 });
  }

  try {
    const created = await createIndicator(actorFromSession(session, "ui"), params.id, {
      label: String(body.label ?? ""),
      unit: body.unit ?? "",
      description: body.description ?? null,
      calcType,
      ...(body.indicatorType ? { indicatorType: body.indicatorType } : {}),
      ...(body.timeGranularity ? { timeGranularity: body.timeGranularity } : {}),
      dataSource: body.dataSource ?? null,
      frequency: body.frequency ?? null,
      goalId: body.goalId ?? null,
      origin: "plan",
      ...(body.target ? { target: body.target } : {}),
      ...(calcType !== "manual" ? { spec: body.spec as Record<string, unknown> } : {}),
    });
    return NextResponse.json({ data: created, error: null }, { status: 201 });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}
