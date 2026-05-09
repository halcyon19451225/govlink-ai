export interface AgeGroupData {
  age_group: string;
  observed_count: number;
  population: number;
  standard_population: number;
}

export interface AgeStdResult {
  standardized_rate: number;
  crude_rate: number;
  calculationSteps: {
    formula: string;
    groups: Array<{
      age_group: string;
      observed_count: number;
      population: number;
      standard_population: number;
      age_specific_rate: number;
      expected_count: number;
    }>;
    interpretation: string;
  };
}

export function calcAgeStandardization(data: AgeGroupData[]): AgeStdResult {
  if (data.length === 0) {
    throw new Error("年齢調整計算にはデータが必要です");
  }

  const totalObserved = data.reduce((acc, d) => acc + d.observed_count, 0);
  const totalPopulation = data.reduce((acc, d) => acc + d.population, 0);
  const totalStdPop = data.reduce((acc, d) => acc + d.standard_population, 0);

  const crudeRate = totalPopulation > 0 ? (totalObserved / totalPopulation) * 100000 : 0;

  const groups = data.map((d) => {
    const ageSpecificRate = d.population > 0 ? d.observed_count / d.population : 0;
    const expectedCount = ageSpecificRate * d.standard_population;
    return {
      age_group: d.age_group,
      observed_count: d.observed_count,
      population: d.population,
      standard_population: d.standard_population,
      age_specific_rate: Math.round(ageSpecificRate * 100000 * 100) / 100,
      expected_count: Math.round(expectedCount * 100) / 100,
    };
  });

  const totalExpected = groups.reduce((acc, g) => acc + g.expected_count, 0);
  const standardizedRate =
    totalStdPop > 0 ? (totalExpected / totalStdPop) * 100000 : 0;

  const interpretation =
    `粗率: ${crudeRate.toFixed(1)}（人口10万対）、年齢調整率: ${standardizedRate.toFixed(1)}（人口10万対）。` +
    (standardizedRate < crudeRate
      ? "年齢調整後は粗率より低く、高齢化の影響が示唆されます。"
      : standardizedRate > crudeRate
      ? "年齢調整後は粗率より高く、若年層での実態が粗率に反映されていない可能性があります。"
      : "粗率と年齢調整率はほぼ同等です。");

  return {
    standardized_rate: Math.round(standardizedRate * 100) / 100,
    crude_rate: Math.round(crudeRate * 100) / 100,
    calculationSteps: {
      formula:
        "年齢調整率 = (Σ(年齢別率 × 基準人口)) / 基準人口合計 × 100,000",
      groups,
      interpretation,
    },
  };
}
