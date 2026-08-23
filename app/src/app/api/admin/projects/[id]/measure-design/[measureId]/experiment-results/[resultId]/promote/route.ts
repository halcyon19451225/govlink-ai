export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import {
  normalizeEvidenceItems,
  type EvidenceStatus,
  type ExperimentDesignKey,
} from "@/lib/measure/types";
import {
  EXPERIMENT_RESULT_COLUMNS as RESULT_COLUMNS,
  isEffectDirection,
  levelForResult,
  resultToEvidenceItem,
  statusAfterPromotion,
} from "@/lib/measure/experimentResult";

type Params = { params: { id: string; measureId: string; resultId: string } };

/**
 * 実験結果の昇格 — X2（エビデンス循環の閉じ目）
 *
 * 確定済み（confirmed）の実験結果を「参照可能なエビデンス」にする:
 *   1. 設計種別＋実施状況からエビデンスレベルを自動判定
 *      （levelForResult: RCT系=4 / 準実験=3 / 前後比較=2、逸脱時は-1）
 *   2. EvidenceItem に変換して施策の evidence_items へ追加
 *   3. 施策の evidence_status を更新（レベル3以上→sufficient、
 *      1〜2は none→partial。下げることはない）
 *   4. 結果に promoted_at / evidence_level を刻む（以後、編集・削除不可）
 * すべて1トランザクションで行う（途中で落ちて片側だけ変わることを防ぐ）。
 *
 * 昇格済みエビデンスは次の施策構築の対話で「参照可能なエビデンス」として
 * 提示される（chat ルートが確定済み施策の evidence_items を注入する）。
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  try {
    const out = await transaction(async (client) => {
      // 行ロックを取り、二重昇格・並行更新を防ぐ
      const resultRes = await client.query(
        `SELECT id, design, implemented_as_planned, deviation_note,
                to_char(period_start, 'YYYY-MM-DD') AS period_start,
                to_char(period_end, 'YYYY-MM-DD') AS period_end,
                sample_size, primary_outcome, result_summary,
                effect_direction, effect_size, status, promoted_at::text
         FROM experiment_results
         WHERE id = $1 AND measure_design_id = $2 AND project_id = $3
         FOR UPDATE`,
        [params.resultId, params.measureId, params.id],
      );
      const result = resultRes.rows[0];
      if (!result) return { error: "実験結果が見つかりません", status: 404 };
      if (result.promoted_at) return { error: "この実験結果はすでに昇格済みです", status: 422 };
      if (result.status !== "confirmed") {
        return {
          error: "昇格できるのは確定済み（confirmed）の実験結果だけです。先に内容を確定してください",
          status: 422,
        };
      }

      const measureRes = await client.query(
        `SELECT id, title, target_population, evidence_status, evidence_items
         FROM measure_designs
         WHERE id = $1 AND project_id = $2
         FOR UPDATE`,
        [params.measureId, params.id],
      );
      const measure = measureRes.rows[0];
      if (!measure) return { error: "施策が見つかりません", status: 404 };

      const design = result.design as ExperimentDesignKey;
      const direction = isEffectDirection(result.effect_direction)
        ? result.effect_direction
        : "unclear";
      const level = levelForResult(design, result.implemented_as_planned);
      const item = resultToEvidenceItem(
        {
          design,
          implemented_as_planned: result.implemented_as_planned,
          deviation_note: result.deviation_note,
          period_start: result.period_start,
          period_end: result.period_end,
          sample_size: result.sample_size,
          primary_outcome: result.primary_outcome,
          result_summary: result.result_summary,
          effect_direction: direction,
          effect_size: result.effect_size,
        },
        { measureTitle: measure.title, targetPopulation: measure.target_population },
      );

      const items = [...normalizeEvidenceItems(measure.evidence_items), item];
      const nextStatus = statusAfterPromotion(
        measure.evidence_status as EvidenceStatus,
        level,
      );

      await client.query(
        `UPDATE measure_designs
         SET evidence_items = $1::jsonb, evidence_status = $2, updated_at = now()
         WHERE id = $3`,
        [JSON.stringify(items), nextStatus, params.measureId],
      );

      const updatedRes = await client.query(
        `UPDATE experiment_results
         SET promoted_at = now(), evidence_level = $1, updated_at = now()
         WHERE id = $2
         RETURNING ${RESULT_COLUMNS}`,
        [level, params.resultId],
      );

      return {
        data: {
          result: updatedRes.rows[0],
          evidence_item: item,
          evidence_status: nextStatus,
          evidence_level: level,
        },
      };
    });

    if ("error" in out && out.error) {
      return NextResponse.json({ data: null, error: out.error }, { status: out.status ?? 422 });
    }
    return NextResponse.json({ data: (out as { data: unknown }).data, error: null });
  } catch (e) {
    console.error("実験結果の昇格に失敗:", e);
    return NextResponse.json({ data: null, error: "昇格処理に失敗しました" }, { status: 500 });
  }
}
