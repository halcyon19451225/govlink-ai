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
import {
  buildAsisContextText,
  buildIssueSystemPrompt,
  RECORD_ISSUE_TURN_TOOL,
  type IssueKpiContext,
} from "@/lib/issue/prompt";
import {
  ISSUE_STEP_ORDER,
  calcIssueScore,
  isFactorKey,
  isProblemOrigin,
  type FishboneBone,
  type HypothesisItem,
  type IssueDialogueData,
  type IssueMessage,
  type IssueStep,
  type ProblemItem,
  type RootCauseItem,
  type SelectionItem,
  type WhyStep,
} from "@/lib/issue/types";
import type { CrossAnalysis, SwotData } from "@/lib/asis/types";

type Params = { params: { id: string; dialogueId: string } };

const bodySchema = z.object({
  message: z.string().trim().max(4000).nullish(),
  /** "retry": 失敗したターンを（発言を追加せず）やり直す */
  action: z.enum(["retry"]).nullish(),
});

const TURN_TABLE = "issue_dialogues" as const;

interface DialogueRow {
  id: string;
  turn_status: "idle" | "processing" | "error";
  turn_error: string | null;
  kpi_id: string | null;
  gap_analysis_id: string | null;
  asis_analysis_id: string | null;
  status: "in_progress" | "completed";
  current_step: IssueStep;
  messages: IssueMessage[];
  problems: ProblemItem[];
  selection: SelectionItem[];
  root_causes: RootCauseItem[];
  hypotheses: HypothesisItem[];
  project_title: string;
  kpi_label: string | null;
  kpi_unit: string | null;
  kpi_target: number | null;
  kpi_deadline: string | null;
  gap_current_value: number | null;
  gap_value: number | null;
  gap_trend: string | null;
  asis_swot: SwotData | null;
  asis_cross: CrossAnalysis | null;
}

// ─── ツール出力の安全な取り込み ─────────────────────
function str(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function sanitizeProblems(arr: unknown, startIndex: number): ProblemItem[] {
  if (!Array.isArray(arr)) return [];
  const out: ProblemItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const text = str(o.text, 300);
    if (!text) continue;
    const item: ProblemItem = {
      id: `p${startIndex + out.length + 1}`,
      text,
      origin: isProblemOrigin(o.origin) ? o.origin : "dialogue",
    };
    const sourceText = str(o.source_text, 300);
    if (sourceText) item.source_text = sourceText;
    if (isFactorKey(o.factor)) item.factor = o.factor;
    out.push(item);
    if (out.length >= 12) break;
  }
  return out;
}

