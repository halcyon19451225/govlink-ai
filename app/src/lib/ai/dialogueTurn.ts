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
  /** web_search の1ターンあたり最大回数 */
  maxSearchUses?: number;
}

export async function callDialogueTool(
  ctx: AiCallContext,
  systemText: string,
  inputMessages: Anthropic.MessageParam[],
  opts: CallDialogueToolOptions,
): Promise<Anthropic.ToolUseBlock | null> {
  const maxTokens = opts.maxTokens ?? 2500;

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

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use" && c.name === opts.tool.name,
  );
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
