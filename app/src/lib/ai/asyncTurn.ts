import "server-only";
import { randomBytes } from "crypto";
import { z } from "zod";
import { queryOne } from "@/lib/db";

/**
 * 対話型モジュール（現状整理・課題仮説設定・施策構築・A改善）共通の
 * AIターン非同期化ヘルパー（migration 055）。
 *
 * 背景: Amplify Hosting は API 応答を 30 秒で切断する。AI処理（web_search
 * 併用・追いターン）はこれを超えることがあり、サーバーは処理を完了して
 * 保存しているのに画面が「通信エラー」になっていた。
 *
 * 方式（ナレッジ編纂のチェーンと同じ考え方）:
 *   1. POST /chat（利用者）: beginTurn で発言を保存し turn_status=processing に
 *      した上で、自分自身の /chat を step_token 付きで fire-and-forget 呼び出しし、
 *      202 で即応答する
 *   2. POST /chat（step_token 付き・セッション不要）: claimStep でトークンを検証し、
 *      AI処理を行って結果を保存。SET 句に turnDoneSql() を含めて idle に戻す。
 *      失敗時は failTurn で error にする（利用者の発言は残るので再試行できる）
 *   3. 画面は GET をポーリングし、turn_status が processing でなくなったら反映
 *
 * 失効: processing のまま TURN_STALE_MINUTES を超えた行は失効扱いとし、
 * 次の発言・再試行を受け付ける（自己呼び出しが届かなかった場合の回復路）。
 */

export type TurnStatus = "idle" | "processing" | "error";

export type TurnTable =
  | "asis_analyses"
  | "issue_dialogues"
  | "measure_dialogues"
  | "improvement_dialogues";

export const TURN_STALE_MINUTES = 3;

/** 画面へ返す turn 状態 */
export interface TurnState {
  turn_status: TurnStatus;
  turn_error: string | null;
  turn_started_at: string | null;
}

export interface TurnColumns {
  turn_status: TurnStatus;
  turn_error: string | null;
  turn_started_at: string | null;
}

/** SELECT に足す列（行に TurnColumns を混ぜる） */
export const TURN_SELECT_SQL =
  "turn_status, turn_error, turn_started_at::text AS turn_started_at";

/** 処理中のまま失効した行を error 相当として画面に見せる */
export function turnStateOf(row: TurnColumns): TurnState {
  if (row.turn_status === "processing" && isStale(row.turn_started_at)) {
    return {
      turn_status: "error",
      turn_error: "AI処理の応答が届きませんでした。再試行してください",
      turn_started_at: row.turn_started_at,
    };
  }
  return {
    turn_status: row.turn_status,
    turn_error: row.turn_error,
    turn_started_at: row.turn_started_at,
  };
}

