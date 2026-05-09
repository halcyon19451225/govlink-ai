export interface DataPoint {
  year: number;
  value: number;
}

export interface TrendResult {
  slope: number;
  intercept: number;
  rSquared: number;
  forecast: DataPoint[];
  calculationSteps: {
    n: number;
    sumX: number;
    sumY: number;
    sumXY: number;
    sumX2: number;
    meanX: number;
    meanY: number;
    formula: string;
    interpretation: string;
  };
}

export function calcTrendRegression(data: DataPoint[]): TrendResult {
  const n = data.length;
  if (n < 2) {
    throw new Error("回帰分析には2点以上のデータが必要です");
  }

  const sumX = data.reduce((acc, d) => acc + d.year, 0);
  const sumY = data.reduce((acc, d) => acc + d.value, 0);
  const sumXY = data.reduce((acc, d) => acc + d.year * d.value, 0);
  const sumX2 = data.reduce((acc, d) => acc + d.year * d.year, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = meanY - slope * meanX;

  // R²の計算
  const ssTot = data.reduce((acc, d) => acc + Math.pow(d.value - meanY, 2), 0);
  const ssRes = data.reduce((acc, d) => {
    const predicted = slope * d.year + intercept;
    return acc + Math.pow(d.value - predicted, 2);
  }, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // 予測値（翌年〜3年後）
  const maxYear = Math.max(...data.map((d) => d.year));
  const forecast: DataPoint[] = [1, 2, 3].map((offset) => ({
    year: maxYear + offset,
    value: Math.round((slope * (maxYear + offset) + intercept) * 100) / 100,
  }));

  // interpretation
  let interpretation: string;
  if (Math.abs(slope) < 0.001) {
    interpretation = "ほぼ横ばいの傾向を示しています。";
  } else if (slope > 0) {
    interpretation = `年間約${slope.toFixed(2)}ポイントの増加傾向を示しています（R²=${rSquared.toFixed(3)}）。`;
  } else {
    interpretation = `年間約${Math.abs(slope).toFixed(2)}ポイントの減少傾向を示しています（R²=${rSquared.toFixed(3)}）。`;
  }

  return {
    slope: Math.round(slope * 10000) / 10000,
    intercept: Math.round(intercept * 10000) / 10000,
    rSquared: Math.round(rSquared * 10000) / 10000,
    forecast,
    calculationSteps: {
      n,
      sumX: Math.round(sumX * 100) / 100,
      sumY: Math.round(sumY * 100) / 100,
      sumXY: Math.round(sumXY * 100) / 100,
      sumX2: Math.round(sumX2 * 100) / 100,
      meanX: Math.round(meanX * 100) / 100,
      meanY: Math.round(meanY * 100) / 100,
      formula: `b = (n·ΣXY - ΣX·ΣY) / (n·ΣX² - (ΣX)²) = (${n}·${Math.round(sumXY * 100) / 100} - ${Math.round(sumX * 100) / 100}·${Math.round(sumY * 100) / 100}) / (${n}·${Math.round(sumX2 * 100) / 100} - ${Math.round(sumX * 100) / 100}²) = ${slope.toFixed(4)}, a = meanY - b·meanX = ${intercept.toFixed(4)}`,
      interpretation,
    },
  };
}
