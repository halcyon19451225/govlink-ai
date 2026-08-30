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
 * - プロンプトキャッシュ: システムプロンプトを「不変部（役割・工程ガイド・
 *   プロジェクト情報・参照ナレッジ）」と「可変部（現在のフェーズ・これまでの整理内容）」に
 *   分け、不変部にだけ区切りを置く。1つのブロックにまとめて末尾に区切りを置くと、
 *   毎ターン中身が変わるため読み出しが一度も当たらず、書き込みの割増だけを払うことになる
 *   （2026-08-30 まで実際にその状態だった）。履歴は末尾に積まれるだけなので前半も再利用できる。
 *   保持時間は1時間。担当者が回答を考える間隔（実測で1〜23分）は既定の5分では外れる。
 * - サーバーツールの実行が長引くと stop_reason="pause_turn" で返るため、
 *   assistant の内容を積んで続きを要求する。
 */
export const DIALOGUE_MODEL = "claude-sonnet-4-6";

/**
 * システムプロンプト。
 * 文字列で渡すと従来どおり全体を1ブロックとして扱う（キャッシュは効きにくい）。
 * 分けて渡すと不変部だけをキャッシュ対象にできる。
 */
export type DialogueSystem = string | { stable: string; volatile?: string };

/**
 * 保持時間は区切りの性質で分ける。
 * - 不変部（システムプロンプト）は対話中ずっと同じ内容なので、一度書けば何度も読める。
 *   書き込みは事実上1回なので、長く持つ 1h が得。
 * - 対話履歴は毎ターン伸びるため書き込みが繰り返し発生する。1h の書き込みは通常単価の
 *   2倍、5m なら1.25倍なので、こちらは 5m のほうが安い。
 * 実測（2026-08-30）では書き込みが読み出しの節約を食っており、この分離で改善するはず。
 * 変更後は `npm run ai:errors -- 5 all` の cache(read=… write=…) で確認できる。
 */
const CACHE_STABLE: Anthropic.CacheControlEphemeral = { type: "ephemeral", ttl: "1h" };
const CACHE_HISTORY: Anthropic.CacheControlEphemeral = { type: "ephemeral", ttl: "5m" };

/** system ブロックを組み立てる（不変部にだけキャッシュの区切りを置く） */
function buildSystemBlocks(system: DialogueSystem): Anthropic.TextBlockParam[] {
  if (typeof system === "string") {
    return [{ type: "text", text: system, cache_control: CACHE_STABLE }];
  }
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: system.stable, cache_control: CACHE_STABLE },
  ];
  const volatile = system.volatile?.trim();
  if (volatile) blocks.push({ type: "text", text: volatile });
  return blocks;
}

/**
 * 対話履歴にキャッシュの区切りを1つ置く。
 * 履歴は末尾に追加されるだけなので、直近のやり取りの手前で区切っておくと
 * 次のターン以降も前半がそのまま再利用される。
 */
function withHistoryCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  // 短い履歴はキャッシュの最小トークン数に届かず、書き込みの割増だけ損になる
  if (messages.length < 5) return messages;
  const idx = messages.length - 3;
  return messages.map((m, i) => {
    if (i !== idx || typeof m.content !== "string" || m.content.length === 0) return m;
    return {
      role: m.role,
      content: [{ type: "text" as const, text: m.content, cache_control: CACHE_HISTORY }],
    };
  });
}

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
  system: DialogueSystem,
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

  const systemBlocks = buildSystemBlocks(system);

  let messages: Anthropic.MessageParam[] = withHistoryCache(inputMessages);
  let response = await aiCreateMessage(ctx, {
    model: DIALOGUE_MODEL,
    max_tokens: maxTokens,
    system: systemBlocks,
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
      system: systemBlocks,
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
    return callDialogueTool(ctx, system, inputMessages, {
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
    return callDialogueTool(ctx, system, inputMessages, {
      ...opts,
      allowWebSearch: false,
    });
  }
  return null;
}

/**
 * web_search の引用マークアップを本文から取り除く。
 *
 * モデルが `<cite index="4-1">…</cite>` のようなタグを本文に混ぜてくることがあり、
 * そのまま保存すると担当者の画面にも、書き出した先の課題仮説にも、
 * さらに計画書にまで生のタグが残る（2026-08-30 に実際に発生）。
 * タグだけを外し、中身の文章は残す。
 */
export function stripCitationMarkup(text: string): string {
  return text
    .replace(/<\/?cite\b[^>]*>/gi, "")
    .replace(/<\/?citation\b[^>]*>/gi, "")
    .replace(/\[\/?cite(?::[^\]]*)?\]/gi, "");
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
    .map((x) => stripCitationMarkup(x).trim().slice(0, maxLength))
    .slice(0, maxItems);
}
