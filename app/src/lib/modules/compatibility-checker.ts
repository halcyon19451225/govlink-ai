import { CAUSAL_EDGES, INCOMPATIBLE_PAIRS } from "./causal-graph";

export interface CompatibilityResult {
  ok: boolean;
  missingDeps: Array<{ module: string; requires: string }>;
  incompatiblePairs: Array<[string, string]>;
}

// 選択中のモジュール一覧に対して依存・非互換チェックを実行
export function checkModuleCompatibility(selectedIds: string[]): CompatibilityResult {
  const selected = new Set(selectedIds);

  const missingDeps: CompatibilityResult["missingDeps"] = [];
  for (const [from, to] of CAUSAL_EDGES) {
    if (selected.has(to) && !selected.has(from)) {
      missingDeps.push({ module: to, requires: from });
    }
  }

  const incompatiblePairs: Array<[string, string]> = [];
  for (const [a, b] of INCOMPATIBLE_PAIRS) {
    if (selected.has(a) && selected.has(b)) {
      incompatiblePairs.push([a, b]);
    }
  }

  return {
    ok: missingDeps.length === 0 && incompatiblePairs.length === 0,
    missingDeps,
    incompatiblePairs,
  };
}
