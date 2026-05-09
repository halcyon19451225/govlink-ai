export interface GapRow {
  current_value: number;
  target_value: number;
  affected_population?: number;
  trend: "improving" | "worsening" | "stable" | "unknown";
}

export interface PriorityResult {
  score: number;
  breakdown: {
    gapMagnitude: number;
    populationWeight: number;
    trendWeight: number;
    formula: string;
  };
}

export function calcGapPriority(gap: GapRow): PriorityResult {
  const gapMagnitude = Math.min(
    100,
    (Math.abs(gap.target_value - gap.current_value) /
      Math.max(Math.abs(gap.current_value), 1)) *
      100,
  );

  const populationWeight =
    gap.affected_population != null
      ? Math.min(100, (gap.affected_population / 10000) * 10)
      : 50;

  const trendWeightMap: Record<GapRow["trend"], number> = {
    worsening: 100,
    stable: 50,
    unknown: 30,
    improving: 10,
  };
  const trendWeight = trendWeightMap[gap.trend];

  const score = Math.round(
    gapMagnitude * 0.4 + populationWeight * 0.4 + trendWeight * 0.2,
  );

  return {
    score,
    breakdown: {
      gapMagnitude: Math.round(gapMagnitude * 100) / 100,
      populationWeight: Math.round(populationWeight * 100) / 100,
      trendWeight,
      formula: `score = gapMagnitude(${gapMagnitude.toFixed(1)})×0.4 + populationWeight(${populationWeight.toFixed(1)})×0.4 + trendWeight(${trendWeight})×0.2 = ${score}`,
    },
  };
}