function isStale(startedAt: string | null): boolean {
  if (!startedAt) return true;
  const t = new Date(startedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > TURN_STALE_MINUTES * 60_000;
}

/** step 呼び出しの本文 */
export const stepBodySchema = z.object({
  step_token: z.string().min(32).max(128),
});

export function isStepRequest(raw: unknown): raw is { step_token: string } {
  return stepBodySchema.safeParse(raw).success;
}

export type BeginTurnResult<M> =
  | { ok: true; token: string; messages: M[] }
  | { ok: false; reason: "busy" | "nothing_to_retry" | "not_found" };

/**
 * ターンを開始する（原子的）。
 * - userMessage あり: 発言を messages に追記して processing にする
 * - userMessage なし（再試行）: error か失効した processing の行だけを processing に戻す。
 *   直前の発言が利用者のものである（＝未処理の発言が残っている）ことを条件にする
 */
export async function beginTurn<M>(
  table: TurnTable,
  id: string,
  projectId: string,
  userMessage: M | null,
): Promise<BeginTurnResult<M>> {
  const token = randomBytes(24).toString("hex");
  const notBusy = `(turn_status <> 'processing' OR turn_started_at IS NULL OR turn_started_at < now() - interval '${TURN_STALE_MINUTES} minutes')`;

  const row = userMessage
    ? await queryOne<{ messages: M[] }>(
        `UPDATE ${table}
         SET messages = messages || $3::jsonb,
             turn_status = 'processing', turn_started_at = now(),
             turn_token = $4, turn_error = NULL
         WHERE id = $1 AND project_id = $2 AND ${notBusy}
         RETURNING messages`,
        [id, projectId, JSON.stringify([userMessage]), token],
      )
    : await queryOne<{ messages: M[] }>(
        `UPDATE ${table}
         SET turn_status = 'processing', turn_started_at = now(),
             turn_token = $3, turn_error = NULL
         WHERE id = $1 AND project_id = $2 AND ${notBusy}
           AND turn_status <> 'idle'
           AND jsonb_array_length(messages) > 0
           AND messages->-1->>'role' = 'user'
         RETURNING messages`,
        [id, projectId, token],
      );

  if (row) return { ok: true, token, messages: row.messages };

  const exists = await queryOne<{ turn_status: TurnStatus; turn_started_at: string | null }>(
    `SELECT turn_status, turn_started_at::text AS turn_started_at
     FROM ${table} WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  );
  if (!exists) return { ok: false, reason: "not_found" };
  if (exists.turn_status === "processing" && !isStale(exists.turn_started_at)) {
    return { ok: false, reason: "busy" };
  }
  return { ok: false, reason: userMessage ? "busy" : "nothing_to_retry" };
}

/**
 * step 呼び出しのトークンを検証する。処理中かつトークン一致の行だけ true。
 * （失効した行でも、トークンが一致すれば処理を続けてよい — 結果は上書き保存される）
 */
export async function claimStep(
  table: TurnTable,
  id: string,
  projectId: string,
  token: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table}
     WHERE id = $1 AND project_id = $2 AND turn_status = 'processing' AND turn_token = $3`,
    [id, projectId, token],
  );
  return row !== null;
}

/** 結果保存の UPDATE の SET 句に含める断片（turn_token が一致する行だけ更新すること） */
export function turnDoneSql(): string {
  return "turn_status = 'idle', turn_token = NULL, turn_error = NULL, turn_started_at = NULL";
}

/** 失敗を記録する（利用者の発言は残す＝再試行できる） */
export async function failTurn(
  table: TurnTable,
  id: string,
  token: string,
  message: string,
): Promise<void> {
  try {
    await queryOne(
      `UPDATE ${table}
       SET turn_status = 'error', turn_error = $3, turn_token = NULL
       WHERE id = $1 AND turn_token = $2
       RETURNING id`,
      [id, token, message.slice(0, 500)],
    );
  } catch (e) {
    console.error("[asyncTurn.failTurn]", e instanceof Error ? e.message : e);
  }
}

/**
 * 自分自身の /chat を step_token 付きで fire-and-forget 呼び出しする。
 * chain-fetch.ts と同じ理由で AbortController は使わず、await もしない。
 * keepalive:true によりレスポンス返却後でもパケット送出は保証される。
 * pathname は "/api/admin/projects/<id>/issue-dialogue/<dialogueId>/chat" の形。
 */
export function triggerTurnStep(pathname: string, token: string): void {
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step_token: token }),
    keepalive: true,
  }).catch((e: unknown) => {
    console.error("[asyncTurn.triggerTurnStep] fetch failed:", e instanceof Error ? e.message : e);
  });
}

/** 利用者向けの「処理中」応答（202） */
export function acceptedPayload<M>(messages: M[]) {
  return {
    data: { turn_status: "processing" as const, turn_error: null, messages },
    error: null,
  };
}

export const BUSY_ERROR = "AIが前の発言を処理中です。しばらく待ってから送信してください";
export const NOTHING_TO_RETRY_ERROR = "再試行できる発言がありません";
