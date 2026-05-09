export interface CorrelationInput {
  label: string;
  values: number[];
}

export interface CorrelationMatrix {
  labels: string[];
  matrix: number[][]; // [i][j] = Pearson相関係数 (-1〜1)
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;

  const meanX = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanY = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;

  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  if (denom === 0) return 0;

  return sumXY / denom;
}

export function calcCorrelationMatrix(
  inputs: CorrelationInput[],
): CorrelationMatrix {
  const labels = inputs.map((i) => i.label);
  const n = inputs.length;

  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      if (i === j) return 1;
      const rowI = inputs[i];
      const rowJ = inputs[j];
      if (!rowI || !rowJ) return 0;
      return pearson(rowI.values, rowJ.values);
    }),
  );

  return { labels, matrix };
}
