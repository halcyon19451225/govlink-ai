import "server-only";

/**
 * 次ステップを fire-and-forget で自己fetchする。
 * AbortController は使わない。ボディ送信完了前に abort するとサーバー側で
 * "Unexpected end of JSON input" になるため。
 * fetch Promise を await せず .catch() だけ付けて投げっぱなしにする。
 * Lambda本番ではレスポンス返却後にプロセスが凍結されることがあるが、
 * keepalive:true によって OSネットワーク層でのパケット送出は保証される。
 */
export function triggerNextStep(
  documentId: string,
  step: string,
  chunkIndex: number | undefined,
  chainToken: string,
): void {
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

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch((e: unknown) => {
    console.error("[triggerNextStep] fetch failed:", e instanceof Error ? e.message : e);
  });
}
