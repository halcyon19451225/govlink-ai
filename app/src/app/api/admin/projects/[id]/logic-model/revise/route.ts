export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { reviseLogicModel } from "@/lib/logicmodel/revise";

type Params = { params: { id: string } };

const bodySchema = z.object({
  /** この改訂を生んだ改善アクション（A工程から計画への還り道） */
  improvement_action_id: z.string().uuid().optional().nullable(),
  /** 起点の版。省略時は現行版 */
  from_model_id: z.string().uuid().optional().nullable(),
  /** 改訂の理由。版だけ増えて理由が分からない状態を作らないため必須 */
  reason: z.string().min(1, "改訂の理由を入力してください").max(500),
});

/**
 * ロジックモデルの改訂版を起こす。
 *
 * 現行版を上書きするのではなく、複製して新しい版を積む。
 * 過去の評価が参照している版は動かないので、
 * 「この評価は改訂前の版を前提にしていた」と後から説明できる。
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "logic_model", "edit");
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
    const result = await transaction(async (client) => {
      const revised = await reviseLogicModel(client, {
        projectId: params.id,
        fromModelId: d.from_model_id ?? null,
        reason: d.reason,
        improvementActionId: d.improvement_action_id ?? null,
      });
      if (!revised) return null;

      // リネージ: どの改善を理由に、どの版から派生したか
      const sourceIds = d.improvement_action_id
        ? await resolveArtifactIds(params.id, "program_evaluation", [d.improvement_action_id]).catch(
            () => [] as string[],
          )
        : [];
      await recordArtifact(
        {
          projectId: params.id,
          moduleId: "logic_model",
          artifactType: `logic_model_v${revised.version}`,
          artifactRecordId: revised.id,
          sourceArtifactIds: sourceIds,
          derivationNote: d.improvement_action_id
            ? `改善アクション(${d.improvement_action_id})により第${revised.revisedFromVersion}版から改訂: ${d.reason}`
            : `第${revised.revisedFromVersion}版から改訂: ${d.reason}`,
        },
        client,
      ).catch((e) => console.error("recordArtifact(logic_model revise) 失敗:", e));

      return revised;
    });

    if (!result) {
      return NextResponse.json(
        { data: null, error: "改訂の起点となるロジックモデルが見つかりません" },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: result, error: null }, { status: 201 });
  } catch (e) {
    console.error("ロジックモデルの改訂に失敗しました:", e);
    return NextResponse.json(
      { data: null, error: "改訂の作成に失敗しました" },
      { status: 500 },
    );
  }
}
