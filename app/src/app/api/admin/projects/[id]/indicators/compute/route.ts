export const dynamic = "force-dynamic";

/**
 * 指標管理 — 一括取得（D4）
 *
 * 設計: claude/coe-dataset-model.md §9-6。
 * 基準日を1つ決めて、選んだ指標をまとめて計算する。**成功した分だけ履歴に積む。**
 * 失敗した指標は不足の案内として返り、画面は「どの箱をいつ時点で上げればよいか」を一覧にする。
 *
 * 計算式型は他の指標の値に依存するので、サービス層が**それ以外を先に**計算する。
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { requireModulePermission } from "@/lib/permissions";
import { actorFromSession } from "@/lib/activity";
import { indicatorErrorResponse } from "@/lib/indicator/http";
import { computeMany } from "@/lib/indicator/service";
import { describeMissing } from "@/lib/indicator/spec";

type Params = { params: { id: string } };

/** 1回で計算する指標の上限。これを超えるなら分けてもらう（画面で案内する） */
const MAX_BATCH = 50;

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  const deny = await requireModulePermission(session, params.id, "dataset_manager", "edit");
  if (deny) return deny;

  let body: { asOf?: string; indicatorIds?: string[] };
  try {
    body = (await req.json()) as { asOf?: string; indicatorIds?: string[] };
  } catch {
    return NextResponse.json({ data: null, error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  const ids = Array.isArray(body.indicatorIds) ? body.indicatorIds.filter((s) => typeof s === "string") : [];
  if (ids.length === 0) return NextResponse.json({ data: null, error: "指標を1つ以上選んでください" }, { status: 400 });
  if (ids.length > MAX_BATCH) {
    return NextResponse.json(
      { data: null, error: `一度に取得できるのは ${MAX_BATCH} 件までです。分けて実行してください` },
      { status: 400 },
    );
  }
  const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);

  try {
    const results = await computeMany(actorFromSession(session, "bulk"), params.id, ids, asOf);
    return NextResponse.json({
      data: {
        asOf,
        succeeded: results.filter((r) => r.ok).length,
        results: results.map((r) =>
          r.ok
            ? { ok: true, indicatorId: r.indicatorId, label: r.label, value: r.value }
            : {
                ok: false, indicatorId: r.indicatorId, label: r.label,
                missing: r.missing.map((m) => ({ ...m, message: describeMissing(m) })),
              },
        ),
      },
      error: null,
    });
  } catch (err) {
    return indicatorErrorResponse(err);
  }
}
