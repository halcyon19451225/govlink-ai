export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { aiCreateMessage, type AiCallContext } from "@/lib/ai/gateway";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { queryOne } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { requireModulePermission } from "@/lib/permissions";
import { buildSystemPrompt, RECORD_TURN_TOOL, type KpiContext } from "@/lib/asis/prompt";
import { retrieveGrounding } from "@/lib/corpus/retrieval";
import {
  isPestleKey,
  isSevenSKey,
  type AsisMessage,
  type AsisStep,
  type CrossAnalysis,
  type ExternalItem,
  type InternalItem,
  type SwotData,
} from "@/lib/asis/types";

type Params = { params: { id: string; asisId: string } };

// message は任意。未指定/null（初回ブートストラップ）の場合は
// 既にシード済みの最初のAI質問をそのまま返す。
const bodySchema = z.object({
  message: z.string().trim().max(2000).nullish(),
});

interface AsisRow {
  id: string;
  kpi_id: string | null;
  title: string;
  status: "in_progress" | "completed";
  current_step: AsisStep;
  messages: AsisMessage[];
  swot: SwotData;
  cross_analysis: CrossAnalysis;
  project_title: string;
  kpi_label: string | null;
  kpi_target: number | null;
  kpi_unit: string | null;
  kpi_condition: KpiContext["condition"];
  kpi_deadline: string | null;
  kpi_current_value: number | null;
  kpi_gap_value: number | null;
}

// AIツール出力の安全な取り込み
function sanitizeExternal(arr: unknown): ExternalItem[] {
  if (!Array.isArray(arr)) return [];
  const out: ExternalItem[] = [];
  for (const it of arr) {
    if (
      it &&
      typeof it === "object" &&
      typeof (it as { text?: unknown }).text === "string" &&
      isPestleKey((it as { pestle?: unknown }).pestle)
    ) {
      out.push({
        text: (it as { text: string }).text,
        pestle: (it as { pestle: ExternalItem["pestle"] }).pestle,
      });
    }
  }
  return out;
}

function sanitizeInternal(arr: unknown): InternalItem[] {
  if (!Array.isArray(arr)) return [];
  const out: InternalItem[] = [];
  for (const it of arr) {
    if (
      it &&
      typeof it === "object" &&
      typeof (it as { text?: unknown }).text === "string" &&
      isSevenSKey((it as { seven_s?: unknown }).seven_s)
    ) {
      out.push({
        text: (it as { text: string }).text,
        seven_s: (it as { seven_s: InternalItem["seven_s"] }).seven_s,
      });
    }
  }
  return out;
}

function sanitizeCross(obj: unknown): CrossAnalysis | null {
  if (!obj || typeof obj !== "object") return null;
  const pick = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const o = obj as Record<string, unknown>;
  return { so: pick(o.so), wo: pick(o.wo), st: pick(o.st), wt: pick(o.wt) };
}

function hasCross(c: CrossAnalysis): boolean {
  return c.so.length > 0 || c.wo.length > 0 || c.st.length > 0 || c.wt.length > 0;
}

// 回答ヒントの安全な取り込み（最大4件・1件200文字まで）
function sanitizeSuggestions(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 200))
    .slice(0, 4);
}

