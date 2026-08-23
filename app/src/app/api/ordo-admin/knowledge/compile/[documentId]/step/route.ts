export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { extractText, chunkText } from "@/lib/knowledge-extract";
import { setProgress, appendLog } from "@/lib/knowledge-progress";
import { triggerNextStep } from "@/lib/chain-fetch";
import { aiCreateMessage } from "@/lib/ai/gateway";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";
const MODEL = "claude-sonnet-4-6";

type StepName = "extract" | "chunk" | "compile" | "merge";

interface StepBody {
  step: StepName;
  chunkIndex?: number;
  chainToken?: string;
  background?: boolean;
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
  chain_token: string | null;
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

/**
 * 重複判定用の正規化: 前後空白除去・連続空白を1つに・末尾の句読点除去・小文字化。
 * 表記揺れ（空白や末尾「。」の有無など）による重複を吸収する。
 */
function normalizeText(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[。、．，.,;；:：・\s]+$/g, "")
    .toLowerCase();
}

/** base に無い incoming のみを正規化比較で追加する（元の表記は保持）。 */
function mergeUniqueStrings(base: string[], incoming: string[]): string[] {
  const seen = new Set(base.map(normalizeText).filter(Boolean));
  const out = [...base];
  for (const item of incoming) {
    const n = normalizeText(item);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(item);
    }
  }
  return out;
}

