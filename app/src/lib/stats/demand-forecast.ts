export interface ForecastPoint {
  year: number;
  value: number | null;
  forecast: number;
  lower95: number;
  upper95: number;
}

export interface DemandForecastResult {
  slope: number;
  intercept: number;
  rSquared: number;
  points: ForecastPoint[];
  interpretation: string;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calcDemandForecast(
  data: Array<{ year: number; value: number }>,
  horizonYears = 3,
): DemandForecastResult {
  const n = data.length;
  if (n < 2) {
    throw new Error("需要予測には2点以上のデータが必要です");
  }

  const meanX = data.reduce((s, d) => s + d.year, 0) / n;
  const meanY = data.reduce((s, d) => s + d.value, 0) / n;

  const SXX = data.reduce((s, d) => s + Math.pow(d.year - meanX, 2), 0);
  const SXY = data.reduce((s, d) => s + (d.year - meanX) * (d.value - meanY), 0);

  const slope = SXX !== 0 ? SXY / SXX : 0;
  const intercept = meanY - slope * meanX;

  const ssTot = data.reduce((s, d) => s + Math.pow(d.value - meanY, 2), 0);
  const SSR = data.reduce((s, d) => {
    const yhat = slope * d.year + intercept;
    return s + Math.pow(d.value - yhat, 2);
  }, 0);
  const rSquared = ssTot > 0 ? 1 - SSR / ssTot : 0;

  const s2 = n > 2 ? SSR / (n - 2) : SSR;
  const s = Math.sqrt(s2);

  const pi = (x: number) => {
    const yhat = slope * x + intercept;
    const margin = 1.96 * s * Math.sqrt(1 + 1 / n + Math.pow(x - meanX, 2) / SXX);
    return { yhat: round2(yhat), lower: round2(yhat - margin), upper: round2(yhat + margin) };
  };

  const maxYear = Math.max(...data.map((d) => d.year));

  const historicalPoints: ForecastPoint[] = data.map((d) => {
    const { yhat, lower, upper } = pi(d.year);
    return { year: d.year, value: d.value, forecast: yhat, lower95: lower, upper95: upper };
  });

  const forecastPoints: ForecastPoint[] = Array.from({ length: horizonYears }, (_, i) => {
    const yr = maxYear + i + 1;
    const { yhat, lower, upper } = pi(yr);
    return { year: yr, value: null, forecast: yhat, lower95: lower, upper95: upper };
  });

  let interpretation: string;
  if (Math.abs(slope) < 0.001) {
    interpretation = `需要はほぼ横ばいの傾向です（R²=${round2(rSquared)}）。`;
  } else if (slope > 0) {
    interpretation = `年間約${round2(slope)}の増加傾向を示しています（R²=${round2(rSquared)}）。${horizonYears}年後の予測値は約${pi(maxYear + horizonYears).yhat}です。`;
  } else {
    interpretation = `年間約${round2(Math.abs(slope))}の減少傾向を示しています（R²=${round2(rSquared)}）。${horizonYears}年後の予測値は約${pi(maxYear + horizonYears).yhat}です。`;
  }

  return {
    slope: round2(slope),
    intercept: round2(intercept),
    rSquared: round2(rSquared),
    points: [...historicalPoints, ...forecastPoints],
    interpretation,
  };
}
