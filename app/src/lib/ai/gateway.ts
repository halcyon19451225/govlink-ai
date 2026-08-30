import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { query, queryOne } from "@/lib/db";
import {
  type AiTaskType,
  type AiTaskRouting,
  isAiTaskType,
  normalizeRouting,
  resolveEffectiveMode,
  DEFAULT_AI_MODEL,
} from "@/lib/ai/taskTypes";

/**
 * AIゲートウェイ — 全AI呼び出しの唯一の入口 — X1
 *
 * ── 役割 ───────────────────────────────────────────────
 * 1. Claude API 呼び出しの一本化（クライアント生成・APIキー確認をここに集約）
 * 2. 利用ログ（ai_usage_logs）: タスク種別・トークン数・レイテンシ・成否。
 *    プロンプト・応答の本文は保存しない。
 * 3. ルーティング（ai_task_routing）: タスク別に独自AIへの段階移行を制御する
 *    切り替え点。X1で有効な動作は claude のみ。shadow / assist / primary は
 *    X4（コーパス接地）で実装し、それまでは claude に安全側フォールバック。
 *
 * ── 使い方 ─────────────────────────────────────────────
 *   const msg = await aiCreateMessage(
 *     { taskType: "analysis.stats", projectId },
 *     { max_tokens: 400, messages: [...] },  // model 省略時は DEFAULT_AI_MODEL
 *   );
 *   const stream = aiStreamMessage({ taskType: "generation.summary" }, {...});
 *
 * 新しい呼び出し箇所を作るときは taskTypes.ts に種別を追加してから使う。
 * `new Anthropic(...)` をルートで直接書かないこと（このファイル以外での
 * SDK直接利用は scripts/check-ai-gateway.mjs が検出して落とす）。
 *
 * 設計: claude/coe-ownai-plan.md（承認済み方針）X1。
 */

export interface AiCallContext {
  taskType: AiTaskType;
  projectId?: string | null;
  municipalityId?: string | null;
}

// ─── クライアント（プロセス内シングルトン）───────────────

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません");
  }
  client = new Anthropic({ apiKey });
  return client;
}

// ─── ルーティング設定（プロセス内キャッシュ・TTL 60秒）───

const routingCache = new Map<string, { at: number; routing: AiTaskRouting }>();
const ROUTING_TTL_MS = 60 * 1000;

/** タスクのルーティング設定を返す（未登録・取得失敗は claude 扱い） */
export async function getTaskRouting(taskType: AiTaskType): Promise<AiTaskRouting> {
  const fallback: AiTaskRouting = { task_type: taskType, mode: "claude", ordo_weight: 0 };
  const hit = routingCache.get(taskType);
  if (hit && Date.now() - hit.at < ROUTING_TTL_MS) return hit.routing;
  try {
    const row = await queryOne(
      "SELECT task_type, mode, ordo_weight FROM ai_task_routing WHERE task_type = $1",
      [taskType],
    );
    const routing = normalizeRouting(row) ?? fallback;
    routingCache.set(taskType, { at: Date.now(), routing });
    return routing;
  } catch (e) {
    console.warn("AIルーティング設定の取得に失敗（claudeで続行）:", e);
    return hit ? hit.routing : fallback;
  }
}

/** ルーティング更新時（管理API）にキャッシュを破棄する */
export function invalidateRoutingCache(): void {
  routingCache.clear();
}

// ─── 利用ログ ─────────────────────────────────────────────

interface UsageLogEntry {
  ctx: AiCallContext;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** プロンプトキャッシュへ書き込んだ入力トークン数（割増課金） */
  cacheWriteTokens?: number | null;
  /** プロンプトキャッシュから読んだ入力トークン数（約1割の単価） */
  cacheReadTokens?: number | null;
  latencyMs: number;
  status: "ok" | "error";
  errorMessage?: string | null;
}

/** ログ失敗は本処理を壊さない（warnのみ） */
async function logUsage(entry: UsageLogEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_usage_logs
         (task_type, provider, model, input_tokens, output_tokens,
          cache_write_tokens, cache_read_tokens,
          latency_ms, status, error_message, project_id, municipality_id)
       VALUES ($1, 'claude', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.ctx.taskType,
        entry.model,
        entry.inputTokens ?? null,
        entry.outputTokens ?? null,
        entry.cacheWriteTokens ?? null,
        entry.cacheReadTokens ?? null,
        entry.latencyMs,
        entry.status,
        entry.errorMessage ? entry.errorMessage.slice(0, 500) : null,
        entry.ctx.projectId ?? null,
        entry.ctx.municipalityId ?? null,
      ],
    );
  } catch (e) {
    console.warn("AI利用ログの記録に失敗:", e);
  }
}

// ─── 呼び出し本体 ─────────────────────────────────────────

type CreateParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "model"> & {
  model?: string;
};
type StreamParams = Omit<Anthropic.MessageStreamParams, "model"> & { model?: string };

function assertTaskType(taskType: string): void {
  if (!isAiTaskType(taskType)) {
    throw new Error(`未知のAIタスク種別です: ${taskType}（taskTypes.ts に追加してください）`);
  }
}

/**
 * 非ストリーミング呼び出し。全ルート・ライブラリはこれを使う。
 * ルーティング設定を参照するが、X1で有効な動作は claude のみ
 * （resolveEffectiveMode が未実装モードを claude に解決する）。
 */
export async function aiCreateMessage(
  ctx: AiCallContext,
  params: CreateParams,
): Promise<Anthropic.Message> {
  assertTaskType(ctx.taskType);
  const routing = await getTaskRouting(ctx.taskType);
  // X4でここに shadow / assist / primary の分岐が入る
  void resolveEffectiveMode(routing.mode);

  const model = params.model ?? DEFAULT_AI_MODEL;
  const t0 = Date.now();
  try {
    const msg = await getClient().messages.create({ ...params, model, stream: false });
    await logUsage({
      ctx,
      model,
      inputTokens: msg.usage?.input_tokens ?? null,
      outputTokens: msg.usage?.output_tokens ?? null,
      cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? null,
      cacheReadTokens: msg.usage?.cache_read_input_tokens ?? null,
      latencyMs: Date.now() - t0,
      status: "ok",
    });
    return msg;
  } catch (e) {
    await logUsage({
      ctx,
      model,
      latencyMs: Date.now() - t0,
      status: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * ストリーミング呼び出し（生成系ルートで使用）。
 * 利用ログは最終メッセージ解決時に記録する（応答の送出を妨げない）。
 */
export function aiStreamMessage(ctx: AiCallContext, params: StreamParams) {
  assertTaskType(ctx.taskType);
  const model = params.model ?? DEFAULT_AI_MODEL;
  const t0 = Date.now();
  const stream = getClient().messages.stream({ ...params, model });
  stream
    .finalMessage()
    .then((msg) =>
      logUsage({
        ctx,
        model,
        inputTokens: msg.usage?.input_tokens ?? null,
        outputTokens: msg.usage?.output_tokens ?? null,
        cacheWriteTokens: msg.usage?.cache_creation_input_tokens ?? null,
        cacheReadTokens: msg.usage?.cache_read_input_tokens ?? null,
        latencyMs: Date.now() - t0,
        status: "ok",
      }),
    )
    .catch((e: unknown) =>
      logUsage({
        ctx,
        model,
        latencyMs: Date.now() - t0,
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
      }),
    );
  return stream;
}
