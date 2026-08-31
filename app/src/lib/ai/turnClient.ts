/**
 * 対話型モジュールの非同期AIターン — 画面側ヘルパー（client でも server でも使える純粋関数）。
 * サーバー側の対は lib/ai/asyncTurn.ts。
 *
 * POST /chat が 202 { data: { turn_status: "processing", messages } } を返したら、
 * waitForTurn で GET をポーリングして turn_status が processing でなくなるのを待つ。
 */

export type TurnStatus = "idle" | "processing" | "error";

export interface TurnFields {
  turn_status?: TurnStatus | null;
  turn_error?: string | null;
}

export const TURN_POLL_INTERVAL_MS = 2000;
/** サーバー側の失効（3分）より少し長く待つ */
export const TURN_POLL_TIMEOUT_MS = 4 * 60_000;

export const TURN_TIMEOUT_ERROR =
  "AIの応答待ちがタイムアウトしました。画面を再読み込みするか、再試行してください";

export function isTurnProcessing(rec: TurnFields | null | undefined): boolean {
  return rec?.turn_status === "processing";
}

/** POST /chat の応答が「受理（処理中）」かどうか */
export function isAcceptedTurn(status: number, data: unknown): data is { turn_status: "processing" } {
  return (
    status === 202 &&
    typeof data === "object" &&
    data !== null &&
    (data as { turn_status?: unknown }).turn_status === "processing"
  );
}

/**
 * GET url をポーリングし、turn_status が processing でなくなった時点の data を返す。
 * 通信の一時的な失敗は無視して続行する（処理はサーバー側で進んでいるため）。
 * タイムアウト時は TURN_TIMEOUT_ERROR を投げる。
 */
export async function waitForTurn<T extends TurnFields>(
  url: string,
  opts?: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const interval = opts?.intervalMs ?? TURN_POLL_INTERVAL_MS;
  const timeout = opts?.timeoutMs ?? TURN_POLL_TIMEOUT_MS;
  const started = Date.now();

  for (;;) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { data: T | null };
        if (json.data && !isTurnProcessing(json.data)) return json.data;
      }
    } catch {
      // 一時的な通信失敗は無視して続行
    }
    if (Date.now() - started > timeout) throw new Error(TURN_TIMEOUT_ERROR);
  }
}

/**
 * AI処理の実体（step）を画面から起動する。
 *
 * 以前はサーバーが 202 を返したあと自分自身を fire-and-forget で呼んでいたが、
 * Lambda はレスポンスを返した時点で実行を凍結するため、その呼び出しは
 * 届かないことがあった（AIを一度も呼ばないままターンが固まる。2026-08-31）。
 * ブラウザは凍結されないので、起動役を画面側へ移している。
 *
 * この応答は待たない — 結果は waitForTurn のポーリングで取り込む。
 * 実行は30秒を超えることがあり、Amplify が応答を切っても
 * サーバー側の処理は最後まで走って保存される。
 * 送信に失敗しても握りつぶす（失効から再試行できる）。
 */
export function requestTurnStep(chatUrl: string): void {
  void fetch(chatUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "step" }),
  }).catch(() => {
    // ポーリングが処理中のまま失効を検出し、再試行の導線に出る
  });
}
