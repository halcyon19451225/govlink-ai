export const ARTIFACT_TYPES = {
  gap_analysis: {
    gap_table: "gap_table",
    swot_matrix: "swot_matrix",
    priority_gap_list: "priority_gap_list",
  },
  issue_hypothesis: {
    hypothesis_sheet: "hypothesis_sheet",
    logic_tree: "logic_tree",
  },
  logic_model: {
    // バージョン番号は呼び出し側で `logic_model_v${version}` として組み立てる
    prefix: "logic_model_v",
  },
  program_evaluation: {
    process_eval: "process_eval",
    initial_outcome_eval: "initial_outcome_eval",
    intermediate_outcome_eval: "intermediate_outcome_eval",
    efficiency_eval: "efficiency_eval",  // 第5階層: 効率性評価（案B-2統合）
  },
  cost_efficiency: {
    ex_ante: "cost_ratio_calc_ex_ante",
    ex_post: "cost_ratio_calc_ex_post",
  },
  service_volume: {
    deviation_analysis: "deviation_analysis",
  },
  self_evaluation: {
    self_eval_sheet: "self_eval_sheet",
  },
} as const;

export type ArtifactType =
  | "gap_table"
  | "swot_matrix"
  | "priority_gap_list"
  | "hypothesis_sheet"
  | "logic_tree"
  | `logic_model_v${number}`
  | "process_eval"
  | "initial_outcome_eval"
  | "intermediate_outcome_eval"
  | "efficiency_eval"
  | "cost_ratio_calc_ex_ante"
  | "cost_ratio_calc_ex_post"
  | "deviation_analysis"
  | "self_eval_sheet";
