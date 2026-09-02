/**
 * 評価予定 — 「いつ評価を回すか」を指標の評価時点から決める（CA2-4）。
 *
 * 介護保険事業計画に固有の「2、3年目の上旬」を実装に持たない、というのが
 * 057 からの方針（claude/coe-measure-dataset.md §4）。評価時点は指標ごとに
 *   - 相対（第N年度＋上期／下期／年度末）
 *   - 絶対日付
 * のどちらでも置け、絶対日付があればそちらが優先される。
 * C評価側はこの表だけを読み、自前で年次を決めない。
 *
 * このファイルは純粋関数（DBに触らない）。呼び出し側が行を渡す。
 */

export type RelativePeriod = "first" | "second" | "end";

export interface CheckpointInput {
  id: string;
  measure_indicator_id: string;
  label: string;
  relative_year: number | null;
  relative_period: string | null;
  absolute_date: string | null; // YYYY-MM-DD
  evaluation_type: string | null;
}

/**
 * 評価時点の期日を1つのISO日付に解決する。
 * 絶対日付が優先。相対のときは計画開始年度＋(N-1)年 の
 *   first  … 上期末（9月30日）
 *   second … 下期末（12月31日）
 *   end    … 年度末（翌年3月31日）
 * を期日とみなす。相対年次が無ければ null（期日未定）。
 */
export function resolveDueDate(
  cp: Pick<CheckpointInput, "relative_year" | "relative_period" | "absolute_date">,
  planStartYear: number,
): string | null {
  if (cp.absolute_date) return cp.absolute_date;
  if (cp.relative_year == null) return null;
  const year = planStartYear + (cp.relative_year - 1);
  switch (cp.relative_period) {
    case "first":
      return `${year}-09-30`;
    case "second":
      return `${year}-12-31`;
    case "end":
    default:
      return `${year + 1}-03-31`;
  }
}

/** 期日が属する年度（4月始まり）。評価レコードの fiscal_year と突き合わせる */
export function fiscalYearOfDate(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

export type DueState = "due" | "upcoming" | "done";

export interface DueItem {
  checkpoint_id: string;
  indicator_id: string;
  category_no: number;
  indicator_label: string;
  /** 取組レベルなら取組ID、主要施策レベルなら null */
  measure_work_id: string | null;
  measure_design_id: string;
  label: string;
  due_date: string | null;
  fiscal_year: number | null;
  evaluation_type: string | null;
  state: DueState;
  /** done のとき、その評価のID */
  evaluation_id?: string;
}

export interface DueSourceIndicator {
  id: string;
  category_no: number;
  label: string;
  measure_work_id: string | null;
  measure_design_id: string;
  checkpoints: CheckpointInput[];
}

export interface DueSourceEvaluation {
  id: string;
  measure_work_id: string | null;
  measure_design_id: string | null;
  fiscal_year: number | null;
  evaluation_tier: string;
}

/**
 * 評価予定の一覧を組み立てる。
 *
 * 「済み」の判定は、同じ単位（取組 or 主要施策）×同じ年度の評価があるか。
 * 取組の評価は outcome_initial、主要施策は outcome_intermediate で数える
 * （tier は図6v2 / 図7v2 が保存する値）。
 */
export function buildDueList(
  indicators: DueSourceIndicator[],
  evaluations: DueSourceEvaluation[],
  planStartYear: number,
  today: string,
): DueItem[] {
  const out: DueItem[] = [];
  for (const ind of indicators) {
    for (const cp of ind.checkpoints) {
      const due = resolveDueDate(cp, planStartYear);
      const fy = due ? fiscalYearOfDate(due) : null;
      const isWork = ind.measure_work_id != null;
      const tier = isWork ? "outcome_initial" : "outcome_intermediate";
      const done = evaluations.find(
        (e) =>
          e.evaluation_tier === tier &&
          e.fiscal_year === fy &&
          (isWork
            ? e.measure_work_id === ind.measure_work_id
            : e.measure_work_id == null && e.measure_design_id === ind.measure_design_id),
      );
      const state: DueState = done ? "done" : due && due <= today ? "due" : "upcoming";
      out.push({
        checkpoint_id: cp.id,
        indicator_id: ind.id,
        category_no: ind.category_no,
        indicator_label: ind.label,
        measure_work_id: ind.measure_work_id,
        measure_design_id: ind.measure_design_id,
        label: cp.label,
        due_date: due,
        fiscal_year: fy,
        evaluation_type: cp.evaluation_type,
        state,
        ...(done ? { evaluation_id: done.id } : {}),
      });
    }
  }
  // 期日の近い順。期日未定は末尾
  return out.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });
}

/** 画面の要約（期日到来・未評価が何件あるか） */
export function dueSummary(items: DueItem[]): { due: number; upcoming: number; done: number } {
  return {
    due: items.filter((i) => i.state === "due").length,
    upcoming: items.filter((i) => i.state === "upcoming").length,
    done: items.filter((i) => i.state === "done").length,
  };
}
