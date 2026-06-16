export interface CompileState {
  step: string;
  progress: number;
  totalChunks?: number | undefined;
  chunkIndex?: number | undefined;
  done: boolean;
  error?: string | undefined;
}

export type OnProgress = (state: CompileState) => void;

interface StepResponse {
  ok: boolean;
  currentStep: string;
  progress: number;
  nextStep: string | null;
  nextChunkIndex?: number;
  totalChunks?: number;
  done?: boolean;
  error?: string;
}

async function callStep(
  documentId: string,
  step: string,
  chunkIndex?: number,
): Promise<StepResponse> {
  const res = await fetch(
    `/api/ordo-admin/knowledge/compile/${documentId}/step`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, chunkIndex }),
    },
  );
  return res.json() as Promise<StepResponse>;
}

export async function runCompile(
  documentId: string,
  onProgress: OnProgress,
): Promise<void> {
  let currentStep = "extract";
  let currentChunkIndex: number | undefined = undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    onProgress({
      step: currentStep,
      progress: 0,
      chunkIndex: currentChunkIndex,
      done: false,
    });

    const res = await callStep(documentId, currentStep, currentChunkIndex);

    if (!res.ok || res.error) {
      onProgress({
        step: currentStep,
        progress: res.progress ?? 0,
        done: false,
        error: res.error ?? "不明なエラーが発生しました",
      });
      return;
    }

    onProgress({
      step: res.currentStep,
      progress: res.progress,
      totalChunks: res.totalChunks,
      chunkIndex: currentChunkIndex,
      done: res.done ?? false,
    });

    if (res.done) return;

    // 次のステップへ
    if (!res.nextStep) return;
    currentStep = res.nextStep;
    currentChunkIndex = res.nextChunkIndex;
  }
}

/** status をリセットして再コンパイル */
export async function retryCompile(
  documentId: string,
  onProgress: OnProgress,
): Promise<void> {
  await fetch(`/api/ordo-admin/knowledge/compile/${documentId}/reset`, {
    method: "POST",
  });
  return runCompile(documentId, onProgress);
}
