import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { aiCreateMessage, type AiCallContext } from "@/lib/ai/gateway";

/**
 * 対話型モジュール（現状整理・課題仮説設定・施策構築・A改善）共通の
 * AI呼び出しヘルパー。X1でAIゲートウェイ経由に変更（呼び出し側は
 * Anthropic クライアントではなく AiCallContext を渡す）。
 *
 * - web_search（Anthropic のサーバーツール）を併用する場合、tool_choice を
 *   固定できないため「最後は必ず記録ツールで締める」ようプロンプト側で指示し、
 *   ここでは締めなかった場合の強制リトライを受け持つ。
 * - 出力が max_tokens で切られるとツール入力のJSONが途中で切れ、reply が欠けたまま
 *   返ることがある（仮説フェーズは evidence/measures/verification を伴い長く、実際に発生した）。
 *   その場合は予算を広げて1回だけ引き直す。
 * - サーバーツールの実行が長引くと stop_reason="pause_turn" で返るため、
 *   assistant の内容を積んで続きを要求する。
 */
export const DIALOGUE_MODEL = "claude-sonnet-4-6";

export interface CallDialogueToolOptions {
  /** 記録用ツール（record_turn / record_issue_turn） */
  tool: Anthropic.Tool;
  /** web_search を許可するか（false で記録ツールに tool_choice を固定） */
  allowWebSearch: boolean;
  maxTokens?: number;
  /** 内部用: max_tokens で切られて引き直した後かどうか（無限ループ防止） */
  retriedForLength?: boolean;
  /** web_search の1ターンあたり最大回数 */
  maxSearchUses?: number;
}

export async function callDialogueTool(
  ctx: AiCallContext,
  systemText: string,
  inputMessages: Anthropic.MessageParam[],
  opts: CallDialogueToolOptions,
): Promise<Anthropic.ToolUseBlock | null> {
  // 既定を 2500 → 4000。2500 は真因分析・仮説フェーズの構造化出力には足りず、
  // ツール入力が途中で切れて空の返答が保存される事故が起きた（2026-08-30）
  const maxTokens = opts.maxTokens ?? 4000;

  const tools: NonNullable<Anthropic.MessageCreateParams["tools"]> = opts.allowWebSearch
    ? [
        opts.tool,
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: opts.maxSearchUses ?? 2,
        },
      ]
    : [opts.tool];

  const system = [
    { type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } },
  ];

  let messages: Anthropic.MessageParam[] = inputMessages;
  let response = await aiCreateMessage(ctx, {
    model: DIALOGUE_MODEL,
    max_tokens: maxTokens,
    system,
    tools,
    tool_choice: opts.allowWebSearch
      ? { type: "auto" }
      : { type: "tool", name: opts.tool.name },
    messages,
  });

  // サーバーツールの実行待ちで中断された場合は続きを要求する（最大3回）
  for (let i = 0; i < 3 && response.stop_reason === "pause_turn"; i++) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await aiCreateMessage(ctx, {
      model: DIALOGUE_MODEL,
      max_tokens: maxTokens,
      system,
      tools,
      tool_choice: { type: "auto" },
      messages,
    });
  }

  // 出力上限で切られた場合、ツール入力のJSONが不完全なまま返る。
  // 中身を信用せず、予算を倍にして引き直す（1回だけ）。
  if (response.stop_reason === "max_tokens" && !opts.retriedForLength) {
    console.warn(
      `[callDialogueTool] max_tokens(${maxTokens}) で打ち切られたため引き直します`,
      ctx.taskType,
    );
    return callDialogueTool(ctx, systemText, inputMessages, {
      ...opts,
      maxTokens: Math.min(maxTokens * 2, 16000),
      retriedForLength: true,
    });
  }

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === opts.tool.name,
  );
  // 引き直しても上限で切れたなら、壊れた出力を返さず null にする
  // （呼び出し側が失敗として扱い、担当者は「再試行」で引き直せる）
  if (toolUse && response.stop_reason === "max_tokens") return null;
  if (toolUse) return toolUse;

  // 記録ツールで締めなかった場合は web_search 抜きで強制リトライ
  if (opts.allowWebSearch) {
    return callDialogueTool(ctx, systemText, inputMessages, {
      ...opts,
      allowWebSearch: false,
    });
  }
  return null;
}

/** ツール出力の文字列配列を安全に取り込む */
export function sanitizeStringArray(
  arr: unknown,
  opts?: { maxItems?: number; maxLength?: number },
): string[] {
  if (!Array.isArray(arr)) return [];
  const maxItems = opts?.maxItems ?? 20;
  const maxLength = opts?.maxLength ?? 400;
  return arr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLength))
    .slice(0, maxItems);
}