async function pingChain(documentId: string): Promise<void> {
  await query(
    `UPDATE knowledge_documents SET last_chain_ping_at = NOW() WHERE id = $1`,
    [documentId],
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { documentId: string } },
) {
  const { documentId } = params;
  let body: StepBody;
  try {
    body = await req.json() as StepBody;
  } catch {
    console.error("[step] request.json() parse failed — body was truncated or empty");
    return NextResponse.json({ ok: false, error: "invalid request body" }, { status: 400 });
  }
  const { step, chunkIndex = 0, chainToken, background = false } = body;

  // background リクエストはセッション不要（自己fetch）
  // フロント起動リクエストはセッション必須
  if (!background) {
    const session = await getServerSession(authOptions);
    if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
      return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });
    }
  }

  // ドキュメント取得
  const rows = await query<DocRow>(
    `SELECT id, s3_key, file_type, extracted_text, total_chunks, processed_chunks,
            compiled_draft, document_category, category_id, status, chain_token
     FROM knowledge_documents WHERE id = $1`,
    [documentId],
  );
  const doc = rows[0];
  if (!doc) {
    return NextResponse.json({ ok: false, error: "ドキュメントが見つかりません" }, { status: 404 });
  }

  // 多重起動防止ガード（backgroundリクエストのみ）
  if (background && chainToken) {
    if (doc.chain_token !== chainToken) {
      // 古い系列 or 重複起動 → 黙って終了
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  try {
    await pingChain(documentId);

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
      await pingChain(documentId);

      if (chainToken) {
        triggerNextStep(documentId, "chunk", undefined, chainToken);
      }

      return NextResponse.json({
        ok: true,
        currentStep: "extract",
        progress: 10,
        nextStep: "chunk",
        done: false,
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
      await pingChain(documentId);

      if (chainToken) {
        triggerNextStep(documentId, "compile", 0, chainToken);
      }

      return NextResponse.json({
        ok: true,
        currentStep: "chunk",
        progress: 20,
        nextStep: "compile",
        nextChunkIndex: 0,
        totalChunks: total,
        done: false,
      });
    }

    // ─── compile ──────────────────────────────────────────────
    if (step === "compile") {
      const text = doc.extracted_text ?? "";
      const chunks = chunkText(text);
      const total = chunks.length;
      const chunk = chunks[chunkIndex];

      if (!chunk) {
        throw new Error(`チャンク${chunkIndex}が存在しません`);
      }

      const tags = await query<TagRow>(
        `SELECT t.id, t.name, t.slug, t.pdca_phase
         FROM knowledge_document_tags dt
         JOIN knowledge_tags t ON t.id = dt.tag_id
         WHERE dt.document_id = $1`,
        [documentId],
      );

      const prompt = `あなたは行政計画策定の専門家です。文書の一部（チャンク）を分析し、指定されたPDCA工程タグに沿って構造化してください。

【このドキュメントに付与されたタグ】
${JSON.stringify(tags.map((t) => ({ slug: t.slug, name: t.name })))}

【チャンク本文】
${chunk}

【重要・重複の取捨選択】
- 同じ趣旨のキーポイントや留意点は1つに統合し、言い回しだけ異なる重複・冗長な再掲は出力しない。
- 定型的な前置き・章見出しのみの内容や、計画策定の知見として価値の薄い記述は items に含めない。
- 同一トピックは1つの item にまとめ、title は内容を端的に表す安定した見出しにする（後段で既存辞書と突き合わせて統合するため）。

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

      const message = await aiCreateMessage({ taskType: "knowledge.compile" }, {
        model: MODEL,
        // 2048 だと日本語の構造化JSONが途中で打ち切られ（stop_reason=max_tokens）、
        // パース失敗→items:[] でチャンクのデータが丸ごと消失するため十分に確保する。
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
      let parsed: ClaudeOutput = { items: [] };
      let parseFailed = false;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]) as ClaudeOutput;
        else parseFailed = true;
      } catch {
        parseFailed = true;
        parsed = { items: [] };
      }

      // 出力打ち切り・パース失敗をサイレントに握りつぶさず記録する
      if (message.stop_reason === "max_tokens" || parseFailed) {
        const reason = message.stop_reason === "max_tokens"
          ? "AI出力がトークン上限で打ち切られました"
          : "AI出力のJSON解析に失敗しました";
        console.error(`[compile] chunk ${chunkIndex}: ${reason} (stop_reason=${message.stop_reason})`);
        await appendLog(documentId, "compile", `チャンク ${chunkIndex + 1}: ${reason}（このチャンクはスキップ）`);
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
      await pingChain(documentId);

      const isLast = newProcessed >= total;
      const nextStep = isLast ? "merge" : "compile";
      const nextChunkIndex = isLast ? undefined : chunkIndex + 1;

      if (chainToken) {
        triggerNextStep(documentId, nextStep, nextChunkIndex, chainToken);
      }

      return NextResponse.json({
        ok: true,
        currentStep: "compile",
        progress: newProgress,
        nextStep,
        nextChunkIndex,
        totalChunks: total,
        done: false,
      });
    }

    // ─── merge ────────────────────────────────────────────────
    if (step === "merge") {
      const draft = Array.isArray(doc.compiled_draft) ? (doc.compiled_draft as DraftItem[]) : [];

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
        // タイトルは正規化比較でマッチ（表記揺れ・チャンク間/文書間の重複を吸収）。
        // existingSections には本ループ内で追加したものも含むため、ドラフト内の重複も統合される。
        const itemTitleNorm = normalizeText(item.title);
        const existing = existingSections.find((s) => normalizeText(s.title) === itemTitleNorm);
        if (existing) {
          existing.key_points = mergeUniqueStrings(existing.key_points, item.key_points);
          existing.planning_implications = mergeUniqueStrings(
            existing.planning_implications,
            item.planning_implications,
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

      // 完了: chain_token をクリア
      await query(
        `UPDATE knowledge_documents
         SET status = 'compiled', processing_step = 'done', processing_progress = 100,
             compiled_at = NOW(), chain_token = NULL, updated_at = NOW()
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
    // エラー時: chain_token をクリアしてチェーン停止
    await setProgress(
      documentId,
      { status: "error", step: step, errorMessage: msg },
      msg,
    );
    await query(
      `UPDATE knowledge_documents SET chain_token = NULL WHERE id = $1`,
      [documentId],
    );
    return NextResponse.json({ ok: false, currentStep: step, error: msg, progress: 0 });
  }
}
