export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const BUCKET = process.env.S3_BUCKET_NAME ?? "";
const MAX_TEXT_CHARS = 80_000;

type Params = { params: { documentId: string } };

interface DocRow {
  id: string;
  title: string;
  file_type: string;
  s3_key: string;
  status: string;
}

interface DictRow {
  id: string;
  dict_data: Record<string, unknown>;
}

interface ClaudeResult {
  document_category: string;
  section_id: string;
  section_title: string;
  is_new_section: boolean;
  summary: string;
  key_points: string[];
  planning_implications: string[];
  new_terms: Record<string, string>;
  diff_from_existing: string;
}

async function extractTextFromS3(s3Key: string, fileType: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  if (fileType === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text.slice(0, MAX_TEXT_CHARS);
  }

  if (fileType === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.slice(0, MAX_TEXT_CHARS);
  }

  // txt / other: attempt UTF-8 decode
  return buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const { documentId } = params;

  const doc = await queryOne<DocRow>(
    `SELECT id, title, file_type, s3_key, status FROM knowledge_documents WHERE id = $1 AND tier = 1`,
    [documentId],
  );
  if (!doc) {
    return NextResponse.json({ data: null, error: "文書が見つかりません" }, { status: 404 });
  }

  // Step 1: ステータスを processing に更新
  await query(
    `UPDATE knowledge_documents SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [documentId],
  );

  try {
    // Step 2: テキスト抽出
    const extractedText = await extractTextFromS3(doc.s3_key, doc.file_type);

    await query(
      `UPDATE knowledge_documents SET extracted_text = $1, updated_at = NOW() WHERE id = $2`,
      [extractedText, documentId],
    );

    // Step 3: 既存ナレッジ辞書の取得
    const dictRow = await queryOne<DictRow>(
      `SELECT id, dict_data FROM knowledge_dicts WHERE tier = 1 AND municipality_id IS NULL`,
    );

    const existingDict = dictRow?.dict_data ?? { version: 0, sections: [], global_terms: {}, planning_checklist: [] };

    // Step 4: Claude API呼び出し
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY が設定されていません");

    const anthropic = new Anthropic({ apiKey });

    const prompt = `あなたは行政計画策定の専門家です。
以下のドキュメントを分析し、既存のナレッジ辞書に統合してください。

【既存のナレッジ辞書】
${JSON.stringify(existingDict, null, 2).slice(0, 20000)}

【新しいドキュメント】
タイトル: ${doc.title}
内容:
${extractedText.slice(0, 40000)}

以下のJSON形式で回答してください（マークダウンのコードブロックは使わず、JSONのみ出力）:
{
  "document_category": "law|guideline|research|plan|policy|ordinance|other",
  "section_id": "既存セクションIDまたは新規ID（snake_case）",
  "section_title": "セクションタイトル",
  "is_new_section": true,
  "summary": "このドキュメントの要約（300字以内）",
  "key_points": ["重要ポイント1", "重要ポイント2"],
  "planning_implications": ["介護保険事業計画策定上の留意点1", "留意点2"],
  "new_terms": {"用語名": "定義・説明"},
  "diff_from_existing": "既存ナレッジとの差分・追加情報の説明"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("");

    // JSON抽出
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude APIからJSON形式の応答が得られませんでした");

    const result = JSON.parse(jsonMatch[0]) as ClaudeResult;

    // Step 5: 辞書更新
    const sections = (existingDict as { sections?: unknown[] }).sections ?? [];
    const now = new Date().toISOString();

    if (result.is_new_section) {
      sections.push({
        id: result.section_id,
        title: result.section_title,
        category: result.document_category,
        summary: result.summary,
        key_points: result.key_points,
        planning_implications: result.planning_implications,
        terms: result.new_terms,
        source_document_ids: [documentId],
        last_updated: now,
      });
    } else {
      const idx = sections.findIndex(
        (s) => (s as { id?: string }).id === result.section_id,
      );
      if (idx >= 0) {
        const existing = sections[idx] as Record<string, unknown>;
        sections[idx] = {
          ...existing,
          summary: result.summary,
          key_points: result.key_points,
          planning_implications: result.planning_implications,
          terms: { ...(existing.terms as Record<string, string> ?? {}), ...result.new_terms },
          source_document_ids: [
            ...((existing.source_document_ids as string[]) ?? []),
            documentId,
          ],
          last_updated: now,
        };
      } else {
        // セクションIDが見つからない場合は新規追加
        sections.push({
          id: result.section_id,
          title: result.section_title,
          category: result.document_category,
          summary: result.summary,
          key_points: result.key_points,
          planning_implications: result.planning_implications,
          terms: result.new_terms,
          source_document_ids: [documentId],
          last_updated: now,
        });
      }
    }

    const currentVersion = ((existingDict as { version?: number }).version ?? 0);
    const updatedDict = {
      ...existingDict,
      version: currentVersion + 1,
      last_compiled: now,
      sections,
      global_terms: {
        ...((existingDict as { global_terms?: Record<string, string> }).global_terms ?? {}),
        ...result.new_terms,
      },
    };

    // 辞書の更新またはINSERT
    if (dictRow?.id) {
      await query(
        `UPDATE knowledge_dicts SET dict_data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updatedDict), dictRow.id],
      );
    } else {
      await query(
        `INSERT INTO knowledge_dicts (tier, municipality_id, dict_data) VALUES (1, NULL, $1::jsonb)`,
        [JSON.stringify(updatedDict)],
      );
    }

    // knowledge_document_sections に記録
    if (dictRow?.id) {
      await query(
        `INSERT INTO knowledge_document_sections (document_id, dict_id, section_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [documentId, dictRow.id, result.section_id],
      );
    }

    // Step 6: ステータスを compiled に更新
    await query(
      `UPDATE knowledge_documents
       SET status = 'compiled', document_category = $1, compiled_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [result.document_category, documentId],
    );

    return NextResponse.json({ data: { status: "compiled", sectionId: result.section_id }, error: null });

  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラー";
    await query(
      `UPDATE knowledge_documents SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [message, documentId],
    );
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
