export interface DiDData {
  treat_pre: number;
  treat_post: number;
  control_pre: number;
  control_post: number;
}

export interface DiDResult {
  did_estimate: number;
  treat_diff: number;
  control_diff: number;
  interpretation: string;
  calculationSteps: {
    formula: string;
    steps: string[];
  };
}

export function calcDiffInDiff(data: DiDData): DiDResult {
  const treat_diff = data.treat_post - data.treat_pre;
  const control_diff = data.control_post - data.control_pre;
  const did_estimate = treat_diff - control_diff;

  const interpretation =
    did_estimate > 0
      ? `介入効果: +${did_estimate.toFixed(4)}（介入群が対照群を上回る改善）`
      : did_estimate < 0
      ? `介入効果: ${did_estimate.toFixed(4)}（介入群が対照群を下回る変化）`
      : `介入効果: なし（DiD推定量 = 0）`;

  return {
    did_estimate,
    treat_diff,
    control_diff,
    interpretation,
    calculationSteps: {
      formula: "DiD = (treat_post - treat_pre) - (control_post - control_pre)",
      steps: [
        `介入群の変化: treat_post - treat_pre = ${data.treat_post} - ${data.treat_pre} = ${treat_diff}`,
        `対照群の変化: control_post - control_pre = ${data.control_post} - ${data.control_pre} = ${control_diff}`,
        `DiD推定量: ${treat_diff} - ${control_diff} = ${did_estimate}`,
      ],
    },
  };
}