function num1to5(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function sanitizeSelection(arr: unknown, validIds: Set<string>): SelectionItem[] {
  if (!Array.isArray(arr)) return [];
  const out: SelectionItem[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const pid = str(o.problem_id, 40);
    if (!pid || !validIds.has(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const impact = num1to5(o.impact);
    const controllability = num1to5(o.controllability);
    const urgency = num1to5(o.urgency);
    out.push({
      problem_id: pid,
      impact,
      controllability,
      urgency,
      score: calcIssueScore(impact, controllability, urgency),
      selected: o.selected === true,
      reason: str(o.reason, 300),
    });
  }
  return out;
}

function sanitizeBones(arr: unknown): FishboneBone[] {
  if (!Array.isArray(arr)) return [];
  const out: FishboneBone[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (!isFactorKey(o.factor)) continue;
    const causes = sanitizeStringArray(o.causes, { maxItems: 6, maxLength: 200 });
    if (causes.length === 0) continue;
    out.push({ factor: o.factor, causes });
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeWhys(arr: unknown): WhyStep[] {
  if (!Array.isArray(arr)) return [];
  const out: WhyStep[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const answer = str(o.answer, 400);
    if (!answer) continue;
    const rawLevel = typeof o.level === "number" ? o.level : Number(o.level);
    const level = Number.isFinite(rawLevel)
      ? Math.min(5, Math.max(1, Math.round(rawLevel)))
      : out.length + 1;
    out.push({ level, question: str(o.question, 300), answer });
    if (out.length >= 5) break;
  }
  return out.sort((a, b) => a.level - b.level);
}

function sanitizeRootCauses(arr: unknown, validIds: Set<string>): RootCauseItem[] {
  if (!Array.isArray(arr)) return [];
  const out: RootCauseItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const pid = str(o.problem_id, 40);
    if (!pid || !validIds.has(pid)) continue;
    out.push({
      problem_id: pid,
      bones: sanitizeBones(o.bones),
      whys: sanitizeWhys(o.whys),
      root_cause: str(o.root_cause, 600),
    });
  }
  return out;
}

function sanitizeHypotheses(arr: unknown, validIds: Set<string>): HypothesisItem[] {
  if (!Array.isArray(arr)) return [];
  const out: HypothesisItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const pid = str(o.problem_id, 40);
    const title = str(o.title, 120);
    const statement = str(o.statement, 800);
    if (!pid || !validIds.has(pid) || !title || !statement) continue;
    out.push({
      problem_id: pid,
      title,
      statement,
      root_cause: str(o.root_cause, 600),
      evidence: sanitizeStringArray(o.evidence, { maxItems: 8, maxLength: 400 }),
      measures: sanitizeStringArray(o.measures, { maxItems: 8, maxLength: 300 }),
      verification: str(o.verification, 500),
    });
  }
  return out;
}

/** problem_id をキーに上書きマージする */
function upsertById<T extends { problem_id: string }>(base: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return base;
  const map = new Map(base.map((b) => [b.problem_id, b]));
  for (const item of incoming) map.set(item.problem_id, item);
  return Array.from(map.values());
}

// ─── フェーズ判定 ────────────────────────────────
function stepIndex(s: IssueStep): number {
  const i = ISSUE_STEP_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

function parsePhase(v: unknown, fallback: IssueStep): IssueStep {
  return typeof v === "string" && (ISSUE_STEP_ORDER as string[]).includes(v)
    ? (v as IssueStep)
    : fallback;
}

function hasResolvedRootCause(data: IssueDialogueData): boolean {
  return data.root_causes.some((r) => r.root_cause.trim().length > 0);
}

function hasSelectedIssue(data: IssueDialogueData): boolean {
  return data.selection.some((s) => s.selected);
}

function hasUsableHypothesis(data: IssueDialogueData): boolean {
  return data.hypotheses.some(
    (h) => h.statement.trim().length > 0 && h.root_cause.trim().length > 0,
  );
}

/**
 * フェーズの逆行・飛び越しを防ぐガード。
 * 現状整理でクロス分析が飛ばされた事故と同種の抜けを構造的に塞ぐ。
 */
function guardPhase(requested: IssueStep, current: IssueStep, data: IssueDialogueData): IssueStep {
  // 2段以上の飛び越しを禁止（problems → rootcause など）
  const nextIdx = Math.min(stepIndex(current) + 1, ISSUE_STEP_ORDER.length - 1);
  let phase =
    stepIndex(requested) > stepIndex(current) + 1
      ? (ISSUE_STEP_ORDER[nextIdx] ?? requested)
      : requested;

  // 前提条件を満たさないフェーズには進ませない
  if (stepIndex(phase) >= stepIndex("rootcause") && !hasSelectedIssue(data)) {
    phase = "selection";
  }
  if (stepIndex(phase) >= stepIndex("hypothesis") && !hasResolvedRootCause(data)) {
    phase = "rootcause";
  }
  if (phase === "done" && !hasUsableHypothesis(data)) {
    phase = "hypothesis";
  }
  return phase;
}

const ROW_SQL = `SELECT d.id, d.kpi_id, d.gap_analysis_id, d.asis_analysis_id,
            d.status, d.current_step, d.messages,
            d.problems, d.selection, d.root_causes, d.hypotheses,
            d.turn_status, d.turn_error,
            p.title AS project_title,
            k.label AS kpi_label,
            k.unit  AS kpi_unit,
            k.target::float AS kpi_target,
            to_char(k.target_deadline, 'YYYY年FMMM月') AS kpi_deadline,
            g.current_value::float AS gap_current_value,
            g.gap_value::float     AS gap_value,
            g.trend                AS gap_trend,
            a.swot                 AS asis_swot,
            a.cross_analysis       AS asis_cross
     FROM issue_dialogues d
     JOIN projects p ON p.id = d.project_id
     LEFT JOIN kpis k          ON k.id = d.kpi_id
     LEFT JOIN gap_analyses g  ON g.id = d.gap_analysis_id
     LEFT JOIN asis_analyses a ON a.id = d.asis_analysis_id
     WHERE d.id = $1 AND d.project_id = $2`;

/**
 * POST /chat
 *
 * 2つの入口を持つ（lib/ai/asyncTurn.ts の方式）:
 *  A. 利用者からの発言（セッション認証）: 発言を保存して processing にし、
 *     自分自身を step_token 付きで呼び出して 202 で即応答する
 *  B. step_token 付きの自己呼び出し（トークン認証・セッション不要）: AI処理を行い保存する
 * Amplify の 30 秒応答上限を利用者の待ち時間から切り離すための構造。
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
      console.error("[issue-dialogue/chat step]", msg);
      await failTurn(TURN_TABLE, params.dialogueId, raw.step_token, msg);
      return NextResponse.json({ data: null, error: msg }, { status: 500 });
    }
  }

  // ── A. 利用者からの発言 ─────────────────────────
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "issue_hypothesis", "edit");
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
    return NextResponse.json(
      { data: null, error: "課題仮説設定が見つかりません" },
      { status: 404 },
    );
  }

  const isRetry = parsed.data.action === "retry";
  const trimmedMessage = parsed.data.message?.trim() ?? "";

  // 初回ブートストラップ: message 未指定ならシード済みの最初の質問を返す
  if (trimmedMessage === "" && !isRetry) {
    const lastAssistant = [...row.messages].reverse().find((m) => m.role === "assistant");
    return NextResponse.json({
      data: {
        reply: lastAssistant?.content ?? "",
        current_step: row.current_step,
        status: row.status,
        problems: row.problems,
        selection: row.selection,
        root_causes: row.root_causes,
        hypotheses: row.hypotheses,
        messages: row.messages,
        turn_status: row.turn_status,
        turn_error: row.turn_error,
      },
      error: null,
    });
  }

  // プラン上限チェック（再試行は消費しない）
  const munIdForLimit = session!.user?.municipalityId;
  if (munIdForLimit && !isRetry) {
    const limitCheck = await checkLimit(munIdForLimit, "ai_calls");
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { data: null, error: "AI生成回数の上限に達しました", upgrade_url: "/pricing" },
        { status: 403 },
      );
    }
    await incrementAiUsage(munIdForLimit);
  }

  const userMessage: IssueMessage | null = isRetry
    ? null
    : { role: "user", content: trimmedMessage, step: row.current_step };

  const begun = await beginTurn<IssueMessage>(TURN_TABLE, params.dialogueId, params.id, userMessage);
  if (!begun.ok) {
    const error =
      begun.reason === "busy"
        ? BUSY_ERROR
        : begun.reason === "nothing_to_retry"
          ? NOTHING_TO_RETRY_ERROR
          : "課題仮説設定が見つかりません";
    return NextResponse.json(
      { data: null, error },
      { status: begun.reason === "not_found" ? 404 : 409 },
    );
  }

  triggerTurnStep(
    `/api/admin/projects/${params.id}/issue-dialogue/${params.dialogueId}/chat`,
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
  if (!row) throw new Error("課題仮説設定が見つかりません");

  // beginTurn で利用者の発言は保存済み
  const history = row.messages;
  const aiMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ナレッジ（管理画面で作成した辞書）を回答ヒントの一次情報源として注入
  let knowledgeContext = "";
  try {
    knowledgeContext = await getKnowledgeContext(params.id);
  } catch {
    knowledgeContext = "";
  }

  const kpiContext: IssueKpiContext | null = row.kpi_label
    ? {
        indicatorName: row.kpi_label,
        unit: row.kpi_unit ?? "",
        targetValue: row.kpi_target,
        currentValue: row.gap_current_value,
        gapValue: row.gap_value,
        deadline: row.kpi_deadline,
        trend: row.gap_trend,
      }
    : null;

  const asisContext = buildAsisContextText(row.asis_swot, row.asis_cross);

  const data: IssueDialogueData = {
    problems: row.problems,
    selection: row.selection,
    root_causes: row.root_causes,
    hypotheses: row.hypotheses,
  };

  const systemText = buildIssueSystemPrompt({
    projectTitle: row.project_title,
    kpiContext,
    asisContext,
    currentStep: row.current_step,
    data,
    knowledgeContext,
  });

  const aiCtx = { taskType: "dialogue.issue", projectId: params.id } as const;

  let toolUse: Anthropic.ToolUseBlock | null;
  try {
    toolUse = await callDialogueTool(aiCtx, systemText, aiMessages, {
      tool: RECORD_ISSUE_TURN_TOOL,
      allowWebSearch: true,
    });
  } catch {
    throw new Error("AIとの通信に失敗しました");
  }
  if (!toolUse) {
    throw new Error("AI応答の解析に失敗しました");
  }

  // ── ツール出力を取り込む ────────────────────────
  const applyTurn = (input: Record<string, unknown>, current: IssueDialogueData) => {
    const problems = [
      ...current.problems,
      ...sanitizeProblems(input.new_problems, current.problems.length),
    ];
    const validIds = new Set(problems.map((p) => p.id));
    const incomingSelection = sanitizeSelection(input.selection, validIds);
    const next: IssueDialogueData = {
      problems,
      selection: incomingSelection.length > 0 ? incomingSelection : current.selection,
      root_causes: upsertById(
        current.root_causes,
        sanitizeRootCauses(input.root_causes, validIds),
      ),
      hypotheses: upsertById(
        current.hypotheses,
        sanitizeHypotheses(input.hypotheses, validIds),
      ),
    };
    return next;
  };

  const input = toolUse.input as Record<string, unknown>;
  let reply = str(input.reply, 4000) || "（応答を取得できませんでした）";
  let nextData = applyTurn(input, data);
  let phase = guardPhase(parsePhase(input.phase, row.current_step), row.current_step, nextData);
  let suggestions = sanitizeStringArray(input.suggestions, { maxItems: 4, maxLength: 200 });
  let completed = (input.completed === true || phase === "done") && phase === "done";

  // ── 完了ガード ────────────────────────────────
  // 仮説が無い/真因が無いまま完了しようとした場合は、不足分の作成を促す
  // 追いターンを1回だけ自動実行する（現状整理のクロス分析ガードと同じ方式）。
  const wantsFinish = input.completed === true || parsePhase(input.phase, row.current_step) === "done";
  if (wantsFinish && !completed) {
    const missing = !hasResolvedRootCause(nextData)
      ? "真因（root_causes）がまだ確定していません。selected=true の課題について、特性要因図（bones）となぜなぜ分析（whys）を行い root_cause を確定してください。phase は rootcause のままにしてください。"
      : "課題仮説（hypotheses）がまだ作成されていません。確定した真因ごとに title / statement / root_cause / evidence / measures / verification を作成してください。";
    try {
      const retryUse = await callDialogueTool(
        aiCtx,
        systemText,
        [
          ...aiMessages,
          { role: "assistant", content: reply },
          {
            role: "user",
            content: `（システムからの自動指示）この工程はまだ完了できません。${missing}`,
          },
        ],
        { tool: RECORD_ISSUE_TURN_TOOL, allowWebSearch: false },
      );
      if (retryUse) {
        const rInput = retryUse.input as Record<string, unknown>;
        const retried = applyTurn(rInput, nextData);
        const retriedPhase = guardPhase(
          parsePhase(rInput.phase, row.current_step),
          row.current_step,
          retried,
        );
        nextData = retried;
        reply = str(rInput.reply, 4000) || reply;
        suggestions = sanitizeStringArray(rInput.suggestions, { maxItems: 4, maxLength: 200 });
        phase = retriedPhase;
        completed = retriedPhase === "done";
      }
    } catch {
      // 回復に失敗しても、ガード済みの phase のまま対話を継続する
    }
  }

  const assistantMessage: IssueMessage = {
    role: "assistant",
    content: reply,
    step: phase,
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
  const messages = [...history, assistantMessage];
  const nextStatus: "in_progress" | "completed" = completed ? "completed" : "in_progress";

  // turn_token が一致する行だけ更新する（再試行で別トークンに置き換わった古い処理は捨てる）
  const saved = await queryOne<{ id: string }>(
    `UPDATE issue_dialogues
     SET messages = $1::jsonb, problems = $2::jsonb, selection = $3::jsonb,
         root_causes = $4::jsonb, hypotheses = $5::jsonb,
         current_step = $6, status = $7, ${turnDoneSql()}
     WHERE id = $8 AND project_id = $9 AND turn_token = $10
     RETURNING id`,
    [
      JSON.stringify(messages),
      JSON.stringify(nextData.problems),
      JSON.stringify(nextData.selection),
      JSON.stringify(nextData.root_causes),
      JSON.stringify(nextData.hypotheses),
      phase,
      nextStatus,
      params.dialogueId,
      params.id,
      token,
    ],
  );
  if (!saved) {
    console.warn("[issue-dialogue/chat] 古いステップの結果を破棄しました", params.dialogueId);
  }
}
