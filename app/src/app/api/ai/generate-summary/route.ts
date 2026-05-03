import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";

const kpiUpdateSchema = z.object({
  label: z.string(),
  target: z.union([z.number(), z.string()]).transform(Number).optional(),
  current: z.union([z.number(), z.string()]).transform(Number),
  unit: z.string().default(""),
});

const bodySchema = z.object({
  projectTitle: z.string().min(1, "政策名は必須です"),
  postType: z.enum(["plan", "progress", "result"], { message: "投稿タイプが不正です" }),
  body: z.string().min(1, "本文は必須です"),
  kpiUpdates: z.array(kpiUpdateSchema).default([]),
});

const POST_TYPE_LABEL: Record<"plan" | "progress" | "result", string> = {
  plan: "計画",
  progress: "進捗報告",
  result: "成果報告",
};

// 住民向け要約の生成指示（プロンプトキャッシュ対象）
const SYSTEM_PROMPT = `あなたは日本の地方自治体の広報担当者です。
以下の進捗報告を住民向けに2〜3文で要約してください。
専門用語を避け、わかりやすい言葉で書いてください。
数値目標に対する達成状況を必ず含めてください。
要約文のみを出力してください。前置きや説明は不要です。`;

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
    return NextResponse.json(
      { data: null, error: "ANTHROPIC_API_KEY が設定されていません" },
      { status: 500 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { data: null, error: "リクエストの形式が正しくありません" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { projectTitle, postType, body, kpiUpdates } = parsed.data;

  const kpiLines =
    kpiUpdates.length > 0
      ? "\nKPI更新:\n" +
        kpiUpdates
          .map((k) => {
            const targetPart = k.target !== undefined ? `（目標: ${k.target}${k.unit}）` : "";
            return `- ${k.label}: ${k.current}${k.unit}${targetPart}`;
          })
          .join("\n")
      : "";

  const userPrompt = `政策名: ${projectTitle}
投稿タイプ: ${POST_TYPE_LABEL[postType]}
本文:
${body}${kpiLines}`;

  const anthropic = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const claudeStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          system: [
            {
              type: "text" as const,
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userPrompt }],
        });

        for await (const event of claudeStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (error) {
        console.error("Claude summary streaming error:", error);
        controller.enqueue(encoder.encode(`\n__ERROR__: サマリー生成中にエラーが発生しました`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
