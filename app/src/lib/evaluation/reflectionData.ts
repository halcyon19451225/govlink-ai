import "server-only";

/**
 * 収束工程（Act）の様式の材料 — 様式H1 評価総括表（claude/coe-eval-reflect-forms.md）。
 *
 * 原則:
 *   - **表はAIに書かせず、実データから組む**。ここは DB を読んで行を組むだけで、判定をやり直さない
 *   - H1 は全様式の最上流（G1・G4①〜⑦・共通ヘッダの転記元）。1行＝1指標セット
 *     （アウトプット No.6 → 初期 No.7 → 中間 No.8 の3点1組。取組ごとに1セット）
 *   - 判定（記号列→報告書No.）は主要施策評価（fig7e1）が program_evaluations に保存した値を写す。
 *     承認済み > レビュー中 > 下書き の順で最新を採る
 *   - 事業費・財政効果率は施策単位の値（セットへの按分はしない。「施策計」と明示）
 */

import { query } from "@/lib/db";
import {
  EXEMPTION_META,
  ROUTE_META,
  REPORT_PATTERNS,
  type JudgmentExemption,
  type ReflectRoute,
  type ReportNo,
  type StoredFiscalEffect,
  type StoredJudgment,
} from "@/lib/evaluation/judgment";
import { isAchieved } from "@/lib/stats/achievement";
import { withUnit } from "@/lib/evaluation/reportRows";

/** H1-3/4/5 の1セル: 指標名：目標→実績　達否（○×－） */
export interface H1IndicatorCell {
  indicator_id: string;
  label: string;
  target: string;
  result: string;
  baseline: string;
  /** ○=達成 ×=未達 －=判定不能（実績か目標が無い） */
  achieved: "○" | "×" | "－";
  /** 取組をまたいで共有されている（課題Ⅳとして解消対象） */
  shared: boolean;
}

/** H1-6 判定（主要施策評価から写す） */
export interface H1Judgment {
  evaluation_id: string;
  status: string;
  fiscal_year: number | null;
  path: string;
  report_no: ReportNo | null;
  report_title: string;
  route: ReflectRoute | null;
  standard_treatment: string | null;
  decided_treatment: string | null;
  rationale_required: boolean;
  comparison_grade: string | null;
  frozen: boolean;
}

export interface H1Row {
  set_no: number;
  measure_id: string;
  measure_title: string;
  work_id: string | null;
  work_code: string | null;
  work_title: string | null;
  output: H1IndicatorCell | null;
  initial: H1IndicatorCell | null;
  intermediate: H1IndicatorCell | null;
  /** 主たる中間アウトカム（◎） */
  primary: boolean;
  judgment: H1Judgment | null;
  /** 施策計（按分なし） */
  cost_total: number | null;
  fiscal_rate: number | null;
  fiscal_mark: "J" | "K" | null;
  comparison_grade: string | null;
  exemption: JudgmentExemption | null;
  /** H1-9 自動の注記（適用除外・判定保留・データなし・共有指標） */
  auto_notes: string[];
}

/** 施策単位の集約（集約ルール: 主たる中間アウトカム／最重ルート B>D>C>A） */
export interface H1MeasureSummary {
  measure_id: string;
  measure_title: string;
  sets: number;
  judgment: H1Judgment | null;
  cost_total: number | null;
  fiscal_rate: number | null;
  exemption: JudgmentExemption | null;
}

export interface H1Data {
  project_title: string;
  municipality: string;
  plan_period: string;
  rows: H1Row[];
  measures: H1MeasureSummary[];
  /** 判定が出ている施策数／全施策数 */
  judged_count: number;
  pending_count: number;
}

