export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";

const MAX_TEXT_CHARS = 80_000;

type Params = { params: { documentId: string } };

interface DocRow { id: string; title: string; file_type: string; s3_key: string; municipality_id: string }
interface DictRow { id: string; dict_data: Record<string, unknown> }
interface ClaudeResult {
  document_category: string; section_id: string; section_title: string; is_new_section: boolean;
  summary: string; key_points: string[]; planning_implications: string[];
  new_terms: Record<string, string>; diff_from_existing: string;
}

async function extractText(s3Key: string, fileType: string): Promise<string> {
  const buffer = await downloadFromStorage("knowledge", s3Key);

  if (fileType === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text.slice(0, MAX_TEXT_CHARS);
  }
  if (fileType === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer })).value.slice(0, MAX_TEXT_CHARS);
  }
  return buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;
  const { documentId } = params;

  const doc = await queryOne<DocRow>(
    `SELECT id, title, file_type, s3_key, municipality_id
     FROM knowledge_documents WHERE id = $1 AND tier = 2 AND municipality_id = $2`,
    [documentId, municipalityId],
  );
  if (!doc) return NextResponse.json({ data: null, error: "文書が見つかりません" }, { status: 404 });

  await query(
    `UPDATE knowledge_documents SET status = 'processing', updated_at = NOW() WHERE id = $1`,
    [documentId],
  );

  try {
    const extractedText = await extractText(doc.s3_key, doc.file_type);
    await query(`UPDATE knowledge_documents SET extracted_text = $1 WHERE id = $2`, [extractedText, documentId]);

    // Tier2辞書を取得（なければ作成）
    let dictRow = await queryOne<DictRow>(
      `SELECT id, dict_data FROM knowledge_dicts WHERE tier = 2 AND municipality_id = $1`,
      [municipalityId],
    );
    if (!dictRow) {
      const ins = await query<{ id: string }>(
        `INSERT INTO knowledge_dicts (tier, municipality_id, dict_data)
         VALUES (2, $1, '{"version":0,"sections":[],"global_terms":{}}')
         RETURNING id`,
        [municipalityId],
      );
      dictRow = { id: ins[0]!.id, dict_data: { version: 0, sections: [], global_terms: {} } };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    const anthropic = new Anthropic({ apiKey });

    const existingDict = dictRow.dict_data;
    const prompt = `あなたは行政計画策定の専門家です。ドキュメントを分析し、ナレッジ辞書に統合してください。

【既存のナレッジ辞書】
${JSON.stringify(existingDict, null, 2).slice(0, 15000)}

【新しいドキュメント】タイトル: ${doc.title}
${extractedText.slice(0, 40000)}

JSON形式のみで回答:
{"document_category":"law|guideline|research|plan|policy|ordinance|other","section_id":"snake_case_id","section_title":"タイトル","is_new_section":true,"summary":"要約300字","key_points":["ポイント"],"planning_implications":["留意点"],"new_terms":{"用語":"定義"},"diff_from_existing":"差分説明"}`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = msg.content.filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text).join("");
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON形式の応答が得られませんでした");
    const result = JSON.parse(jsonMatch[0]) as ClaudeResult;

    const sections = (existingDict as { sections?: unknown[] }).sections ?? [];
    const now = new Date().toISOString();

    if (result.is_new_section) {
      sections.push({
        id: result.section_id, title: result.section_title, category: result.document_category,
        summary: result.summary, key_points: result.key_points,
        planning_implications: result.planning_implications, terms: result.new_terms,
        source_document_ids: [documentId], last_updated: now,
      });
    } else {
      const idx = sections.findIndex((s) => (s as { id?: string }).id === result.section_id);
      if (idx >= 0) {
        const ex = sections[idx] as Record<string, unknown>;
        sections[idx] = { ...ex, summary: result.summary, key_points: result.key_points,
          planning_implications: result.planning_implications,
          terms: { ...(ex.terms as Record<string, string> ?? {}), ...result.new_terms },
          source_document_ids: [...((ex.source_document_ids as string[]) ?? []), documentId],
          last_updated: now };
      } else {
        sections.push({ id: result.section_id, title: result.section_title, category: result.document_category,
          summary: result.summary, key_points: result.key_points, planning_implications: result.planning_implications,
          terms: result.new_terms, source_document_ids: [documentId], last_updated: now });
      }
    }

    const updatedDict = {
      ...existingDict, version: ((existingDict as { version?: number }).version ?? 0) + 1,
      last_compiled: now, sections,
      global_terms: { ...((existingDict as { global_terms?: Record<string, string> }).global_terms ?? {}), ...result.new_terms },
    };

    await query(
      `UPDATE knowledge_dicts SET dict_data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(updatedDict), dictRow.id],
    );
    await query(
      `INSERT INTO knowledge_document_sections (document_id, dict_id, section_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [documentId, dictRow.id, result.section_id],
    );
    await query(
      `UPDATE knowledge_documents SET status='compiled', document_category=$1, compiled_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [result.document_category, documentId],
    );

    return NextResponse.json({ data: { status: "compiled", sectionId: result.section_id }, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "不明なエラー";
    await query(
      `UPDATE knowledge_documents SET status='error', error_message=$1, updated_at=NOW() WHERE id=$2`,
      [msg, documentId],
    );
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
