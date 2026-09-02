/**
 * 評価報告書の行の型と表示ヘルパ（CA2-5・純粋関数）。
 *
 * reportData.ts（DBを読む）と reportDocx.ts（docxを描く）の両方から使う。
 * docx 側が DB モジュールを引きずらないよう、ここに分けてある。
 */

import { INDICATOR_BY_NO } from "@/lib/measure/indicators";
import type { IndicatorSnapshotItem } from "@/lib/evaluation/indicatorSnapshot";

export interface ReportKeyValue {
  label: string;
  value: string;
}

export interface ReportPathRow {
  section: string;
  question: string;
  answer: string;
  note: string;
  overridden: string;
}

export interface ReportDelegationRow {
  origin: string;
  title: string;
  detail: string;
  root_cause: string;
  status: string;
}

export interface ReportWorkRollupRow {
  code: string;
  title: string;
  fiscal_year: string;
  status: string;
  result: string;
}

export interface ReportCostRow {
  fiscal_year: string;
  total: string;
  funding: string;
  note: string;
}

export interface ReportBenchmarkRow {
  indicator: string;
  comparator: string;
  value: string;
  own: string;
  fiscal_year: string;
  source: string;
}

export interface ReportActivityRow {
  title: string;
  planned: string;
  completed: string;
}

/** 様式F7-0 ③ 成果の要約（ベースライン・X・比較の段は 060 以降の入力を待つ） */
export interface ReportOutcomeSummary {
  indicator: string;
  baseline: string;
  target: string;
  result: string;
  /** ベースライン＝施策がなかった場合の自然体推計 */
  natural_baseline: string;
  /** X ＝ 実績 − ベースライン（目標との差ではない） */
  x: string;
  /** 比較の段 A〜D */
  comparison_grade: string;
}

/** 様式F7-0 ④ 初期アウトカムの年次履歴（因果判断の唯一の根拠） */
export interface ReportAnnualHistoryRow {
  fiscal_year: string;
  work: string;
  indicator: string;
  result: string;
  achieved: string;
  /** その年次評価で記録された「実行／論理」の切り分け */
  cause_type: string;
}

/** 様式F7-0 ⑥ 財政効果率 */
export interface ReportFiscalEffect {
  /** 寄与経路（分野ごとに定義） */
  pathways: string;
  /** 財政効果（計画期間累計） */
  effect: string;
  /** 事業費C（同期間累計・人件費按分込み） */
  cost: string;
  /** 財政効果率 */
  rate: string;
  /** 判定（J・K・保留・適用除外） */
  mark: string;
  formula: string;
  note: string;
}

/** 様式F7-0 ⑦ 処遇 */
export interface ReportTreatment {
  route: string;
  standard: string;
  decided: string;
  /** 標準処遇と異なる場合の理由書（様式H4）の有無 */
  rationale: string;
}

/** 報告書の判定（様式F7-0 ②）。保留のときは pattern が null */
export interface ReportJudgment {
  /** 記号列（例: A→E→K）。保留なら分かるところまで */
  path: string;
  report_no: number | null;
  report_title: string;
  state: string;
  route: string;
  standard_treatment: string;
  issue_class: string;
  approach: string;
  /** 判定に足りていない問い（保留の理由） */
  missing: string[];
  pending: boolean;
}

/** 指標行の表示用（報告書・画面で共用） */
export function indicatorRowText(i: IndicatorSnapshotItem): string[] {
  const unit = i.unit ?? "";
  const cond =
    i.achievement_condition === "lte" ? "以下" : i.achievement_condition === "eq" ? "同じ" : "以上";
  return [
    `No.${i.category_no}`,
    `${INDICATOR_BY_NO[i.category_no]?.name ?? ""}\n${i.label}`,
    i.baseline_value != null ? `${i.baseline_value}${unit}` : "—",
    i.target_value != null ? `${i.target_value}${unit}（${cond}）` : "—",
    i.result_value != null
      ? `${i.result_value}${unit}`
      : i.result_text
        ? i.result_text
        : "—",
    i.achieved == null ? "—" : i.achieved ? "達成" : "未達",
    i.result_source === "auto_tasks"
      ? "タスク完了実績（自動集計）"
      : i.result_source === "report_request"
        ? "実績報告依頼"
        : i.result_source === "import"
          ? "取り込み"
          : i.result_source === "manual"
            ? "手入力"
            : "—",
  ];
}