// Anthropic API 呼び出し。web_search（サーバーツール）利用時の pause_turn 継続と、
// record_turn が返らなかった場合の強制リトライを面倒見る。
async function callRecordTurn(
  ctx: AiCallContext,
  systemText: string,
  aiMessages: Anthropic.MessageParam[],
  opts: { allowWebSearch: boolean },
): Promise<Anthropic.ToolUseBlock | null> {
  const tools: NonNullable<Anthropic.MessageCreateParams["tools"]> = opts.allowWebSearch
    ? [
        RECORD_TURN_TOOL,
        { type: "web_search_20250305", name: "web_search", max_uses: 2 },
      ]
    : [RECORD_TURN_TOOL];

  const system = [
    { type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } },
  ];

  let messages: Anthropic.MessageParam[] = aiMessages;
  let response = await aiCreateMessage(ctx, {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system,
    tools,
    // web_search を使わせるため強制はしない（プロンプトで record_turn 締めを指示済み）
    tool_choice: opts.allowWebSearch ? { type: "auto" } : { type: "tool", name: "record_turn" },
    messages,
  });

  // サーバーツール実行が長引くと pause_turn で返るため、続きを要求する（最大3回）
  for (let i = 0; i < 3 && response.stop_reason === "pause_turn"; i++) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await aiCreateMessage(ctx, {
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system,
      tools,
      tool_choice: { type: "auto" },
      messages,
    });
  }

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === "record_turn",
  );
  if (toolUse) return toolUse;

  // record_turn で締めなかった場合: web_search なしで強制リトライ
  if (opts.allowWebSearch) {
    return callRecordTurn(ctx, systemText, aiMessages, { allowWebSearch: false });
  }
  return null;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { data: null, error: "ANTHROPIC_API_KEY が設定されていません" },
      { status: 500 },
    );
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

  const asis = await queryOne<AsisRow>(
    `SELECT a.id, a.kpi_id, a.title, a.status, a.current_step,
            a.messages, a.swot, a.cross_analysis,
            p.title AS project_title, k.label AS kpi_label,
            k.target::float          AS kpi_target,
            k.unit                   AS kpi_unit,
            k.achievement_condition  AS kpi_condition,
            to_char(k.target_deadline, 'YYYY-MM-DD') AS kpi_deadline,
            g.current_value::float   AS kpi_current_value,
            g.gap_value::float       AS kpi_gap_value
     FROM asis_analyses a
     JOIN projects p ON p.id = a.project_id
     LEFT JOIN kpis k ON k.id = a.kpi_id
     LEFT JOIN gap_analyses g ON g.kpi_id = a.kpi_id AND g.project_id = a.project_id
     WHERE a.id = $1 AND a.project_id = $2`,
    [params.asisId, params.id],
  );
  if (!asis) {
    return NextResponse.json({ data: null, error: "現状整理が見つかりません" }, { status: 404 });
  }

  // 初回ブートストラップ: message 未指定の場合はシード済みの最初のAI質問を返す
  const trimmedMessage = parsed.data.message?.trim() ?? "";
  if (trimmedMessage === "") {
    const lastAssistant = [...asis.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    return NextResponse.json({
      data: {
        reply: lastAssistant?.content ?? "",
        current_step: asis.current_step,
        status: asis.status,
        swot: asis.swot,
        cross_analysis: asis.cross_analysis,
        messages: asis.messages,
      },
      error: null,
    });
  }

  // プラン上限チェック
  const munIdForLimit = session!.user?.municipalityId;
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

  const userMessage: AsisMessage = {
    role: "user",
    content: trimmedMessage,
    step: asis.current_step,
  };
  const history = [...asis.messages, userMessage];

  const aiCtx = { taskType: "dialogue.asis", projectId: params.id } as const;
  const aiMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ナレッジ（管理画面で作成した辞書）を照会し、回答ヒントの一次情報源として注入
  let knowledgeContext = "";
  try {
    knowledgeContext = await getKnowledgeContext(params.id);
  } catch {
    knowledgeContext = ""; // ナレッジ照会に失敗しても対話自体は継続する
  }

  // 横断コーパスの接地（X4）。ルーティングが claude なら何もしない
  let corpusBlock: string | null = null;
  try {
    const grounding = await retrieveGrounding({
      taskType: "dialogue.asis",
      projectId: params.id,
      contextId: params.asisId,
      queryText: `${asis.project_title} ${asis.kpi_label ?? ""}`.slice(0, 600),
    });
    if (grounding.mode === "assist" || grounding.mode === "primary") {
      corpusBlock = [grounding.measureBlock, grounding.evidenceBlock]
        .filter(Boolean)
        .join("\n\n") || null;
    }
  } catch {
    corpusBlock = null;
  }

  const systemText = buildSystemPrompt({
    projectTitle: asis.project_title,
    kpiLabel: asis.kpi_label,
    kpiContext: asis.kpi_label
      ? {
          indicatorName: asis.kpi_label,
          targetValue: asis.kpi_target,
          unit: asis.kpi_unit ?? "",
          condition: asis.kpi_condition,
          deadline: asis.kpi_deadline,
          currentValue: asis.kpi_current_value,
          gapValue: asis.kpi_gap_value,
        }
      : null,
    currentStep: asis.current_step,
    swot: asis.swot,
    knowledgeContext,
    corpusBlock,
  });

  let toolUse: Anthropic.ToolUseBlock | null;
  try {
    toolUse = await callRecordTurn(aiCtx, systemText, aiMessages, {
      allowWebSearch: true,
    });
  } catch {
    return NextResponse.json(
      { data: null, error: "AIとの通信に失敗しました" },
      { status: 502 },
    );
  }
  if (!toolUse) {
    return NextResponse.json(
      { data: null, error: "AI応答の解析に失敗しました" },
      { status: 500 },
    );
  }

  const input = toolUse.input as Record<string, unknown>;
  let reply = typeof input.reply === "string" ? input.reply : "（応答を取得できませんでした）";
  const parsePhase = (v: unknown, fallback: AsisStep): AsisStep =>
    v === "external" || v === "internal" || v === "cross" || v === "done" ? v : fallback;
  let phase = parsePhase(input.phase, asis.current_step);
  let completed = input.completed === true || phase === "done";

  // SWOT をマージ
  let swot: SwotData = {
    opportunities: [
      ...asis.swot.opportunities,
      ...sanitizeExternal(input.new_opportunities),
    ],
    threats: [...asis.swot.threats, ...sanitizeExternal(input.new_threats)],
    strengths: [...asis.swot.strengths, ...sanitizeInternal(input.new_strengths)],
    weaknesses: [...asis.swot.weaknesses, ...sanitizeInternal(input.new_weaknesses)],
  };

  const newCross = sanitizeCross(input.cross_analysis);
  let cross: CrossAnalysis =
    newCross && hasCross(newCross) ? newCross : asis.cross_analysis;
  let suggestions = sanitizeSuggestions(input.suggestions);

  // ── クロス分析ガード ──────────────────────────────
  // cross_analysis が空のまま完了しようとした場合は完了を認めず、
  // クロス分析の作成を強制する追いターンを1回だけ自動実行する。
  if (completed && !hasCross(cross)) {
    let recovered = false;
    try {
      const retryUse = await callRecordTurn(
        aiCtx,
        systemText,
        [
          ...aiMessages,
          { role: "assistant", content: reply },
          {
            role: "user",
            content:
              "（システムからの自動指示）クロス分析がまだ作成されていません。これまでに整理した強み・弱み・機会・脅威を掛け合わせ、cross_analysis（so/wo/st/wt 各1件以上）を必ず出力し、reply で4戦略の要点を担当者に分かりやすく提示したうえで completed=true としてください。",
          },
        ],
        { allowWebSearch: false },
      );
      if (retryUse) {
        const rInput = retryUse.input as Record<string, unknown>;
        const rCross = sanitizeCross(rInput.cross_analysis);
        if (rCross && hasCross(rCross)) {
          cross = rCross;
          reply = typeof rInput.reply === "string" ? rInput.reply : reply;
          swot = {
            opportunities: [
              ...swot.opportunities,
              ...sanitizeExternal(rInput.new_opportunities),
            ],
            threats: [...swot.threats, ...sanitizeExternal(rInput.new_threats)],
            strengths: [...swot.strengths, ...sanitizeInternal(rInput.new_strengths)],
            weaknesses: [...swot.weaknesses, ...sanitizeInternal(rInput.new_weaknesses)],
          };
          suggestions = sanitizeSuggestions(rInput.suggestions);
          phase = "done";
          recovered = true;
        }
      }
    } catch {
      // 回復失敗時は下のフェーズ降格にフォールスルー
    }
    if (!recovered) {
      // それでもクロス分析が得られなければ完了を取り消し、cross フェーズへ降格
      completed = false;
      phase = "cross";
    }
  }

  const assistantMessage: AsisMessage = {
    role: "assistant",
    content: reply,
    step: phase,
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
  const messages = [...history, assistantMessage];
  const nextStatus = completed ? "completed" : "in_progress";

  await queryOne(
    `UPDATE asis_analyses
     SET messages = $1::jsonb, swot = $2::jsonb, cross_analysis = $3::jsonb,
         current_step = $4, status = $5
     WHERE id = $6 AND project_id = $7
     RETURNING id`,
    [
      JSON.stringify(messages),
      JSON.stringify(swot),
      JSON.stringify(cross),
      phase,
      nextStatus,
      params.asisId,
      params.id,
    ],
  );

  return NextResponse.json({
    data: {
      reply,
      current_step: phase,
      status: nextStatus,
      swot,
      cross_analysis: cross,
      messages,
    },
    error: null,
  });
}
