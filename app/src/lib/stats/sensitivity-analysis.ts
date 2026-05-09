export interface CostParams {
  insured_n: number;
  delta_cert_rate: number; // %
  unit_benefit: number;
  delta_recep_rate: number; // %
  recipient_count: number;
  delta_unit_benefit: number;
  total_investment: number;
}

export interface SensitivityResult {
  baseline_ratio: number;
  items: Array<{
    param: string;
    label: string;
    low10pct: number;
    high10pct: number;
    low20pct: number;
    high20pct: number;
    impact: number;
  }>;
}

function calcRatio(p: CostParams): number {
  const a = Math.abs(p.insured_n) * (Math.abs(p.delta_cert_rate) / 100) * Math.abs(p.unit_benefit);
  const b = Math.abs(p.recipient_count) * (Math.abs(p.delta_recep_rate) / 100) * Math.abs(p.unit_benefit);
  const c = Math.abs(p.recipient_count) * Math.abs(p.delta_unit_benefit);
  const total = a + b + c;
  if (total === 0) return Infinity;
  return p.total_investment / total;
}

export function calcSensitivity(params: CostParams): SensitivityResult {
  const baseline_ratio = calcRatio(params);

  type ParamKey = keyof Omit<CostParams, "total_investment">;

  const paramDefs: Array<{ param: ParamKey; label: string }> = [
    { param: "insured_n", label: "第1号被保険者数" },
    { param: "delta_cert_rate", label: "認定率改善幅(%)" },
    { param: "unit_benefit", label: "1人当たり給付費" },
    { param: "delta_recep_rate", label: "受給率改善幅(%)" },
    { param: "recipient_count", label: "受給者数" },
    { param: "delta_unit_benefit", label: "単位給付費改善幅" },
  ];

  const items = paramDefs.map(({ param, label }) => {
    const base = params[param];

    const withChange = (factor: number) => {
      const modified: CostParams = { ...params, [param]: base * factor };
      return calcRatio(modified);
    };

    const low10pct = withChange(0.9);
    const high10pct = withChange(1.1);
    const low20pct = withChange(0.8);
    const high20pct = withChange(1.2);
    const impact = Math.abs(high10pct - low10pct);

    return {
      param,
      label,
      low10pct: isFinite(low10pct) ? Math.round(low10pct * 10000) / 10000 : 0,
      high10pct: isFinite(high10pct) ? Math.round(high10pct * 10000) / 10000 : 0,
      low20pct: isFinite(low20pct) ? Math.round(low20pct * 10000) / 10000 : 0,
      high20pct: isFinite(high20pct) ? Math.round(high20pct * 10000) / 10000 : 0,
      impact: isFinite(impact) ? Math.round(impact * 10000) / 10000 : 0,
    };
  });

  // impact降順でソート（tornado chart用）
  items.sort((a, b) => b.impact - a.impact);

  return {
    baseline_ratio: isFinite(baseline_ratio) ? Math.round(baseline_ratio * 10000) / 10000 : 0,
    items,
  };
}
