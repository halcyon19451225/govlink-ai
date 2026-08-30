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
import {
  callDialogueTool,
  sanitizeStringArray,
  stripCitationMarkup,
} from "@/lib/ai/dialogueTurn";
import {
  BUSY_ERROR,
  NOTHING_TO_RETRY_ERROR,
  acceptedPayload,
  beginTurn,
  claimStep,
  failTurn,
  isStepRequest,
  triggerTurnStep,
  turnDoneSql,
} from "@/lib/ai/asyncTurn";
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
  /** "retry": 失敗したターンを（発言を追加せず）やり直す */
  action: z.enum(["retry"]).nullish(),
});

const TURN_TABLE = "improvement_dialogues" as const;

const ROW_SQL = `SELECT id, program_evaluation_id, status, current_step, messages, proposals,
            turn_status, turn_error
     FROM improvement_dialogues
     WHERE id = $1 AND project_id = $2`;

interface DialogueRow {
  id: string;
  turn_status: "idle" | "processing" | "error";
  turn_error: string | null;
  program_evaluation_id: string | null;
  status: "in_progress" | "completed";
  current_step: ImprovementStep;
  messages: ImprovementMessage[];
  proposals: ImprovementProposal[];
}

function str(v: unknown, max = 600): string {
  // 引用マークアップ（<cite …>）はここで落とす。本文・仮説・出典すべてこの関数を通る
  return typeof v === "string" ? stripCitationMarkup(v).trim().slice(0, max) : "";
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

/**
 * POST /chat — 2つの入口（lib/ai/asyncTurn.ts の方式・Amplify の30秒応答上限対策）:
 *  A. 利用者からの発言（セッション認証）: 発言を保存して processing にし、
 *     自分自身を step_token 付きで呼び出して 202 で即応答する
 *  B. step_token 付きの自己呼び出し（トークン認証・セッション不要）: AI処理を行い保存する
 */
export async function POST(req: NextRequest, { params }: Params) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  // ── B. 自己呼び出し（AI処理の実体） ────────────────
  if (isStepRequest(raw)) {
    const ok = await claimStep(TURN_TABLE, params.dialogueId, params.id, raw.step_token);
    if (!ok) {
      return NextResponse.json({ data: null, error: "無効なステップ要求です" }, { status: 404 });
    }
    try {
      await runTurn(params, raw.step_token);
      return NextResponse.json({ data: { ok: true }, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI処理に失敗しました";
      console.error("[improvement-dialogue/chat step]", msg);
      await failTurn(TURN_TABLE, params.dialogueId, raw.step_token, msg);
      return NextResponse.json({ data: null, error: msg }, { status: 500 });
    }
  }

  // ── A. 利用者からの発言 ─────────────────────────
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { data: null, error: "ANTHROPIC_API_KEY が設定されていません" },
      { status: 500 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const row = await queryOne<DialogueRow>(ROW_SQL, [params.dialogueId, params.id]);
  if (!row) {
    return NextResponse.json({ data: null, error: "改善提案が見つかりません" }, { status: 404 });
  }

  const isRetry = parsed.data.action === "retry";
  const trimmed = parsed.data.message?.trim() ?? "";

  // 初回ブートストラップ
  if (trimmed === "" && !isRetry) {
    const last = [...row.messages].reverse().find((m) => m.role === "assistant");
    return NextResponse.json({
      data: {
        reply: last?.content ?? "",
        current_step: row.current_step,
        status: row.status,
        proposals: row.proposals,
        messages: row.messages,
        turn_status: row.turn_status,
        turn_error: row.turn_error,
      },
      error: null,
    });
  }

  // プラン上限チェック（再試行は消費しない）
  const munId = session!.user?.municipalityId;
  if (munId && !isRetry) {
    const limit = await checkLimit(munId, "ai_calls");
    if (!limit.allowed) {
      return NextResponse.json(
        { data: null, error: "AI生成回数の上限に達しました", upgrade_url: "/pricing" },
        { status: 403 },
      );
    }
    await incrementAiUsage(munId);
  }

  const userMessage: ImprovementMessage | null = isRetry
    ? null
    : { role: "user", content: trimmed, step: row.current_step };

  const begun = await beginTurn<ImprovementMessage>(
    TURN_TABLE,
    params.dialogueId,
    params.id,
    userMessage,
  );
  if (!begun.ok) {
    const error =
      begun.reason === "busy"
        ? BUSY_ERROR
        : begun.reason === "nothing_to_retry"
          ? NOTHING_TO_RETRY_ERROR
          : "改善提案が見つかりません";
    return NextResponse.json(
      { data: null, error },
      { status: begun.reason === "not_found" ? 404 : 409 },
    );
  }

  triggerTurnStep(
    `/api/admin/projects/${params.id}/improvement-dialogue/${params.dialogueId}/chat`,
    begun.token,
  );
  return NextResponse.json(acceptedPayload(begun.messages), { status: 202 });
}

/**
 * AIターンの実体。messages の末尾（利用者の発言）に対する応答を生成して保存する。
 * 例外は呼び出し側で failTurn に変換される。
 */
async function runTurn(params: Params["params"], token: string): Promise<void> {
  const row = await queryOne<DialogueRow>(ROW_SQL, [params.dialogueId, params.id]);
  if (!row) throw new Error("改善提案が見つかりません");

  // beginTurn で利用者の発言は保存済み
  const history = row.messages;
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
  } catch (e) {
    // 原因（レート制限・過負荷・タイムアウト等）を turn_error に残す。
    // 「通信に失敗しました」だけでは担当者も開発側も切り分けられないため。
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[dialogue/chat] AI呼び出しに失敗", detail);
    throw new Error(`AIとの通信に失敗しました（${detail.slice(0, 300)}）`);
  }
  if (!toolUse) {
    throw new Error("AI応答の解析に失敗しました");
  }

  const input = toolUse.input as Record<string, unknown>;
  // 返答が空のまま保存すると、対話に空のターンが残り担当者は再試行もできない。
  // 失敗として扱い、発言を残したまま「再試行」できる状態にする。
  const replyText = str(input.reply, 4000);
  if (!replyText) {
    throw new Error("AIの返答が空でした。再試行してください");
  }
  const reply = replyText;

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

  // turn_token が一致する行だけ更新する（再試行で別トークンに置き換わった古い処理は捨てる）
  const saved = await queryOne<{ id: string }>(
    `UPDATE improvement_dialogues
     SET messages = $1::jsonb, proposals = $2::jsonb, current_step = $3, status = $4,
         ${turnDoneSql()}
     WHERE id = $5 AND project_id = $6 AND turn_token = $7
     RETURNING id`,
    [
      JSON.stringify(messages),
      JSON.stringify(proposals),
      phase,
      nextStatus,
      params.dialogueId,
      params.id,
      token,
    ],
  );
  if (!saved) {
    console.warn("[improvement-dialogue/chat] 古いステップの結果を破棄しました", params.dialogueId);
  }
}
