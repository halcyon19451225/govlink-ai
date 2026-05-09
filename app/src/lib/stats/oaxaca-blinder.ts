export interface OaxacaInput {
  insured_n: number;
  planned_cert_rate: number;
  planned_recep_rate: number;
  planned_unit_benefit: number;
  actual_cert_rate: number;
  actual_recep_rate: number;
  actual_unit_benefit: number;
}

export interface OaxacaResult {
  total_gap: number;
  cert_contribution: number;
  recep_contribution: number;
  unit_contribution: number;
  interaction: number;
  cert_pct: number;
  recep_pct: number;
  unit_pct: number;
  interaction_pct: number;
}

export function calcOaxacaBlinder(input: OaxacaInput): OaxacaResult {
  const {
    insured_n,
    planned_cert_rate,
    planned_recep_rate,
    planned_unit_benefit,
    actual_cert_rate,
    actual_recep_rate,
    actual_unit_benefit,
  } = input;

  const planned_benefit = insured_n * planned_cert_rate * planned_recep_rate * planned_unit_benefit;
  const actual_benefit = insured_n * actual_cert_rate * actual_recep_rate * actual_unit_benefit;
  const total_gap = actual_benefit - planned_benefit;

  if (total_gap === 0) {
    return {
      total_gap: 0,
      cert_contribution: 0,
      recep_contribution: 0,
      unit_contribution: 0,
      interaction: 0,
      cert_pct: 0,
      recep_pct: 0,
      unit_pct: 0,
      interaction_pct: 0,
    };
  }

  const cert_contribution =
    insured_n * (actual_cert_rate - planned_cert_rate) * planned_recep_rate * planned_unit_benefit;
  const recep_contribution =
    insured_n * actual_cert_rate * (actual_recep_rate - planned_recep_rate) * planned_unit_benefit;
  const unit_contribution =
    insured_n * actual_cert_rate * actual_recep_rate * (actual_unit_benefit - planned_unit_benefit);
  const interaction = total_gap - cert_contribution - recep_contribution - unit_contribution;

  const abs_gap = Math.abs(total_gap);
  const pct = (v: number) => Math.round((v / abs_gap) * 10000) / 100;

  return {
    total_gap: Math.round(total_gap * 100) / 100,
    cert_contribution: Math.round(cert_contribution * 100) / 100,
    recep_contribution: Math.round(recep_contribution * 100) / 100,
    unit_contribution: Math.round(unit_contribution * 100) / 100,
    interaction: Math.round(interaction * 100) / 100,
    cert_pct: pct(cert_contribution),
    recep_pct: pct(recep_contribution),
    unit_pct: pct(unit_contribution),
    interaction_pct: pct(interaction),
  };
}
