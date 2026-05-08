// モジュール間の因果関係グラフ
// plan_modules.depends_on を元にした有向グラフ定義

export const CAUSAL_EDGES: Array<[from: string, to: string]> = [
  ["dataset_manager",    "gap_analysis"],
  ["gap_analysis",       "issue_hypothesis"],
  ["issue_hypothesis",   "logic_model"],
  ["logic_model",        "program_evaluation"],
  ["program_evaluation", "cost_efficiency"],
  ["program_evaluation", "self_evaluation"],
  ["dataset_manager",    "service_volume"],
];

// 同時有効化できない組み合わせ（片方の選択が他方を排除）
export const INCOMPATIBLE_PAIRS: Array<[string, string]> = [];

// モジュールIDから依存チェーンをトポロジカル順で返す
export function getDependencyChain(moduleId: string): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();

  function walk(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const [from, to] of CAUSAL_EDGES) {
      if (to === id) walk(from);
    }
    chain.push(id);
  }

  walk(moduleId);
  return chain.filter((id) => id !== moduleId);
}
