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
