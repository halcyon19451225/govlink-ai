import "server-only";

/**
 * 次ステップを fire-and-forget で自己fetchする。
 * 接続確立（ヘッダ受信）または200ms のタイムアウトで resolve する。
 * 失敗しても throw せず console.error に記録するだけ。
 */
export async function triggerNextStep(
  documentId: string,
  step: string,
  chunkIndex: number | undefined,
  chainToken: string,
): Promise<void> {
  const base =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";

  const url = `${base}/api/ordo-admin/knowledge/compile/${documentId}/step`;
  const body = JSON.stringify({
    step,
    chunkIndex,
    chainToken,
    background: true,
  });

  const ac = new AbortController();
  // 200ms 後に abort して接続確立だけ保証する
  const timer = setTimeout(() => ac.abort(), 200);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // keepalive: fetch が完了する前にプロセスが終わっても送出継続
      keepalive: true,
      signal: ac.signal,
    });
  } catch (e) {
    // AbortError（200ms タイムアウト）は正常。それ以外はログに残す。
    if (e instanceof Error && e.name !== "AbortError") {
      console.error("[triggerNextStep] fetch failed:", e.message);
    }
  } finally {
    clearTimeout(timer);
  }
}
