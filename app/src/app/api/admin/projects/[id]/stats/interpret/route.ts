export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { aiCreateMessage } from "@/lib/ai/gateway";

const bodySchema = z.object({
  module: z.string(),
  data: z.record(z.string(), z.unknown()),
});

// このハンドラは元々ルートパラメータを受け取っていなかった（[id] 配下なのに
// project を一切参照していなかった）。テナント境界のために params を受け取る
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
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

  const { module, data } = parsed.data;

  const prompt = `あなたは日本の介護保険行政の専門家です。以下の統計データを分析し、自治体担当者向けに分かりやすく日本語で解釈・解説してください（200字以内）。\n\nモジュール: ${module}\nデータ: ${JSON.stringify(data, null, 2)}`;

  const message = await aiCreateMessage({ taskType: "analysis.stats" }, {
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const interpretation = (message.content[0] as { text: string }).text;

  return NextResponse.json({ data: { interpretation }, error: null });
}
