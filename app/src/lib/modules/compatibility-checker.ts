import { CAUSAL_EDGES, INCOMPATIBLE_RULES, type IncompatibilityRule } from "./causal-graph";

export interface MissingDep {
  module: string;
  requires: string;
}

export interface IncompatWarning {
  moduleA: string;
  moduleB: string;
  isBlocking: boolean;
  warningMessage: string;
  rule: IncompatibilityRule;
}

export interface CompatibilityResult {
  ok: boolean;
  /** 依存モジュールが未選択 */
  missingDeps: MissingDep[];
  /** 非互換・中間モジュール欠落の警告 */
  incompatWarnings: IncompatWarning[];
  /** 後方互換: incompatWarnings から derived */
  incompatiblePairs: Array<[string, string]>;
}

/**
 * 選択中のモジュール一覧に対して依存・非互換チェックを実行する。
 * causal-graph.ts を唯一の正本として使用。
 */
export function checkModuleCompatibility(selectedIds: string[]): CompatibilityResult {
  const selected = new Set(selectedIds);

  // 依存欠落チェック
  const missingDeps: MissingDep[] = [];
  for (const [from, to] of CAUSAL_EDGES) {
    if (selected.has(to) && !selected.has(from)) {
      missingDeps.push({ module: to, requires: from });
    }
  }

  // 非互換チェック（選択中の組み合わせに対してルールを適用）
  const incompatWarnings: IncompatWarning[] = [];
  for (const rule of INCOMPATIBLE_RULES) {
    if (selected.has(rule.moduleA) && selected.has(rule.moduleB)) {
      // missing_intermediary の場合、中間モジュールがすべて選択されていれば警告不要
      if (rule.type === "missing_intermediary") {
        const allIntermediariesPresent = rule.requiredIntermediaries.every((m) =>
          selected.has(m),
        );
        if (allIntermediariesPresent) continue;
      }
      incompatWarnings.push({
        moduleA: rule.moduleA,
        moduleB: rule.moduleB,
        isBlocking: rule.isBlocking,
        warningMessage: rule.warningMessage,
        rule,
      });
    }
  }

  const incompatiblePairs: Array<[string, string]> = incompatWarnings.map(
    (w) => [w.moduleA, w.moduleB],
  );

  const hasBlockingError = incompatWarnings.some((w) => w.isBlocking);

  return {
    ok: missingDeps.length === 0 && !hasBlockingError,
    missingDeps,
    incompatWarnings,
    incompatiblePairs,
  };
}
