export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type Anthropic from "@anthropic-ai/sdk";
import { type AiCallContext } from "@/lib/ai/gateway";
import { callDialogueTool, type DialogueSystem } from "@/lib/ai/dialogueTurn";
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
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { checkLimit, incrementAiUsage } from "@/lib/plan-limits";
import { queryOne } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { requireModulePermission } from "@/lib/permissions";
import { buildSystemPrompt, RECORD_TURN_TOOL, type KpiContext } from "@/lib/asis/prompt";
import { retrieveGrounding, retrieveContextGrounding } from "@/lib/corpus/retrieval";
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
  /** "retry": 失敗したターンを（発言を追加せず）やり直す */
  action: z.enum(["retry"]).nullish(),
});

const TURN_TABLE = "asis_analyses" as const;

const ROW_SQL = `SELECT a.id, a.kpi_id, a.title, a.status, a.current_step,
            a.messages, a.swot, a.cross_analysis,
            a.turn_status, a.turn_error,
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
     WHERE a.id = $1 AND a.project_id = $2`;

interface AsisRow {
  id: string;
  turn_status: "idle" | "processing" | "error";
  turn_error: string | null;
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

/**
 * 対話ターンの呼び出しは共通ヘルパー（lib/ai/dialogueTurn.ts）に寄せる。
 * ここに同じ処理の写しを置いていたため、出力上限の扱いやプロンプトキャッシュの
 * 改善が現状整理だけ取り残されていた（2026-08-30 に統合）。
 */
async function callRecordTurn(
  ctx: AiCallContext,
  system: DialogueSystem,
  aiMessages: Anthropic.MessageParam[],
  opts: { allowWebSearch: boolean },
): Promise<Anthropic.ToolUseBlock | null> {
  return callDialogueTool(ctx, system, aiMessages, {
    tool: RECORD_TURN_TOOL,
    allowWebSearch: opts.allowWebSearch,
    maxTokens: 5000,
  });
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
    const ok = await claimStep(TURN_TABLE, params.asisId, params.id, raw.step_token);
    if (!ok) {
      return NextResponse.json({ data: null, error: "無効なステップ要求です" }, { status: 404 });
    }
    try {
      await runTurn(params, raw.step_token);
      return NextResponse.json({ data: { ok: true }, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI処理に失敗しました";
      console.error("[asis-analysis/chat step]", msg);
      await failTurn(TURN_TABLE, params.asisId, raw.step_token, msg);
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

  const asis = await queryOne<AsisRow>(ROW_SQL, [params.asisId, params.id]);
  if (!asis) {
    return NextResponse.json({ data: null, error: "現状整理が見つかりません" }, { status: 404 });
  }

  const isRetry = parsed.data.action === "retry";
  const trimmedMessage = parsed.data.message?.trim() ?? "";

  // 初回ブートストラップ: message 未指定の場合はシード済みの最初のAI質問を返す
  if (trimmedMessage === "" && !isRetry) {
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
        turn_status: asis.turn_status,
        turn_error: asis.turn_error,
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

  const userMessage: AsisMessage | null = isRetry
    ? null
    : { role: "user", content: trimmedMessage, step: asis.current_step };

  const begun = await beginTurn<AsisMessage>(TURN_TABLE, params.asisId, params.id, userMessage);
  if (!begun.ok) {
    const error =
      begun.reason === "busy"
        ? BUSY_ERROR
        : begun.reason === "nothing_to_retry"
          ? NOTHING_TO_RETRY_ERROR
          : "現状整理が見つかりません";
    return NextResponse.json(
      { data: null, error },
      { status: begun.reason === "not_found" ? 404 : 409 },
    );
  }

  triggerTurnStep(
    `/api/admin/projects/${params.id}/asis-analysis/${params.asisId}/chat`,
    begun.token,
  );
  return NextResponse.json(acceptedPayload(begun.messages), { status: 202 });
}

/**
 * AIターンの実体。messages の末尾（利用者の発言）に対する応答を生成して保存する。
 * 例外は呼び出し側で failTurn に変換される。
 */
async function runTurn(params: Params["params"], token: string): Promise<void> {
  const asis = await queryOne<AsisRow>(ROW_SQL, [params.asisId, params.id]);
  if (!asis) throw new Error("現状整理が見つかりません");

  // beginTurn で利用者の発言は保存済み
  const history = asis.messages;

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

  // 環境情報（corpus_context）の接地（X7e）。
  // 探索順序は ①ナレッジ → ①' corpus_context → ②web_search（設計 §1-3）。
  // external(O/T)=政策・制度・公募・トレンド / internal(S/W)=地域統計（自地域 vs 全国）
  try {
    const muni = await queryOne<{ name: string; prefecture: string }>(
      `SELECT m.name, m.prefecture
       FROM projects p JOIN municipalities m ON m.id = p.municipality_id
       WHERE p.id = $1`,
      [params.id],
    );
    const phase =
      asis.current_step === "external"
        ? ("external" as const)
        : asis.current_step === "internal"
          ? ("internal" as const)
          : null;
    const ctx = await retrieveContextGrounding({
      taskType: "dialogue.asis",
      projectId: params.id,
      contextId: params.asisId,
      queryText: `${asis.project_title} ${asis.kpi_label ?? ""}`.slice(0, 600),
      phase,
      region: {
        municipalityName: muni?.name ?? null,
        prefecture: muni?.prefecture ?? null,
      },
    });
    if ((ctx.mode === "assist" || ctx.mode === "primary") && ctx.contextBlock) {
      corpusBlock = [corpusBlock, ctx.contextBlock].filter(Boolean).join("\n\n") || null;
    }
  } catch {
    // 環境情報の接地失敗は対話を壊さない
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
  const replyText = typeof input.reply === "string" ? input.reply.trim() : "";
  if (!replyText) {
    throw new Error("AIの返答が空でした。再試行してください");
  }
  let reply = replyText;
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

  // turn_token が一致する行だけ更新する（再試行で別トークンに置き換わった古い処理は捨てる）
  const saved = await queryOne<{ id: string }>(
    `UPDATE asis_analyses
     SET messages = $1::jsonb, swot = $2::jsonb, cross_analysis = $3::jsonb,
         current_step = $4, status = $5, ${turnDoneSql()}
     WHERE id = $6 AND project_id = $7 AND turn_token = $8
     RETURNING id`,
    [
      JSON.stringify(messages),
      JSON.stringify(swot),
      JSON.stringify(cross),
      phase,
      nextStatus,
      params.asisId,
      params.id,
      token,
    ],
  );
  if (!saved) {
    console.warn("[asis-analysis/chat] 古いステップの結果を破棄しました", params.asisId);
  }
}
