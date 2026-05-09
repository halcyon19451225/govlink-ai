export interface MonteCarloParams {
  insured_n: { mean: number; stddev: number };
  delta_cert_rate: { mean: number; stddev: number };
  unit_benefit: { mean: number; stddev: number };
  delta_recep_rate: { mean: number; stddev: number };
  recipient_count: { mean: number; stddev: number };
  delta_unit_benefit: { mean: number; stddev: number };
  total_investment: number; // 固定値
  iterations: number; // default 10000
}

export interface MonteCarloResult {
  cost_ratios: number[]; // 全iterations の結果
  mean: number;
  stddev: number;
  p5: number; // 5パーセンタイル
  p95: number; // 95パーセンタイル
  histogram: Array<{ bin: string; count: number }>; // 20ビンのヒストグラム
}

// ブラウザサイドから呼び出すユーティリティ（Workerを起動する）
export function runMonteCarloInWorker(
  params: MonteCarloParams,
  onResult: (result: MonteCarloResult) => void,
  onError: (err: string) => void,
): Worker {
  const worker = new Worker("/monte-carlo-worker.js");
  worker.postMessage(params);
  worker.onmessage = (e: MessageEvent) => {
    onResult(e.data as MonteCarloResult);
    worker.terminate();
  };
  worker.onerror = (e) => {
    onError(e.message ?? "Worker error");
    worker.terminate();
  };
  return worker;
}
