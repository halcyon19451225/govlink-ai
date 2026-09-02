/**
 * 指標の実績値とベンチマーク（migration 058）— 型と純粋関数。
 *
 * 実績は履歴で持つ（測定のたびに1行・上書きしない）。画面と評価が見るのは
 * 「最新の測定」だが、報告書と凍結（indicator_snapshot）は履歴に依拠する。
 * auto_computed は自動集計値の印で、手で直すと外す（auto_filled と同じ規約）。
 */

export type ResultSource = "manual" | "auto_tasks" | "report_request" | "import";

export const RESULT_SOURCES: readonly ResultSource[] = [
  "manual",
  "auto_tasks",
  "report_request",
  "import",
] as const;

export const RESULT_SOURCE_LABEL: Record<ResultSource, string> = {
  manual: "手入力",
  auto_tasks: "タスク完了実績から自動集計",
  report_request: "実績報告依頼",
  import: "取り込み",
};

export interface IndicatorResultRow {
  id: string;
  measure_indicator_id: string;
  checkpoint_id: string | null;
  fiscal_year: number | null;
  measured_on: string | null; // YYYY-MM-DD
  value: number | null;
  value_text: string | null;
  note: string | null;
  source: ResultSource;
  auto_computed: boolean;
  created_at: string;
}

/** ベンチマーク（図7 工程3-2）。出典必須 */
export interface IndicatorBenchmarkRow {
  id: string;
  measure_indicator_id: string;
  comparator: string;
  value: number;
  fiscal_year: number | null;
  source_name: string;
  source_url: string | null;
  note: string | null;
}

/** 比較先の初期候補（自由記述でも追加できる） */
export const BENCHMARK_COMPARATORS: readonly string[] = [
  "全国平均",
  "県平均",
  "人口同規模平均",
] as const;

/**
 * 最新の測定を選ぶ。measured_on があればそれを優先し、無ければ登録順。
 * 同日なら後から登録した方（履歴の末尾）。
 */
export function latestResult(rows: IndicatorResultRow[]): IndicatorResultRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const da = a.measured_on ?? a.created_at.slice(0, 10);
    const db = b.measured_on ?? b.created_at.slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
  return sorted[sorted.length - 1] ?? null;
}

/** 年度ごとの最新（年度が入っている行のみ対象） */
export function latestResultByYear(rows: IndicatorResultRow[]): Map<number, IndicatorResultRow> {
  const byYear = new Map<number, IndicatorResultRow[]>();
  for (const r of rows) {
    if (r.fiscal_year == null) continue;
    const list = byYear.get(r.fiscal_year);
    if (list) list.push(r);
    else byYear.set(r.fiscal_year, [r]);
  }
  const out = new Map<number, IndicatorResultRow>();
  byYear.forEach((list, fy) => {
    const latest = latestResult(list);
    if (latest) out.set(fy, latest);
  });
  return out;
}

/** 実績の表示文字列（数値＋単位、無ければ定性値） */
export function resultDisplay(r: IndicatorResultRow | null, unit: string | null): string {
  if (!r) return "—";
  if (r.value != null) return unit ? `${r.value}${unit}` : String(r.value);
  if (r.value_text) return r.value_text;
  return "—";
}
