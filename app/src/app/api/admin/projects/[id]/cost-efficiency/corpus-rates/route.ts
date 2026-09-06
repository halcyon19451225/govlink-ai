export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { bigrams, scoreContext, fiscalRateStats } from "@/lib/corpus/match";

type Params = { params: { id: string } };

/**
 * 類似施策の財政効果率分布 — X7e（効率性評価＝第5階層のコストパネル用）
 *
 * GET ?q=<施策名・分野等の検索語（任意）>
 * - 対象は approved の corpus_evidence のうち fiscal_effect_rate を持つ行
 * - q があれば適合度（バイグラム）でしきい値未満を除外してから分布を取る
 * - **2件未満は null**（X6の単価分布と同じ「1件を相場に見せない」ルール）
 *
 * fiscal_effect_rate ＝ 年換算財政効果額 ÷ 事業費（cost_ratio の逆数に相当 — 042参照）
 */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "program_evaluation", "view");
  if (deny) return deny;

  try {
    const rows = await query<{
      id: string;
      title: string;
      field_category: string | null;
      effect_summary: string;
      fiscal_effect_rate: number;
      fiscal_note: string | null;
    }>(
      `SELECT id, title, field_category, effect_summary,
              fiscal_effect_rate::float AS fiscal_effect_rate, fiscal_note
       FROM corpus_evidence
       WHERE status = 'approved' AND fiscal_effect_rate IS NOT NULL
       ORDER BY updated_at DESC LIMIT 300`,
    );

    const qText = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    let target = rows;
    if (qText) {
      const q = bigrams(qText);
      // scoreContext と同系の簡易適合（タイトル・分野・要約）— しきい値未満は出さない
      target = rows.filter((r) => {
        const s = scoreContext(q, {
          id: r.id,
          kind: "trend",
          title: r.title,
          body: r.effect_summary,
          pestle_tag: "S",
          seven_s_tag: null,
          swot_hint: "neutral",
          region_scope: "national",
          region_code: null,
          population_band: null,
          field_category: r.field_category,
          source_org: "",
          source_url: null,
          published_at: null,
          effective_until: null,
        });
        return s >= 3;
      });
    }

    const stats = fiscalRateStats(target.map((r) => r.fiscal_effect_rate));
    const hasOverseas = target.some((r) => r.fiscal_note?.includes("海外"));
    return NextResponse.json({
      data: stats ? { ...stats, has_overseas: hasOverseas } : null,
      error: null,
    });
  } catch (e) {
    console.error("財政効果率分布の取得に失敗:", e);
    return NextResponse.json({ data: null, error: null }); // 表示は装飾 — 失敗で画面を汚さない
  }
}