interface MeasureRow {
  id: string;
  title: string;
  sort_order: number;
  judgment_exemption: JudgmentExemption | null;
}
interface WorkRow {
  id: string;
  measure_design_id: string;
  code: string;
  title: string;
  sort_order: number;
}
interface IndicatorRow {
  id: string;
  measure_design_id: string;
  measure_work_id: string | null;
  category_no: number;
  label: string;
  unit: string | null;
  baseline_value: number | null;
  target_value: number | null;
  achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq";
  sort_order: number;
  result_value: number | null;
  result_text: string | null;
}
interface EvalRow {
  id: string;
  measure_design_id: string;
  status: string;
  fiscal_year: number | null;
  approved_snapshot_at: string | null;
  judgment: StoredJudgment | null;
  judgment_path: string | null;
  report_no: number | null;
  route: string | null;
  standard_treatment: string | null;
  decided_treatment: string | null;
  rationale_required: boolean;
  comparison_grade: string | null;
  fiscal_effect: StoredFiscalEffect | null;
  created_at: string;
}

const STATUS_RANK: Record<string, number> = { approved: 3, in_review: 2, draft: 1 };

function cellOf(ind: IndicatorRow | undefined, shared: boolean): H1IndicatorCell | null {
  if (!ind) return null;
  const achieved =
    ind.result_value != null && ind.target_value != null
      ? isAchieved(ind.result_value, ind.target_value, ind.achievement_condition)
        ? "○"
        : "×"
      : "－";
  return {
    indicator_id: ind.id,
    label: ind.label,
    target: withUnit(ind.target_value, ind.unit),
    result: ind.result_value != null ? withUnit(ind.result_value, ind.unit) : (ind.result_text ?? "—"),
    baseline: withUnit(ind.baseline_value, ind.unit),
    achieved,
    shared,
  };
}

function judgmentOf(e: EvalRow | undefined): H1Judgment | null {
  if (!e) return null;
  const no = (e.report_no ?? null) as ReportNo | null;
  return {
    evaluation_id: e.id,
    status: e.status,
    fiscal_year: e.fiscal_year,
    path: e.judgment_path ?? "—",
    report_no: no,
    report_title: no ? REPORT_PATTERNS[no].title : e.judgment ? "判定保留" : "－（データなし）",
    route: (e.route ?? null) as ReflectRoute | null,
    standard_treatment: e.standard_treatment,
    decided_treatment: e.decided_treatment,
    rationale_required: Boolean(e.rationale_required),
    comparison_grade: e.comparison_grade,
    frozen: Boolean(e.approved_snapshot_at),
  };
}

