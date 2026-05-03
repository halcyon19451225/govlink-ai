import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";

const client = new Anthropic();

const bodySchema = z.object({
  planName: z.string().min(1, "計画名は必須です"),
  templateName: z.string().optional(),
  category: z.string().optional(),
  municipalityName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { planName, templateName, category, municipalityName } = parsed.data;

  const prompt = `あなたは日本の自治体の政策立案を支援するAIアシスタントです。
以下の計画について、EBPM（証拠に基づく政策立案）の観点から、計画の基本目標を3〜5つ提案してください。

計画名: ${planName}${templateName ? `\nテンプレート: ${templateName}` : ""}${category ? `\nカテゴリ: ${category}` : ""}${municipalityName ? `\n自治体名: ${municipalityName}` : ""}

基本目標は以下の形式のJSONのみを返してください。説明文や前置きは不要です。
{
  "goals": [
    {
      "title": "目標タイトル（20字以内）",
      "description": "目標の説明（50〜100字）"
    }
  ]
}`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const result = JSON.parse(cleaned) as { goals: Array<{ title: string; description: string }> };

    return NextResponse.json({ data: result, error: null });
  } catch (err) {
    console.error("suggest-goals error:", err);
    return NextResponse.json({ data: null, error: "AI提案の生成に失敗しました" }, { status: 500 });
  }
}
