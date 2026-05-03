import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

const SYSTEM_PROMPT = `あなたは日本の地方自治体の政策担当者です。
アップロードされた文書を以下の観点で要約してください:
1. 文書の種別と目的（1文）
2. 主要な内容・決定事項（3〜5箇条）
3. 政策評価への示唆（1〜2文）
日本語で簡潔に回答してください。`;

export async function POST(
  _req: NextRequest, // eslint-disable-line @typescript-eslint/no-unused-vars
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ data: null, error: "ANTHROPIC_API_KEY が設定されていません" }, { status: 500 });
  }

  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    return NextResponse.json({ data: null, error: "S3_BUCKET_NAME が設定されていません" }, { status: 500 });
  }

  const docs = await query<{ id: string; s3_key: string; file_name: string }>(
    "SELECT id, s3_key, file_name FROM documents WHERE id = $1",
    [params.id],
  );

  const doc = docs[0];
  if (!doc) {
    return NextResponse.json({ data: null, error: "ドキュメントが見つかりません" }, { status: 404 });
  }

  let fileText: string;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: doc.s3_key }));
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) throw new Error("ファイルが空です");
    fileText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return NextResponse.json({ data: null, error: "S3 からファイルの取得に失敗しました" }, { status: 500 });
  }

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `ファイル名: ${doc.file_name}\n\n---\n\n${fileText.slice(0, 8000)}`,
      },
    ],
  });

  const summary =
    message.content[0]?.type === "text" ? message.content[0].text : "要約を生成できませんでした";

  await query("UPDATE documents SET ai_summary = $1 WHERE id = $2", [summary, doc.id]);

  return NextResponse.json({ data: { summary }, error: null });
}
