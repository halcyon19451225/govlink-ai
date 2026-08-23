export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { sanitizeExtractionProposals } from "@/lib/corpus/types";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";
const MAX_TEXT_CHARS = 80_000;

type Params = { params: { documentId: string } };

/**
 * ナレッジ文書からの施策・エビデンス抽出 — X3
 *
 * GET  … この文書の最新の抽出（提案）を返す
 * POST … AIで抽出を実行し、提案として保存する（コーパスにはまだ入れない）
 *
 * 方針（コーパス汚染の防止）:
 * - AIは「文書に書かれている事実」の構造化だけを行う（推測・補完をしない指示）
 * - 提案は knowledge_extractions に置かれ、担当者が確認・修正して
 *   取り込む（intake）まで corpus_* には入らない
 * - 出典（文書名＋該当箇所）を必ず持たせる — 妥当性の追跡
 */

function guard(session: Session | null) {
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  const row = await queryOne(
    `SELECT id, document_id, status, proposals, intake_result,
            decided_by, decided_at::text, created_at::text
     FROM knowledge_extractions
     WHERE document_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [params.documentId],
  );
  return NextResponse.json({ data: row ?? null, error: null });
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
    const result = await mammoth.extractRawText({ buffer });
    return result.value.slice(0, MAX_TEXT_CHARS);
  }
  return buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_extraction",
  description: "文書から拾い上げた施策・エビデンス情報を構造化して記録します。",
  input_schema: {
    type: "object",
    properties: {
      measures: {
        type: "array",
        description: "文書に記載されている施策・事業（最大10件）",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "施策・事業の名称" },
            field_category: { type: "string", description: "分野（介護予防・子育て・防災 等）" },
            approach: { type: "string", description: "作用機序: 何にどう働きかける施策か（文書の記載に基づく）" },
            target_population: { type: "string", description: "対象者" },
            target_size: { type: "number", description: "対象規模（人数。記載がある場合のみ）" },
            intervention: { type: "string", description: "介入内容（何を・頻度・期間・強度）" },
            delivery: { type: "string", description: "実施体制（直営・委託・住民主体 等）" },
            structure_indicators: { type: "array", items: { type: "string" }, description: "体制・投入の指標（記載があれば）" },
            process_indicators: { type: "array", items: { type: "string" }, description: "実施量・実施率の指標（記載があれば）" },
            outcome_notes: { type: "array", items: { type: "string" }, description: "成果指標・目標値の記載（例: 参加率 目標50%）" },
            total_budget: { type: "number", description: "事業費（円。記載がある場合のみ）" },
            unit_cost: { type: "number", description: "単価（円。記載がある場合のみ）" },
            cost_per_outcome_note: { type: "string", description: "費用対効果に関する記載" },
            funding: { type: "string", description: "財源（交付金・補助金等の記載）" },
            effect_note: { type: "string", description: "実績・効果の記載（数値があればそのまま）" },
            source_note: { type: "string", description: "出典の箇所（章・節・ページ等）— 必ず書く" },
          },
          required: ["title", "source_note"],
        },
      },
      evidence: {
        type: "array",
        description: "文書に記載されている効果検証・調査研究の結果（最大15件）",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "検証・研究の内容が分かる題名" },
            source: { type: "string", description: "出典（文書名・発行元。この文書自体なら文書名）" },
            url: { type: "string" },
            year: { type: "number" },
            design: {
              type: "string",
              enum: ["sr", "rct", "qed", "prepost", "case"],
              description: "研究デザイン: sr=系統的レビュー / rct=RCT / qed=準実験 / prepost=前後比較 / case=事例報告。文書の記載から正直に判定（不明なら case）",
            },
            evidence_level: { type: "number", description: "1〜5（design の既定でよい。過大評価しない）" },
            population: { type: "string", description: "検証の対象集団" },
            effect_summary: { type: "string", description: "効果の要約（数値があればそのまま）" },
            transferability: { type: "string", description: "対象・環境の特性（外的妥当性の判断材料）" },
            field_category: { type: "string" },
            source_note: { type: "string", description: "出典の箇所（章・節・ページ等）— 必ず書く" },
          },
          required: ["title", "source", "effect_summary", "source_note"],
        },
      },
    },
    required: ["measures", "evidence"],
  },
};

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = guard(session);
  if (deny) return deny;

  const doc = await queryOne<{
    id: string;
    title: string;
    file_type: string;
    s3_key: string;
    extracted_text: string | null;
  }>(
    `SELECT id, title, file_type, s3_key, extracted_text
     FROM knowledge_documents WHERE id = $1 AND tier = 1`,
    [params.documentId],
  );
  if (!doc) {
    return NextResponse.json({ data: null, error: "文書が見つかりません（Tier1のみ対象）" }, { status: 404 });
  }

  let text = doc.extracted_text ?? "";
  if (!text) {
    try {
      text = await extractText(doc.s3_key, doc.file_type);
      await query(`UPDATE knowledge_documents SET extracted_text = $1, updated_at = now() WHERE id = $2`, [
        text,
        doc.id,
      ]);
    } catch (e) {
      console.error("テキスト抽出に失敗:", e);
      return NextResponse.json({ data: null, error: "文書のテキスト抽出に失敗しました" }, { status: 500 });
    }
  }
  if (!text.trim()) {
    return NextResponse.json({ data: null, error: "文書にテキストがありません" }, { status: 422 });
  }

  const systemText = `あなたは日本の自治体政策のアナリストです。
与えられた文書から、施策（事業）とエビデンス（効果検証・調査研究の結果）の情報を拾い上げ、
record_extraction ツールで構造化してください。

【厳守】
- **文書に書かれている事実だけ**を記録する。推測・補完・一般論の追加をしない。
- 数値（対象規模・事業費・効果量・目標値）は記載どおりに写す。単位を変えない。
- 各項目に source_note（文書内の該当箇所: 章・節・ページ・見出し等）を必ず付ける。
- エビデンスの design は記載から正直に判定する。対照群の記述が無いのに rct や qed に
  しない。判定できなければ case（事例報告）とし、evidence_level を過大にしない。
- 該当する情報が無ければ空配列でよい（無理に拾わない）。
- この抽出結果は担当者が確認・修正したうえで、自治体横断の学習データ（コーパス）に
  取り込まれる。誤った構造化は下流の政策提案の妥当性を壊すことを意識する。`;

  const message = await aiCreateMessage(
    { taskType: "knowledge.extract" },
    {
      max_tokens: 4000,
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "record_extraction" },
      messages: [
        {
          role: "user",
          content: `文書名: ${doc.title}\n\n----- 文書本文 -----\n${text}`,
        },
      ],
    },
  );

  const toolUse = message.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_extraction",
  );
  if (!toolUse) {
    return NextResponse.json({ data: null, error: "AI応答の解析に失敗しました" }, { status: 502 });
  }

  const proposals = sanitizeExtractionProposals(toolUse.input);
  // 出典の既定: 文書名を補う
  for (const m of proposals.measures) {
    m.source_note = m.source_note ? `${doc.title} / ${m.source_note}` : doc.title;
  }
  for (const e of proposals.evidence) {
    e.source_note = e.source_note ? `${doc.title} / ${e.source_note}` : doc.title;
  }

  const row = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_extractions (document_id, proposals)
     VALUES ($1, $2::jsonb) RETURNING id`,
    [doc.id, JSON.stringify(proposals)],
  );

  return NextResponse.json({
    data: {
      extraction_id: row?.id ?? null,
      proposals,
      counts: { measures: proposals.measures.length, evidence: proposals.evidence.length },
    },
    error: null,
  });
}
