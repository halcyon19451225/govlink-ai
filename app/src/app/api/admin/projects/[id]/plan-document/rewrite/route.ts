export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { normalizeSections } from "@/lib/plan/document";
import { chaptersOfDocKind, docKindOf, taskTypeOfDocKind, variantOfDocKind } from "@/lib/plan/evalReport";

type Params = { params: { id: string } };

const MODULE = "logic_model";

/**
 * 章別リライト（PL2 P③ / PL3 A①）— 指定した1章だけをAIで書き直す
 * doc=plan（計画書・generation.plan_doc）/ doc=eval（評価報告書・generation.eval_report）
 * - locked=true / finalized は拒否（手動編集・確定スナップショットの保護）
 * - 既存本文＋指示を渡して書き直す。実データの数値は本文の記載を保つよう指示
 */

const REWRITE_TOOL: Anthropic.Tool = {
  name: "record_rewritten_section",
  description: "書き直した章の本文と要約を記録します。",
  input_schema: {
    type: "object",
    properties: {
      body_md: {
        type: "string",
        description:
          "書き直した本文（Markdown軽量: ## 小見出し / - 箇条書き / 1. 番号付き / 段落）。元本文の数値・指標名・施策名は変えない",
      },
      summary: { type: "string", description: "書き直した章の要約（2〜3文）" },
    },
    required: ["body_md", "summary"],
  },
};

const bodySchema = z.object({
  doc: z.enum(["plan", "eval", "deck"]).optional(),
  section_id: z.string().min(1).max(60),
  instruction: z.string().min(1).max(2000),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

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
  const { section_id, instruction } = parsed.data;
  const kind = docKindOf(parsed.data.doc);
  const variant = variantOfDocKind(kind);
  const taskType = taskTypeOfDocKind(kind);

  const doc = await queryOne<{ id: string; status: string; sections: unknown }>(
    `SELECT id, status, sections FROM plan_documents WHERE project_id = $1 AND variant = $2`,
    [params.id, variant],
  );
  if (!doc) {
    return NextResponse.json(
      { data: null, error: "計画書がまだありません（先に「章立てを起こす」を実行）" },
      { status: 404 },
    );
  }
  if (doc.status === "finalized") {
    return NextResponse.json(
      { data: null, error: "確定済みの計画書はリライトできません（確定を解除してください）" },
      { status: 409 },
    );
  }

  const sections = normalizeSections(doc.sections);
  const target = sections.find((s) => s.id === section_id);
  if (!target) {
    return NextResponse.json({ data: null, error: "指定の章が見つかりません" }, { status: 404 });
  }
  if (target.locked) {
    return NextResponse.json(
      { data: null, error: "この章はロックされています（ロックを解除するとリライトできます）" },
      { status: 409 },
    );
  }
  if (!target.body_md.trim()) {
    return NextResponse.json(
      { data: null, error: "この章はまだ本文がありません（先に「章立てを起こす」で下書きを生成）" },
      { status: 400 },
    );
  }

  const chapterDef = chaptersOfDocKind(kind).find((c) => c.id === section_id);
  const system =
    kind === "deck"
      ? `あなたは日本の地方自治体の住民向け広報を支援するコミュニケーションの専門家です。
受益者向け説明資料の一つのスライドを、利用者の指示に従って書き直し、record_rewritten_section ツールで返してください。

【厳守】
- **元の内容にある数値・名称・日付は変えない**。新しい事実を创作しない（不明はプレースホルダのまま）。
- body_md は「- 」の箇条書きのみ（1枚6項目以内・1項目40字以内目安）。受益者向けの平易な言葉。
- summary は**読み原稿（ノート欄）**: 話し言葉（です・ます調）・250〜350字（45〜60秒）。
  スライド本文に合わせて読み原稿も書き直す。`
      : `あなたは日本の地方自治体の${kind === "eval" ? "政策評価" : "計画策定"}を支援するアナリストです。
${kind === "eval" ? "評価結果報告書" : "行政計画書"}の一つの章を、利用者の指示に従って書き直し、record_rewritten_section ツールで返してください。

【厳守】
- **元本文にある数値・指標名・施策名・到達度・出典は変えない**。新しい事実を创作しない。
- 指示が文体・構成・分量の変更なら内容は保ったまま体裁だけ変える。
- 文体は行政文書（である調・簡潔）。書式は Markdown軽量（## 小見出し / - 箇条書き / 1. 番号付き / 段落）。
- summary（2〜3文の要約）も本文に合わせて書き直す。`;

  const summaryLabel = kind === "deck" ? "現在の読み原稿（ノート欄）" : "現在の要約";
  const userContent = `【${kind === "deck" ? "スライド" : "章"}】${target.heading}${chapterDef ? `（狙い: ${chapterDef.brief}）` : ""}

【現在の本文】
${target.body_md}

【${summaryLabel}】
${target.summary || "（未作成）"}

【書き直しの指示】
${instruction}`;

  try {
    const message = await aiCreateMessage(
      { taskType, projectId: params.id },
      {
        max_tokens: 6000,
        system: [{ type: "text", text: system }],
        tools: [REWRITE_TOOL],
        tool_choice: { type: "tool", name: "record_rewritten_section" },
        messages: [{ role: "user", content: userContent }],
      },
    );
    const toolUse = message.content.find(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_rewritten_section",
    );
    const input = toolUse?.input as { body_md?: unknown; summary?: unknown } | undefined;
    const bodyMd = typeof input?.body_md === "string" ? input.body_md.trim().slice(0, 20_000) : "";
    if (!bodyMd) {
      return NextResponse.json({ data: null, error: "AI応答の解析に失敗しました" }, { status: 502 });
    }
    const summary = typeof input?.summary === "string" ? input.summary.trim().slice(0, 1_000) : target.summary;

    const updated = sections.map((s) =>
      s.id === section_id ? { ...s, body_md: bodyMd, summary } : s,
    );
    // リライト適用は pending 状態を挟まず即置換（章ロックで手動編集を守る設計）。
    // 楽観ロック: sections が読み取り時から変わっていたら上書きしない
    const row = await queryOne<{ id: string }>(
      `UPDATE plan_documents SET sections = $1::jsonb, updated_at = now()
       WHERE id = $2 AND status = 'draft' AND sections = $3::jsonb
       RETURNING id`,
      [JSON.stringify(updated), doc.id, JSON.stringify(sections)],
    );
    if (!row) {
      return NextResponse.json(
        { data: null, error: "他の編集と競合しました。画面を更新して再実行してください" },
        { status: 409 },
      );
    }
    return NextResponse.json({
      data: { section: updated.find((s) => s.id === section_id) ?? null, sections: updated },
      error: null,
    });
  } catch (e) {
    console.error("章のリライトに失敗:", e);
    return NextResponse.json({ data: null, error: "リライトに失敗しました" }, { status: 500 });
  }
}
