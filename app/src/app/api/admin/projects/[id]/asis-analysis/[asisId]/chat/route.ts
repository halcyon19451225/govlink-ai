export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { buildSystemPrompt, RECORD_TURN_TOOL, type KpiContext } from "@/lib/asis/prompt";
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

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
  if (deny) return deny;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
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

  const anthropic = new Anthropic({ apiKey });
  const aiMessages = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: [
        {
          type: "text" as const,
          text: buildSystemPrompt({
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
          }),
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [RECORD_TURN_TOOL],
      tool_choice: { type: "tool", name: "record_turn" },
      messages: aiMessages,
    });
  } catch {
    return NextResponse.json(
      { data: null, error: "AIとの通信に失敗しました" },
      { status: 502 },
    );
  }

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
  );
  if (!toolUse) {
    return NextResponse.json(
      { data: null, error: "AI応答の解析に失敗しました" },
      { status: 500 },
    );
  }

  const input = toolUse.input as Record<string, unknown>;
  const reply = typeof input.reply === "string" ? input.reply : "（応答を取得できませんでした）";
  const phaseRaw = input.phase;
  const phase: AsisStep =
    phaseRaw === "external" ||
    phaseRaw === "internal" ||
    phaseRaw === "cross" ||
    phaseRaw === "done"
      ? phaseRaw
      : asis.current_step;
  const completed = input.completed === true || phase === "done";

  // SWOT をマージ
  const swot: SwotData = {
    opportunities: [
      ...asis.swot.opportunities,
      ...sanitizeExternal(input.new_opportunities),
    ],
    threats: [...asis.swot.threats, ...sanitizeExternal(input.new_threats)],
    strengths: [...asis.swot.strengths, ...sanitizeInternal(input.new_strengths)],
    weaknesses: [...asis.swot.weaknesses, ...sanitizeInternal(input.new_weaknesses)],
  };

  const newCross = sanitizeCross(input.cross_analysis);
  const cross: CrossAnalysis =
    newCross &&
    (newCross.so.length ||
      newCross.wo.length ||
      newCross.st.length ||
      newCross.wt.length)
      ? newCross
      : asis.cross_analysis;

  const assistantMessage: AsisMessage = { role: "assistant", content: reply, step: phase };
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
