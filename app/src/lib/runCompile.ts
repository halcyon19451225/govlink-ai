export interface CompileState {
  step: string;
  progress: number;
  totalChunks?: number | undefined;
  chunkIndex?: number | undefined;
  done: boolean;
  error?: string | undefined;
  stalled?: boolean | undefined;
}

export type OnProgress = (state: CompileState) => void;

interface StatusResponse {
  status: string;
  processing_step: string | null;
  processing_progress: number | null;
  processed_chunks: number | null;
  total_chunks: number | null;
  error_message: string | null;
  stalled?: boolean;
}

const POLL_INTERVAL_MS = 2000;

/**
 * /start を1回叩いてチェーンを起動し、
 * 以後ポーリングで進捗を onProgress に渡す。
 */
export async function runCompile(
  documentId: string,
  onProgress: OnProgress,
): Promise<void> {
  // チェーン起動
  const startRes = await fetch(
    `/api/ordo-admin/knowledge/compile/${documentId}/start`,
    { method: "POST" },
  );
  const startJson = await startRes.json() as { ok: boolean; error?: string };
  if (!startJson.ok) {
    onProgress({
      step: "extract",
      progress: 0,
      done: false,
      error: startJson.error ?? "起動に失敗しました",
    });
    return;
  }

  // ポーリング開始
  await pollStatus(documentId, onProgress);
}

/** 再試行: /start を叩き直してポーリング */
export async function retryCompile(
  documentId: string,
  onProgress: OnProgress,
): Promise<void> {
  return runCompile(documentId, onProgress);
}

async function pollStatus(
  documentId: string,
  onProgress: OnProgress,
): Promise<void> {
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/ordo-admin/knowledge/documents/${documentId}/status`,
        );

        // 非200（404など）は即終了
        if (!res.ok) {
          resolve();
          return;
        }

        const json = await res.json() as { data: StatusResponse | null };
        const data = json.data;

        if (!data) {
          resolve();
          return;
        }

        onProgress({
          step: data.processing_step ?? "extract",
          progress: data.processing_progress ?? 0,
          totalChunks: data.total_chunks ?? undefined,
          done: data.status === "compiled",
          error: data.status === "error" ? (data.error_message ?? "エラーが発生しました") : undefined,
          stalled: data.stalled,
        });

        // processing 以外（pending/compiled/error）またはストール検知で停止。
        // 「processing の間だけ続行」とすることで、リセット後の pending でも
        // 確実にループが止まる。
        if (data.status !== "processing" || data.stalled) {
          resolve();
          return;
        }
      } catch (e) {
        console.error("[pollStatus] error:", e);
        resolve(); // 例外でも無限ループを防ぐ
        return;
      }

      setTimeout(() => { void tick(); }, POLL_INTERVAL_MS);
    };

    void tick();
  });
}