export async function buildH1Data(projectId: string): Promise<H1Data | null> {
  const project = await query<{
    title: string;
    municipality: string;
    plan_start_date: string | null;
    plan_end_date: string | null;
  }>(
    `SELECT p.title, m.name AS municipality,
            to_char(p.plan_start_date, 'YYYY-MM-DD') AS plan_start_date,
            to_char(p.plan_end_date, 'YYYY-MM-DD') AS plan_end_date
       FROM projects p JOIN municipalities m ON m.id = p.municipality_id
      WHERE p.id = $1`,
    [projectId],
  );
  const pj = project[0];
  if (!pj) return null;

  const [measures, works, indicators, evals, costs] = await Promise.all([
    query<MeasureRow>(
      `SELECT id, title, sort_order, judgment_exemption
         FROM measure_designs WHERE project_id = $1
        ORDER BY sort_order, created_at`,
      [projectId],
    ),
    query<WorkRow>(
      `SELECT id, measure_design_id, code, title, sort_order
         FROM measure_works WHERE project_id = $1 AND retired = false
        ORDER BY sort_order, code`,
      [projectId],
    ),
    // 指標と最新実績（履歴の末尾: 測定日→登録順）
    query<IndicatorRow>(
      `SELECT i.id, i.measure_design_id, i.measure_work_id, i.category_no, i.label, i.unit,
              i.baseline_value::float AS baseline_value, i.target_value::float AS target_value,
              i.achievement_condition, i.sort_order,
              r.value::float AS result_value, r.value_text AS result_text
         FROM measure_indicators i
         LEFT JOIN LATERAL (
           SELECT value, value_text FROM measure_indicator_results x
            WHERE x.measure_indicator_id = i.id
            ORDER BY COALESCE(x.measured_on, x.created_at::date) DESC, x.created_at DESC
            LIMIT 1
         ) r ON true
        WHERE i.project_id = $1 AND i.category_no IN (6, 7, 8)
        ORDER BY i.sort_order, i.category_no`,
      [projectId],
    ),
    query<EvalRow>(
      `SELECT id, measure_design_id, status, fiscal_year,
              approved_snapshot_at::text AS approved_snapshot_at,
              judgment, judgment_path, report_no, route, standard_treatment, decided_treatment,
              rationale_required, comparison_grade, fiscal_effect, created_at::text AS created_at
         FROM program_evaluations
        WHERE project_id = $1 AND measure_work_id IS NULL
          AND evaluation_tier = 'outcome_intermediate' AND measure_design_id IS NOT NULL
        ORDER BY created_at DESC`,
      [projectId],
    ),
    query<{ measure_design_id: string; total: number | null }>(
      `SELECT measure_design_id, sum(total_amount)::float AS total
         FROM measure_cost_years GROUP BY measure_design_id`,
      [],
    ).then((rows) => rows),
  ]);

  // 施策ごとの最新評価（承認済み > レビュー中 > 下書き、同順位なら新しい方）
  const latestEval = new Map<string, EvalRow>();
  for (const e of evals) {
    const cur = latestEval.get(e.measure_design_id);
    if (!cur || (STATUS_RANK[e.status] ?? 0) > (STATUS_RANK[cur.status] ?? 0)) latestEval.set(e.measure_design_id, e);
  }
  const costOf = new Map(costs.map((c) => [c.measure_design_id, c.total]));

  const rows: H1Row[] = [];
  const summaries: H1MeasureSummary[] = [];
  let setNo = 0;
  for (const m of measures) {
    const mWorks = works.filter((w) => w.measure_design_id === m.id);
    const mInds = indicators.filter((i) => i.measure_design_id === m.id);
    const mids = mInds.filter((i) => i.category_no === 8 && !i.measure_work_id);
    const primaryMid = mids[0];
    const e = latestEval.get(m.id);
    const j = judgmentOf(e);
    const fe = e?.fiscal_effect ?? null;
    const costTotal = fe?.cost_total ?? costOf.get(m.id) ?? null;

    // 初期アウトカムの共有（複数取組で同じ指標を使っている＝課題Ⅳ）
    const initialByWork = new Map<string, IndicatorRow | undefined>();
    for (const w of mWorks) initialByWork.set(w.id, mInds.find((i) => i.category_no === 7 && i.measure_work_id === w.id));
    const measureLevelInitial = mInds.find((i) => i.category_no === 7 && !i.measure_work_id);

    const baseNotes: string[] = [];
    if (m.judgment_exemption) baseNotes.push(`※適用除外（${EXEMPTION_META[m.judgment_exemption.kind].name}）: ${m.judgment_exemption.reason}`);
    if (!e) baseNotes.push("※主要施策評価が未実施（判定なし）");
    else if (e.judgment && !e.report_no) baseNotes.push(`※判定保留（記号列 ${e.judgment_path ?? "?"}）— 処遇は行わず測定課題Ⅳとして記録`);
    else if (!e.judgment) baseNotes.push("※旧フロー（図E1以前）の評価のため判定なし。fig7e1 で再評価すると判定が入る");
    if (mids.length === 0) baseNotes.push("※中間アウトカム指標（No.8）が未設定");

    const units = mWorks.length > 0 ? mWorks : [null];
    for (const w of units) {
      setNo++;
      const output = w ? mInds.find((i) => i.category_no === 6 && i.measure_work_id === w.id) : mInds.find((i) => i.category_no === 6 && !i.measure_work_id);
      const initial = w ? (initialByWork.get(w.id) ?? measureLevelInitial) : measureLevelInitial;
      const sharedInitial = Boolean(w && !initialByWork.get(w.id) && measureLevelInitial && mWorks.length > 1);
      const notes = [...baseNotes];
      if (sharedInitial) notes.push("※初期アウトカムが取組間で共有されている（取組固有にする＝課題Ⅳ）");
      if (w && !initial) notes.push("※初期アウトカム指標（No.7）が未設定");
      rows.push({
        set_no: setNo,
        measure_id: m.id,
        measure_title: m.title,
        work_id: w?.id ?? null,
        work_code: w?.code ?? null,
        work_title: w?.title ?? null,
        output: cellOf(output, false),
        initial: cellOf(initial, sharedInitial),
        intermediate: cellOf(primaryMid, false),
        primary: Boolean(primaryMid),
        judgment: j,
        cost_total: costTotal,
        fiscal_rate: fe?.rate ?? null,
        fiscal_mark: fe?.mark ?? null,
        comparison_grade: e?.comparison_grade ?? null,
        exemption: m.judgment_exemption,
        auto_notes: notes,
      });
    }
    summaries.push({
      measure_id: m.id,
      measure_title: m.title,
      sets: units.length,
      judgment: j,
      cost_total: costTotal,
      fiscal_rate: fe?.rate ?? null,
      exemption: m.judgment_exemption,
    });
  }

  const fy = (d: string | null) => (d ? `${d.slice(0, 4)}年度` : "—");
  return {
    project_title: pj.title,
    municipality: pj.municipality,
    plan_period: `${fy(pj.plan_start_date)}〜${fy(pj.plan_end_date)}`,
    rows,
    measures: summaries,
    judged_count: summaries.filter((s) => s.judgment?.report_no != null).length,
    pending_count: summaries.filter((s) => s.judgment && s.judgment.report_no == null).length,
  };
}

