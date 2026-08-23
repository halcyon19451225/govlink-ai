export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";


// ─── スキーマ ─────────────────────────────────────────────────────────────────

const bodySchema = z.discriminatedUnion("mode", [
  // mode='goals'（デフォルト）: 目的提案
  z.object({
    mode: z.literal("goals").optional().default("goals"),
    planName: z.string().min(1, "計画名は必須です"),
    templateName: z.string().optional(),
    category: z.string().optional(),
    municipalityName: z.string().optional(),
  }),
  // mode='kpi': KPI指標提案
  z.object({
    mode: z.literal("kpi"),
    planName: z.string().default(""),
    purposeTitle: z.string().min(1, "目的タイトルは必須です"),
    municipalityName: z.string().optional(),
  }),
]);

// ─── JSON クリーニング ────────────────────────────────────────────────────────

function cleanJson(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const munIdForLimit = session.user?.municipalityId;
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

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  // mode を先読みして discriminatedUnion を解決
  const rawWithMode = typeof raw === "object" && raw !== null && !("mode" in raw)
    ? { ...raw, mode: "goals" }
    : raw;

  const parsed = bodySchema.safeParse(rawWithMode);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  try {
    // ─── mode='kpi': KPI指標提案 ────────────────────────────────────────────
    if (parsed.data.mode === "kpi") {
      const { purposeTitle, planName, municipalityName } = parsed.data;

      const prompt = `あなたは日本の自治体の政策立案を支援するAIアシスタントです。
${planName ? `計画名: ${planName}\n` : ""}${municipalityName ? `自治体名: ${municipalityName}\n` : ""}目的「${purposeTitle}」に対して、EBPM（証拠に基づく政策立案）の観点から測定可能なKPI指標を3〜5件提案してください。

以下の形式のJSONのみを返してください。説明文や前置きは不要です。
{
  "kpis": [
    {
      "indicator_name": "指標名（例: 要介護認定率）",
      "target_value": 数値（目標値）,
      "unit": "単位（例: %, 人, 件）",
      "baseline_description": "現状値の説明（例: 現状22.2%）"
    }
  ]
}`;

      const message = await aiCreateMessage({ taskType: "proposal.goals" }, {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("");

      const result = JSON.parse(cleanJson(text)) as {
        kpis: Array<{ indicator_name: string; target_value: number; unit: string; baseline_description?: string }>;
      };

      return NextResponse.json({ data: result, error: null });
    }

    // ─── mode='goals': 目的提案（デフォルト）───────────────────────────────
    const { planName, templateName, category, municipalityName } = parsed.data;

    const prompt = `あなたは日本の自治体の政策立案を支援するAIアシスタントです。
以下の計画について、EBPM（証拠に基づく政策立案）の観点から、計画の目的を3〜5つ提案してください。

計画名: ${planName}${templateName ? `\nテンプレート: ${templateName}` : ""}${category ? `\nカテゴリ: ${category}` : ""}${municipalityName ? `\n自治体名: ${municipalityName}` : ""}

目的は以下の形式のJSONのみを返してください。説明文や前置きは不要です。
{
  "goals": [
    {
      "title": "目的タイトル（20字以内）",
      "description": "目的の説明（50〜100字）"
    }
  ]
}`;

    const message = await aiCreateMessage({ taskType: "proposal.goals" }, {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    const result = JSON.parse(cleanJson(text)) as {
      goals: Array<{ title: string; description: string }>;
    };

    return NextResponse.json({ data: result, error: null });
  } catch (err) {
    console.error("suggest-goals error:", err);
    return NextResponse.json({ data: null, error: "AI提案の生成に失敗しました" }, { status: 500 });
  }
}
