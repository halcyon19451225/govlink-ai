export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { query } from "@/lib/db";

const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  rct: "ランダム化比較試験（RCT）",
  observational: "観察研究",
  case_study: "事例研究",
  expert: "専門家意見",
  statistics: "統計データ",
  other: "その他",
};

const SYSTEM_PROMPT = `あなたはEBPM（証拠に基づく政策立案）の専門家です。
以下のエビデンスの妥当性を評価してください:
1. エビデンスの強度評価（★1〜5の理由）
2. 因果関係の妥当性（1〜2文）
3. 注意すべき限界・バイアス（1〜2文）
日本語で簡潔に回答してください。`;

const bodySchema = z.object({
  evidenceId: z.string().uuid("evidenceId が不正です"),
  description: z.string().min(1, "説明は必須です"),
  evidenceType: z.string().min(1),
  strength: z.number().int().min(1).max(5),
});

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ data: null, error: "ANTHROPIC_API_KEY が設定されていません" }, { status: 500 });
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

  const { evidenceId, description, evidenceType, strength } = parsed.data;

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `エビデンス種別: ${EVIDENCE_TYPE_LABEL[evidenceType] ?? evidenceType}
強度評価: ★${strength}
説明: ${description}`,
      },
    ],
  });

  const validity =
    message.content[0]?.type === "text" ? message.content[0].text : "評価を生成できませんでした";

  await query("UPDATE evidences SET ai_validity = $1 WHERE id = $2", [validity, evidenceId]);

  return NextResponse.json({ data: { validity }, error: null });
}
