export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase-storage";
import { extractText, chunkText } from "@/lib/knowledge-extract";
import { setProgress, appendLog } from "@/lib/knowledge-progress";
import Anthropic from "@anthropic-ai/sdk";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";
const MODEL = "claude-sonnet-4-20250514";

type StepName = "extract" | "chunk" | "compile" | "merge";

interface StepBody {
  step: StepName;
  chunkIndex?: number;
}

interface DocRow {
  id: string;
  s3_key: string;
  file_type: string;
  extracted_text: string | null;
  total_chunks: number | null;
  processed_chunks: number | null;
  compiled_draft: unknown[] | null;
  document_category: string | null;
  category_id: string | null;
  status: string;
}

interface TagRow {
  id: string;
  name: string;
  slug: string;
  pdca_phase: string;
}

interface DraftItem {
  tag_slugs: string[];
  title: string;
  summary: string;
  key_points: string[];
  planning_implications: string[];
  terms: Record<string, string>;
}

interface ClaudeOutput {
  document_category?: string;
  items?: DraftItem[];
}

function stepProgress(step: StepName, chunkIndex: number, totalChunks: number): number {
  if (step === "extract") return 10;
  if (step === "chunk") return 20;
  if (step === "compile") return Math.round(20 + ((chunkIndex + 1) / totalChunks) * 60);
  if (step === "merge") return 100;
  return 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });
  }

  const { documentId } = params;
  const body = await req.json() as StepBody;
  const { step, chunkIndex = 0 } = body;

  // ドキュメント取得
  const rows = await query<DocRow>(
    `SELECT id, s3_key, file_type, extracted_text, total_chunks, processed_chunks,
            compiled_draft, document_category, category_id, status
     FROM knowledge_documents WHERE id = $1`,
    [documentId],
  );
  const doc = rows[0];
  if (!doc) {
    return NextResponse.json({ ok: false, error: "ドキュメントが見つかりません" }, { status: 404 });
  }

  try {
    // ─── extract ──────────────────────────────────────────────
    if (step === "extract") {
      await setProgress(documentId, {
        status: "processing",
        step: "extract",
        progress: 5,
      });
      await query(
        `UPDATE knowledge_documents SET processing_started_at = NOW() WHERE id = $1`,
        [documentId],
      );

      const buffer = await downloadFromStorage("knowledge", doc.s3_key).catch((e) => {
        throw new Error(`ファイルの取得に失敗しました: ${(e as Error).message}`);
      });

      const { text, truncated } = await extractText(buffer, doc.file_type);

      await query(
        `UPDATE knowledge_documents SET extracted_text = $1, updated_at = NOW() WHERE id = $2`,
        [text, documentId],
      );

      const msg = `テキスト抽出完了（${text.length.toLocaleString()}文字${truncated ? "・上限でカット" : ""}）`;
      await setProgress(documentId, { step: "extract", progress: 10 }, msg);

      return NextResponse.json({
        ok: true,
        currentStep: "extract",
        progress: 10,
        nextStep: "chunk",
      });
    }

    // ─── chunk ────────────────────────────────────────────────
    if (step === "chunk") {
      const text = doc.extracted_text ?? "";
      const chunks = chunkText(text);
      const total = chunks.length;

      await setProgress(
        documentId,
        { step: "chunk", progress: 20, totalChunks: total, processedChunks: 0 },
        `${total}個のチャンクに分割`,
      );

      return NextResponse.json({
        ok: true,
        currentStep: "chunk",
        progress: 20,
        nextStep: "compile",
        nextChunkIndex: 0,
        totalChunks: total,
      });
    }

    // ─── compile ──────────────────────────────────────────────
    if (step === "compile") {
      const text = doc.extracted_text ?? "";
      const chunks = chunkText(text);
      const total = chunks.length;
      const chunk = chunks[chunkIndex];

      if (!chunk) {
        return NextResponse.json({ ok: false, error: `チャンク${chunkIndex}が存在しません` }, { status: 400 });
      }

      // このドキュメントに付与されたタグを取得
      const tags = await query<TagRow>(
        `SELECT t.id, t.name, t.slug, t.pdca_phase
         FROM knowledge_document_tags dt
         JOIN knowledge_tags t ON t.id = dt.tag_id
         WHERE dt.document_id = $1`,
        [documentId],
      );

      const client = new Anthropic();
      const prompt = `あなたは行政計画策定の専門家です。文書の一部（チャンク）を分析し、指定されたPDCA工程タグに沿って構造化してください。

【このドキュメントに付与されたタグ】
${JSON.stringify(tags.map((t) => ({ slug: t.slug, name: t.name })))}

【チャンク本文】
${chunk}

以下のJSON形式のみで回答（前置きやバッククォート不要）:
{
  "document_category": "law|guideline|research|plan|policy|ordinance|other",
  "items": [
    {
      "tag_slugs": ["該当するタグのslug（上記タグ一覧の中から1つ以上）"],
      "title": "要素の見出し（短く）",
      "summary": "要点（200字以内）",
      "key_points": ["キーポイント"],
      "planning_implications": ["計画策定上の留意点"],
      "terms": {"用語": "定義"}
    }
  ]
}`;

      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
      let parsed: ClaudeOutput = { items: [] };
      try {
        // JSONブロック抽出
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as ClaudeOutput;
      } catch {
        parsed = { items: [] };
      }

      const newItems: DraftItem[] = (parsed.items ?? []).map((item) => ({
        tag_slugs: item.tag_slugs ?? [],
        title: item.title ?? "",
        summary: item.summary ?? "",
        key_points: item.key_points ?? [],
        planning_implications: item.planning_implications ?? [],
        terms: item.terms ?? {},
      }));

      const detectedCategory = parsed.document_category ?? null;

      // 既存 compiled_draft に追記
      const existingDraft = Array.isArray(doc.compiled_draft) ? doc.compiled_draft : [];
      const updatedDraft = [...existingDraft, ...newItems];

      const newProcessed = chunkIndex + 1;
      const newProgress = stepProgress("compile", chunkIndex, total);

      const catUpdate = detectedCategory && !doc.document_category
        ? `, document_category = '${detectedCategory}'`
        : "";

      await query(
        `UPDATE knowledge_documents
         SET compiled_draft = $1::jsonb,
             processed_chunks = $2,
             processing_progress = $3,
             processing_step = 'compile',
             updated_at = NOW()
             ${catUpdate}
         WHERE id = $4`,
        [JSON.stringify(updatedDraft), newProcessed, newProgress, documentId],
      );

      await appendLog(documentId, "compile", `チャンク ${chunkIndex + 1}/${total} を編纂`);

      const isLast = newProcessed >= total;
      return NextResponse.json({
        ok: true,
        currentStep: "compile",
        progress: newProgress,
        nextStep: isLast ? "merge" : "compile",
        nextChunkIndex: isLast ? undefined : chunkIndex + 1,
        totalChunks: total,
        done: false,
      });
    }

    // ─── merge ────────────────────────────────────────────────
    if (step === "merge") {
      const draft = Array.isArray(doc.compiled_draft) ? (doc.compiled_draft as DraftItem[]) : [];

      // カテゴリに紐づく辞書を取得（なければ作成）
      const categoryId = doc.category_id;
      let dictRows = await query<{ id: string; dict_data: Record<string, unknown>; version: number }>(
        `SELECT id, dict_data, version FROM knowledge_dicts
         WHERE tier = 1 AND category_id = $1`,
        [categoryId],
      );

      if (dictRows.length === 0) {
        const ins = await query<{ id: string }>(
          `INSERT INTO knowledge_dicts (tier, category_id, dict_data, version)
           VALUES (1, $1, '{"version":0,"sections":[],"global_terms":{},"planning_checklist":[]}', 0)
           RETURNING id`,
          [categoryId],
        );
        dictRows = await query<{ id: string; dict_data: Record<string, unknown>; version: number }>(
          `SELECT id, dict_data, version FROM knowledge_dicts WHERE id = $1`,
          [ins[0]!.id],
        );
      }

      const dictRow = dictRows[0]!;
      const dictData = dictRow.dict_data as {
        version: number;
        sections: Array<{
          id: string;
          title: string;
          category: string;
          summary: string;
          key_points: string[];
          planning_implications: string[];
          terms: Record<string, string>;
          pdca_tags: string[];
          source_document_ids: string[];
          last_updated: string;
        }>;
        global_terms: Record<string, string>;
        planning_checklist: string[];
      };

      const existingSections = dictData.sections ?? [];
      const globalTerms = dictData.global_terms ?? {};
      const docCategory = doc.document_category ?? "other";

      for (const item of draft) {
        // 同タイトル近似でマージ
        const existing = existingSections.find(
          (s) => s.title === item.title,
        );
        if (existing) {
          existing.key_points = Array.from(new Set([...existing.key_points, ...item.key_points]));
          existing.planning_implications = Array.from(
            new Set([...existing.planning_implications, ...item.planning_implications]),
          );
          existing.terms = { ...existing.terms, ...item.terms };
          existing.pdca_tags = Array.from(new Set([...(existing.pdca_tags ?? []), ...item.tag_slugs]));
          existing.last_updated = new Date().toISOString();
          if (!existing.source_document_ids.includes(documentId)) {
            existing.source_document_ids.push(documentId);
          }
        } else {
          existingSections.push({
            id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            title: item.title,
            category: docCategory,
            summary: item.summary,
            key_points: item.key_points,
            planning_implications: item.planning_implications,
            terms: item.terms,
            pdca_tags: item.tag_slugs,
            source_document_ids: [documentId],
            last_updated: new Date().toISOString(),
          });
        }

        Object.assign(globalTerms, item.terms);
      }

      const newVersion = (dictRow.version ?? dictData.version ?? 0) + 1;
      const newDictData = {
        ...dictData,
        version: newVersion,
        sections: existingSections,
        global_terms: globalTerms,
      };

      await query(
        `UPDATE knowledge_dicts
         SET dict_data = $1::jsonb, version = $2, updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(newDictData), newVersion, dictRow.id],
      );

      await query(
        `UPDATE knowledge_documents
         SET status = 'compiled', processing_step = 'done', processing_progress = 100,
             compiled_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [documentId],
      );

      await appendLog(documentId, "merge", `ナレッジ辞書へ統合完了（version ${newVersion}）`);

      return NextResponse.json({
        ok: true,
        currentStep: "merge",
        progress: 100,
        nextStep: null,
        done: true,
      });
    }

    return NextResponse.json({ ok: false, error: `未知のステップ: ${step}` }, { status: 400 });

  } catch (e) {
    const msg = e instanceof Error ? e.message : "不明なエラーが発生しました";
    await setProgress(
      documentId,
      { status: "error", step: step, errorMessage: msg },
      msg,
    );
    return NextResponse.json({ ok: false, currentStep: step, error: msg, progress: 0 });
  }
}
