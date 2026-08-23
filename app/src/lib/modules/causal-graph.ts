// モジュール間の因果関係グラフ（正本）
// plan_modules.depends_on と module_incompatibility_rules は
// このファイルから scripts/sync-causal-graph.ts で生成・同期する。

export const CAUSAL_EDGES: Array<[from: string, to: string]> = [
  ["dataset_manager",    "gap_analysis"],
  ["gap_analysis",       "issue_hypothesis"],
  // 施策構築（EBPM・036〜）: 真因 → エビデンス/実験設計付きの施策 → ロジックモデル。
  // issue_hypothesis → logic_model の直行辺も互換のため残す
  // （施策構築を経ずにロジックモデルへ進む既存プロジェクトを壊さない）。
  ["issue_hypothesis",   "measure_design"],
  ["measure_design",     "logic_model"],
  ["issue_hypothesis",   "logic_model"],
  ["logic_model",        "program_evaluation"],
  ["program_evaluation", "cost_efficiency"],
  ["program_evaluation", "self_evaluation"],
  ["dataset_manager",    "service_volume"],
];

// ─── 非互換ルール定義 ─────────────────────────────────────────────────────────

export type IncompatibilityType =
  | "missing_intermediary"
  | "no_causal_path"
  | "plan_type_mismatch"
  | "circular";

export interface IncompatibilityRule {
  moduleA: string;
  moduleB: string;
  type: IncompatibilityType;
  /** true の場合は保存をブロックする */
  isBlocking: boolean;
  warningMessage: string;
  requiredIntermediaries: string[];
}

/**
 * モジュール非互換ルール（正本）。
 * DB の module_incompatibility_rules は sync-causal-graph.ts でここから再生成する。
 */
export const INCOMPATIBLE_RULES: IncompatibilityRule[] = [
  {
    moduleA: "gap_analysis",
    moduleB: "program_evaluation",
    type: "missing_intermediary",
    isBlocking: false,
    warningMessage:
      "地域分析・ギャップ分析の成果物からプログラム評価を直接実施することはできません。ロジックモデルモジュールで評価対象となる成果指標・取組を定義してください。",
    requiredIntermediaries: ["logic_model"],
  },
  {
    moduleA: "gap_analysis",
    moduleB: "cost_efficiency",
    type: "missing_intermediary",
    isBlocking: false,
    warningMessage:
      "ギャップ分析の結果からコストと効率性の評価を直接実施することはできません。課題仮説設定・ロジックモデルを通じて投入金額と施策効果を定義してください。",
    requiredIntermediaries: ["issue_hypothesis", "logic_model"],
  },
  {
    moduleA: "gap_analysis",
    moduleB: "self_evaluation",
    type: "missing_intermediary",
    isBlocking: false,
    warningMessage:
      "ギャップ分析から直接自己評価シートを作成することはできません。ロジックモデルモジュールで具体的な取組と目標を定義してください。",
    requiredIntermediaries: ["logic_model"],
  },
  {
    moduleA: "issue_hypothesis",
    moduleB: "program_evaluation",
    type: "missing_intermediary",
    isBlocking: false,
    warningMessage:
      "課題仮説設定の成果物からプログラム評価を直接実施することはできません。ロジックモデルモジュールで取組・成果指標を設計してください。",
    requiredIntermediaries: ["logic_model"],
  },
  {
    moduleA: "issue_hypothesis",
    moduleB: "cost_efficiency",
    type: "missing_intermediary",
    isBlocking: false,
    warningMessage:
      "課題仮説からコストと効率性の評価を直接実施することはできません。ロジックモデルで投入量と期待される成果（3指標への効果）を定義してください。",
    requiredIntermediaries: ["logic_model"],
  },
  {
    moduleA: "cost_efficiency",
    moduleB: "service_volume",
    type: "no_causal_path",
    isBlocking: false,
    warningMessage:
      "コストと効率性の評価とサービス見込量管理は並列した評価活動であり、直接の因果関係はありません。",
    requiredIntermediaries: [],
  },
  {
    moduleA: "cost_efficiency",
    moduleB: "self_evaluation",
    type: "no_causal_path",
    isBlocking: false,
    warningMessage:
      "コストと効率性の評価と自己評価シートは並列した評価活動であり、直接の因果関係はありません。",
    requiredIntermediaries: [],
  },
  {
    moduleA: "service_volume",
    moduleB: "self_evaluation",
    type: "no_causal_path",
    isBlocking: false,
    warningMessage:
      "サービス見込量管理と自己評価シートは並列した評価活動であり、直接の因果関係はありません。",
    requiredIntermediaries: [],
  },
];

/**
 * 後方互換: [moduleA, moduleB] ペアの配列。
 * compatibility-checker.ts の既存 API と互換を保つために維持する。
 */
export const INCOMPATIBLE_PAIRS: Array<[string, string]> = INCOMPATIBLE_RULES.map(
  (r) => [r.moduleA, r.moduleB],
);

// ─── 依存チェーン計算 ─────────────────────────────────────────────────────────

/** モジュールIDの直接上流（depends_on）を返す */
export function getDirectDependencies(moduleId: string): string[] {
  return CAUSAL_EDGES.filter(([, to]) => to === moduleId).map(([from]) => from);
}

/** 全モジュールの depends_on マップを返す（sync-causal-graph.ts で使用） */
export function buildDependsOnMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [from, to] of CAUSAL_EDGES) {
    if (!map[to]) map[to] = [];
    map[to]!.push(from);
    if (!map[from]) map[from] = [];
  }
  return map;
}

/** モジュールIDから依存チェーンをトポロジカル順で返す */
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
