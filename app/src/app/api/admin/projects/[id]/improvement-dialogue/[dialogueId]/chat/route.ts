export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { queryOne } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { requireModulePermission } from "@/lib/permissions";
import { callDialogueTool, sanitizeStringArray } from "@/lib/ai/dialogueTurn";
import { buildImprovementContext } from "@/lib/improvement/context";
import {
  IMPROVEMENT_STEP_ORDER,
  RECORD_IMPROVEMENT_TURN_TOOL,
  buildImprovementSystemPrompt,
  type ImprovementStep,
} from "@/lib/improvement/prompt";
import type { ImprovementProposal, ImprovementMessage } from "@/lib/improvement/types";

type Params = { params: { id: string; dialogueId: string } };

const MODULE = "self_evaluation";

const bodySchema = z.object({
  message: z.string().trim().max(4000).nullish(),
});

interface DialogueRow {
  id: string;
  program_evaluation_id: string | null;
  status: "in_progress" | "completed";
  current_step: ImprovementStep;
  messages: ImprovementMessage[];
  proposals: ImprovementProposal[];
}

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const REFLECT_VALUES = ["schedule_task", "kpi", "measure_design", "logic_model", "issue_hypothesis"];

function sanitizeProposals(arr: unknown): ImprovementProposal[] {
  if (!Array.isArray(arr)) return [];
  const out: ImprovementProposal[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const title = str(o.title, 200);
    if (!title) continue;
    const id = str(o.id, 40) || `a${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const rawPriority = typeof o.priority === "number" ? o.priority : Number(o.priority);
    const reflect =
      typeof o.reflect_target === "string" && REFLECT_VALUES.includes(o.reflect_target)
        ? (o.reflect_target as NonNullable<ImprovementProposal["reflect_target"]>)
        : null;
    const proposal: ImprovementProposal = {
      id,
      title,
      detail: str(o.detail, 1000),
      root_cause: str(o.root_cause, 600),
      expected_effect: str(o.expected_effect, 600),
      evidence: sanitizeStringArray(o.evidence, { maxItems: 6, maxLength: 400 }),
      owner_department: str(o.owner_department, 120),
      due_hint: str(o.due_hint, 120),
      priority: Number.isFinite(rawPriority) ? Math.max(1, Math.round(rawPriority)) : null,
      carry_over: o.carry_over === true,
      ...(reflect ? { reflect_target: reflect } : {}),
    };
    out.push(proposal);
    if (out.length >= 8) break;
  }
  return out;
}

function stepIndex(s: ImprovementStep): number {
  const i = IMPROVEMENT_STEP_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

function parsePhase(v: unknown, fallback: ImprovementStep): ImprovementStep {
  return typeof v === "string" && (IMPROVEMENT_STEP_ORDER as string[]).includes(v)
    ? (v as ImprovementStep)
    : fallback;
}

/**
 * フェーズの飛び越しと、中身のない完了を防ぐ。
 * 現状整理でクロス分析が飛ばされた事故と同種の抜けを構造的に塞ぐ。
 */
function guardPhase(
  requested: ImprovementStep,
  current: ImprovementStep,
  proposals: ImprovementProposal[],
): ImprovementStep {
  const nextIdx = Math.min(stepIndex(current) + 1, IMPROVEMENT_STEP_ORDER.length - 1);
  let phase =
    stepIndex(requested) > stepIndex(current) + 1
      ? (IMPROVEMENT_STEP_ORDER[nextIdx] ?? requested)
      : requested;

  // 改善案が無ければ assign 以降へ進めない
  if (stepIndex(phase) >= stepIndex("assign") && proposals.length === 0) {
    phase = "design";
  }
  // 担当が1件も入っていなければ完了させない
  if (phase === "done" && !proposals.some((p) => p.owner_department || p.due_hint)) {
    phase = "assign";
  }
  return phase;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
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

  const row = await queryOne<DialogueRow>(
    `SELECT id, program_evaluation_id, status, current_step, messages, proposals
     FROM improvement_dialogues
     WHERE id = $1 AND project_id = $2`,
    [params.dialogueId, params.id],
  );
  if (!row) {
    return NextResponse.json({ data: null, error: "改善提案が見つかりません" }, { status: 404 });
  }

  // 初回ブートストラップ
  const trimmed = parsed.data.message?.trim() ?? "";
  if (trimmed === "") {
    const last = [...row.messages].reverse().find((m) => m.role === "assistant");
    return NextResponse.json({
      data: {
        reply: last?.content ?? "",
        current_step: row.current_step,
        status: row.status,
        proposals: row.proposals,
        messages: row.messages,
      },
      error: null,
    });
  }

  const munId = session!.user?.municipalityId;
  if (munId) {
    const limit = await checkLimit(munId, "ai_calls");
    if (!limit.allowed) {
      return NextResponse.json(
        { data: null, error: "AI生成回数の上限に達しました", upgrade_url: "/pricing" },
        { status: 403 },
      );
    }
    await incrementAiUsage(munId);
  }

  const userMessage: ImprovementMessage = {
    role: "user",
    content: trimmed,
    step: row.current_step,
  };
  const history = [...row.messages, userMessage];
  const aiMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let knowledgeContext = "";
  try {
    knowledgeContext = await getKnowledgeContext(params.id);
  } catch {
    knowledgeContext = "";
  }

  const proposalsSummary =
    row.proposals.length === 0
      ? "（まだなし）"
      : row.proposals
          .map(
            (p) =>
              `${p.id} ${p.title}${p.owner_department ? ` / ${p.owner_department}` : ""}${p.due_hint ? ` / ${p.due_hint}` : ""}`,
          )
          .join("\n");

  const ctx = await buildImprovementContext({
    projectId: params.id,
    programEvaluationId: row.program_evaluation_id,
    currentStep: row.current_step,
    proposalsSummary,
    knowledgeContext,
  });

  const systemText = buildImprovementSystemPrompt(ctx);
  const aiCtx = { taskType: "dialogue.improvement", projectId: params.id } as const;

  let toolUse: Anthropic.ToolUseBlock | null;
  try {
    toolUse = await callDialogueTool(aiCtx, systemText, aiMessages, {
      tool: RECORD_IMPROVEMENT_TURN_TOOL,
      allowWebSearch: true,
    });
  } catch {
    return NextResponse.json({ data: null, error: "AIとの通信に失敗しました" }, { status: 502 });
  }
  if (!toolUse) {
    return NextResponse.json({ data: null, error: "AI応答の解析に失敗しました" }, { status: 500 });
  }

  const input = toolUse.input as Record<string, unknown>;
  const reply = str(input.reply, 4000) || "（応答を取得できませんでした）";

  // proposals は id 単位で上書きマージ
  const incoming = sanitizeProposals(input.proposals);
  const map = new Map(row.proposals.map((p) => [p.id, p]));
  for (const p of incoming) map.set(p.id, p);
  const proposals = Array.from(map.values());

  const phase = guardPhase(parsePhase(input.phase, row.current_step), row.current_step, proposals);
  const suggestions = sanitizeStringArray(input.suggestions, { maxItems: 4, maxLength: 200 });
  const completed = phase === "done";

  const assistantMessage: ImprovementMessage = {
    role: "assistant",
    content: reply,
    step: phase,
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
  const messages = [...history, assistantMessage];
  const nextStatus: "in_progress" | "completed" = completed ? "completed" : "in_progress";

  await queryOne(
    `UPDATE improvement_dialogues
     SET messages = $1::jsonb, proposals = $2::jsonb, current_step = $3, status = $4
     WHERE id = $5 AND project_id = $6
     RETURNING id`,
    [
      JSON.stringify(messages),
      JSON.stringify(proposals),
      phase,
      nextStatus,
      params.dialogueId,
      params.id,
    ],
  );

  return NextResponse.json({
    data: { reply, current_step: phase, status: nextStatus, proposals, messages },
    error: null,
  });
}