/** H1 の表の行（docx・画面で共用。列＝様式H1-1〜H1-9） */
export const H1_HEADERS = [
  "セットNo.",
  "施策No.・取組",
  "アウトプット（No.6）",
  "初期アウトカム（No.7）",
  "中間アウトカム（No.8）",
  "評価過程→報告書No.",
  "事業費／財政効果率（施策計）",
  "比較の段",
  "訂正・整理注記",
] as const;

function cellText(c: H1IndicatorCell | null, withBaseline: boolean): string {
  if (!c) return "－（未設定）";
  const base = withBaseline ? `／基準値 ${c.baseline}` : "";
  return `${c.label}: ${c.target}→${c.result}${base}　${c.achieved}${c.shared ? "（共有）" : ""}`;
}

export function h1RowText(r: H1Row): string[] {
  const j = r.judgment;
  const jt = !j
    ? "－（データなし）"
    : j.report_no
      ? `${j.path} → No.${j.report_no} ${j.report_title}${j.route ? `（ルート${j.route} ${ROUTE_META[j.route].name}）` : ""}${j.frozen ? "" : "【暫定】"}`
      : `${j.path} → 判定保留${j.frozen ? "" : "【暫定】"}`;
  return [
    String(r.set_no),
    `${r.measure_title}${r.work_code ? `\n${r.work_code} ${r.work_title ?? ""}` : ""}`,
    cellText(r.output, false),
    cellText(r.initial, false),
    `${r.primary ? "◎ " : ""}${cellText(r.intermediate, true)}`,
    jt,
    `${r.cost_total != null ? `¥${r.cost_total.toLocaleString()}` : "—"}／${r.fiscal_rate != null ? `${r.fiscal_rate}%（${r.fiscal_mark}）` : "算定不能"}`,
    r.comparison_grade ?? "—",
    r.auto_notes.join("\n"),
  ];
}
