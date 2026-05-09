export interface ZScoreInput {
  label: string;
  value: number;
}

export interface ZScoreResult {
  items: Array<{
    label: string;
    value: number;
    zScore: number;
    rank: "high" | "low" | "normal";
  }>;
  mean: number;
  stddev: number;
  calculationSteps: {
    formula: string;
    mean: number;
    stddev: number;
    interpretation: string;
  };
}

export function calcZScore(data: ZScoreInput[]): ZScoreResult {
  if (data.length === 0) {
    throw new Error("Zスコア計算にはデータが必要です");
  }

  const n = data.length;
  const mean = data.reduce((acc, d) => acc + d.value, 0) / n;
  const variance = data.reduce((acc, d) => acc + Math.pow(d.value - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);

  const items = data.map((d) => {
    const zScore = stddev > 0 ? (d.value - mean) / stddev : 0;
    const rank: "high" | "low" | "normal" =
      zScore > 1.5 ? "high" : zScore < -1.5 ? "low" : "normal";
    return {
      label: d.label,
      value: d.value,
      zScore: Math.round(zScore * 10000) / 10000,
      rank,
    };
  });

  const highCount = items.filter((i) => i.rank === "high").length;
  const lowCount = items.filter((i) => i.rank === "low").length;
  const interpretation =
    `平均値: ${mean.toFixed(2)}, 標準偏差: ${stddev.toFixed(2)}。` +
    (highCount > 0 ? `高値（|z|>1.5）: ${highCount}件。` : "") +
    (lowCount > 0 ? `低値（|z|<-1.5）: ${lowCount}件。` : "") +
    (highCount === 0 && lowCount === 0 ? "全データが平均的な範囲内です。" : "");

  return {
    items,
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(stddev * 10000) / 10000,
    calculationSteps: {
      formula: "z = (x - mean) / stddev",
      mean: Math.round(mean * 10000) / 10000,
      stddev: Math.round(stddev * 10000) / 10000,
      interpretation,
    },
  };
}
