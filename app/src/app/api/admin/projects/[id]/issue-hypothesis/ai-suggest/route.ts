export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const bodySchema = z.object({
  gap_analysis_id: z.string().uuid("ギャップ分析 ID が不正です"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  const munIdForLimit = session!.user?.municipalityId;
  if (munIdForLimit) {
    const limitCheck = await checkLimit(munIdForLimit, "ai_calls");
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { data: null, error: "AI生成回数の上限に達しました", upgrade_url: "/pricing" },
        { status: 403 },
      );
    }
    await incrementAiUsage(munIdForLimit);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { data: null, error: "ANTHROPIC_API_KEY が設定されていません" },
      { status: 500 },
    );
  }

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

  const { gap_analysis_id } = parsed.data;

  // ギャップ分析データを取得
  const gap = await queryOne<{
    id: string;
    indicator_name: string;
    indicator_unit: string | null;
    current_value: number | null;
    current_year: number | null;
    target_value: number | null;
    gap_value: number | null;
    affected_population: number | null;
    trend: string | null;
    notes: string | null;
  }>(
    `SELECT id, indicator_name, indicator_unit,
            current_value::float, current_year,
            target_value::float, gap_value::float,
            affected_population::float, trend, notes
     FROM gap_analyses
     WHERE id = $1 AND project_id = $2`,
    [gap_analysis_id, params.id],
  );

  if (!gap) {
    return NextResponse.json(
      { data: null, error: "指定されたギャップ分析が見つかりません" },
      { status: 404 },
    );
  }

  const unit = gap.indicator_unit ?? "";
  const gapDesc = [
    `指標: ${gap.indicator_name}`,
    `現状値: ${gap.current_value ?? "不明"}${unit}（${gap.current_year ?? ""}年度）`,
    `目標値: ${gap.target_value ?? "不明"}${unit}`,
    `ギャップ量: ${gap.gap_value ?? "不明"}${unit}`,
    gap.affected_population ? `影響人口: ${gap.affected_population}人` : null,
    gap.trend ? `トレンド: ${{ improving: "改善傾向", worsening: "悪化傾向", stable: "横ばい", unknown: "不明" }[gap.trend] ?? gap.trend}` : null,
    gap.notes ? `備考: ${gap.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");


  const message = await aiCreateMessage({ taskType: "proposal.issue_hypothesis", projectId: params.id }, {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [
      {
        type: "text" as const,
        text: `あなたは日本の地方自治体の政策アナリストです。
ギャップ分析の結果をもとに、課題仮説（根本原因と提案施策）をJSON形式で生成してください。
以下のキーのみを含むJSONを返してください:
- title: 課題仮説のタイトル（30文字以内）
- description: 課題の概要（100文字以内）
- root_cause: 根本原因の分析（150文字以内）
- proposed_measures: 具体的な施策の配列（3〜5件）
マークダウンのコードブロックは使わず、JSONのみを出力してください。`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `以下のギャップ分析結果をもとに、課題仮説を生成してください。\n\n${gapDesc}`,
      },
    ],
  });

  const rawText =
    message.content[0]?.type === "text" ? message.content[0].text.trim() : "";

  type Suggestion = {
    title: string;
    description: string;
    root_cause: string;
    proposed_measures: string[];
  };
  let suggestion: Suggestion | null = null;

  try {
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonText = fenceMatch?.[1] ?? rawText;
    const obj = JSON.parse(jsonText) as unknown;
    if (
      typeof obj === "object" &&
      obj !== null &&
      "title" in obj &&
      "root_cause" in obj &&
      "proposed_measures" in obj
    ) {
      suggestion = obj as Suggestion;
    }
  } catch {
    return NextResponse.json(
      { data: null, error: "AI応答の解析に失敗しました" },
      { status: 500 },
    );
  }

  if (!suggestion) {
    return NextResponse.json(
      { data: null, error: "AI応答の形式が不正です" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      gap_analysis_id,
      suggestion,
    },
    error: null,
  });
}
