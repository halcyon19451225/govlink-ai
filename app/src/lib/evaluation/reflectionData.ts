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
  INQUIRY_ITEMS,
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
import {
  ADOPTION_LABEL,
  type Adoption,
  type DeferredReasonKind,
  type DeferredStatus,
  type ReflectKind,
} from "@/lib/evaluation/reflectionTypes";

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

// ═══════════════════════════════════════════════════════════════
// G1 評価・計画対応表 / G2 反映状況報告書 / G4 諮問事項整理書 / H3 未反映事項台帳 — migration 061
// ═══════════════════════════════════════════════════════════════

// 語彙とラベルはクライアントでも使うので reflectionTypes.ts に置く（server-only を持ち込まない）
export {
  ADOPTION_LABEL,
  DEFERRED_REASON_LABEL,
  DEFERRED_STATUS_LABEL,
  REFLECT_KIND_LABEL,
  type Adoption,
  type DeferredReasonKind,
  type DeferredStatus,
  type ReflectKind,
} from "@/lib/evaluation/reflectionTypes";

export interface DecisionHistoryItem {
  at: string;
  by: string | null;
  stage: "draft" | "council" | "reply";
  decided_treatment: string | null;
  reason: string | null;
}

/** plan_reflections の手入力欄（061） */
export interface ReflectionFields {
  id: string | null;
  decision_history: DecisionHistoryItem[];
  reflect_kind: ReflectKind | null;
  reflect_measure_id: string | null;
  reflect_location: string | null;
  reflect_reason: string | null;
  adoption: Adoption | null;
  inquiry_no: string | null;
  inquiry_date: string | null;
  reply_due: string | null;
  opinions: { a?: string; b?: string; c?: string; d?: string };
  stakeholder_opinions: string | null;
  resource_change: { delta_amount?: number | null; released_amount?: number | null; reallocation_to?: string | null; budget_neutral?: boolean | null; note?: string | null };
  reply_result: string | null;
  reply_date: string | null;
  decided_on: string | null;
  decision_meeting: string | null;
  set_notes: Record<string, string>;
}

/** 報告書1件（＝施策の最新の主要施策評価）＝ G1・G2 の1行、G4 の1葉 */
export interface ReportRow {
  evaluation_id: string;
  measure_id: string;
  measure_title: string;
  owner_department: string | null;
  status: string;
  frozen: boolean;
  fiscal_year: number | null;
  evaluated_at: string | null;
  evaluated_by: string | null;
  /** ヘッダ② */
  path: string;
  report_no: ReportNo | null;
  report_title: string;
  state: string;
  route: ReflectRoute | null;
  route_name: string | null;
  review: string | null;
  /** ヘッダ⑦ */
  standard_treatment: string | null;
  decided_treatment: string | null;
  rationale_required: boolean;
  rationale: string | null;
  /** ヘッダ③ */
  outcome: { label: string; baseline: string; target: string; result: string; natural_baseline: string; x: string } | null;
  comparison_grade: string | null;
  /** ヘッダ⑤⑥ */
  cost_total: number | null;
  fiscal_effect: number | null;
  fiscal_rate: number | null;
  fiscal_mark: "J" | "K" | null;
  pathways: string;
  exemption: JudgmentExemption | null;
  /** G4-⑩ 諮問事項（ルートから定型選択） */
  inquiry_items: string[];
  /** 手入力欄（061） */
  reflection: ReflectionFields;
  /** G2-4 の表示値（adoption が未設定なら 標準どおり=採用／異なる=一部採用 の既定） */
  adoption_effective: Adoption | null;
  /** G1-9 照合（順方向: 反映箇所または明示的な不採用があるか） */
  reconciled: boolean;
  reconcile_note: string;
}

export interface NextMeasureOption {
  id: string;
  title: string;
  cloned_from_measure_id: string | null;
}

export interface DeferredItem {
  id: string;
  reflection_id: string | null;
  evaluation_id: string | null;
  title: string;
  detail: string | null;
  source_ref: string | null;
  reason_kind: DeferredReasonKind;
  reason: string | null;
  review_due: string | null;
  condition: string | null;
  status: DeferredStatus;
  re_proposed_fiscal_year: number | null;
  status_note: string | null;
  created_at: string;
}

export interface ReflectionData {
  project_title: string;
  municipality: string;
  plan_period: string;
  reports: ReportRow[];
  /** 次期計画（このプロジェクトのクローン）があればその施策。G1-8 のリンク先候補 */
  next_project: { id: string; title: string } | null;
  next_measures: NextMeasureOption[];
  /** 逆方向照合: 次期施策のうち、どの報告書からも参照されず、クローン系譜も無いもの */
  unsourced_next_measures: NextMeasureOption[];
  deferred: DeferredItem[];
  /** 照合の要約（停止条件。クローン改修前は warning 止まり） */
  reconciliation: { total: number; reconciled: number; unreconciled: number; unsourced: number; exceptions: number };
}

interface ReflEvalRow {
  id: string; measure_design_id: string; measure_title: string; owner_department: string | null;
  status: string; fiscal_year: number | null; approved_snapshot_at: string | null;
  evaluated_at: string | null; evaluated_by: string | null; created_at: string;
  judgment: StoredJudgment | null; judgment_path: string | null; report_no: number | null; route: string | null;
  standard_treatment: string | null; decided_treatment: string | null; rationale_required: boolean; rationale: string | null;
  comparison_grade: string | null; fiscal_effect: StoredFiscalEffect | null;
  indicator_snapshot: { category_no: number; label: string; unit: string | null; baseline_value: number | null; target_value: number | null; result_value: number | null; result_text: string | null; natural_baseline?: number | null }[] | null;
  contribution_pathways: { key: string; label: string; formula: string }[] | null;
  judgment_exemption: JudgmentExemption | null;
}

function emptyReflection(): ReflectionFields {
  return {
    id: null,
    decision_history: [],
    reflect_kind: null,
    reflect_measure_id: null,
    reflect_location: null,
    reflect_reason: null,
    adoption: null,
    inquiry_no: null,
    inquiry_date: null,
    reply_due: null,
    opinions: {},
    stakeholder_opinions: null,
    resource_change: {},
    reply_result: null,
    reply_date: null,
    decided_on: null,
    decision_meeting: null,
    set_notes: {},
  };
}

/** 決定処遇が標準処遇と「異なる」か（judgment.ts の treatmentDiffers と同じ規則） */
function differs(standard: string | null, decided: string | null): boolean {
  const d = (decided ?? "").trim();
  if (!d) return false;
  return d !== (standard ?? "").trim();
}

export async function buildReflectionData(projectId: string): Promise<ReflectionData | null> {
  const pj = (
    await query<{ title: string; municipality: string; plan_start_date: string | null; plan_end_date: string | null }>(
      `SELECT p.title, m.name AS municipality,
              to_char(p.plan_start_date, 'YYYY-MM-DD') AS plan_start_date,
              to_char(p.plan_end_date, 'YYYY-MM-DD') AS plan_end_date
         FROM projects p JOIN municipalities m ON m.id = p.municipality_id
        WHERE p.id = $1`,
      [projectId],
    )
  )[0];
  if (!pj) return null;

  const [evals, reflections, nextProject, costs, deferred] = await Promise.all([
    query<ReflEvalRow>(
      `SELECT pe.id, pe.measure_design_id, md.title AS measure_title, md.owner_department,
              pe.status, pe.fiscal_year, pe.approved_snapshot_at::text AS approved_snapshot_at,
              pe.evaluated_at::text AS evaluated_at, pe.evaluated_by, pe.created_at::text AS created_at,
              pe.judgment, pe.judgment_path, pe.report_no, pe.route, pe.standard_treatment,
              pe.decided_treatment, pe.rationale_required, pe.rationale, pe.comparison_grade, pe.fiscal_effect,
              pe.indicator_snapshot, md.contribution_pathways, md.judgment_exemption
         FROM program_evaluations pe
         JOIN measure_designs md ON md.id = pe.measure_design_id
        WHERE pe.project_id = $1 AND pe.measure_work_id IS NULL
          AND pe.evaluation_tier = 'outcome_intermediate'
        ORDER BY md.sort_order, pe.created_at DESC`,
      [projectId],
    ),
    query<ReflectionFields & { evaluation_id: string }>(
      `SELECT id, evaluation_id, decision_history, reflect_kind, reflect_measure_id, reflect_location, reflect_reason,
              adoption, inquiry_no, to_char(inquiry_date, 'YYYY-MM-DD') AS inquiry_date,
              to_char(reply_due, 'YYYY-MM-DD') AS reply_due, opinions, stakeholder_opinions, resource_change,
              reply_result, to_char(reply_date, 'YYYY-MM-DD') AS reply_date,
              to_char(decided_on, 'YYYY-MM-DD') AS decided_on, decision_meeting, set_notes
         FROM plan_reflections WHERE project_id = $1`,
      [projectId],
    ).catch(() => [] as (ReflectionFields & { evaluation_id: string })[]),
    query<{ id: string; title: string }>(
      `SELECT id, title FROM projects WHERE cloned_from_project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    ).then((r) => r[0] ?? null).catch(() => null),
    query<{ measure_design_id: string; total: number | null }>(
      `SELECT c.measure_design_id, sum(c.total_amount)::float AS total
         FROM measure_cost_years c JOIN measure_designs md ON md.id = c.measure_design_id
        WHERE md.project_id = $1 GROUP BY c.measure_design_id`,
      [projectId],
    ),
    query<DeferredItem>(
      `SELECT id, reflection_id, evaluation_id, title, detail, source_ref, reason_kind, reason,
              to_char(review_due, 'YYYY-MM-DD') AS review_due, condition, status, re_proposed_fiscal_year,
              status_note, created_at::text AS created_at
         FROM plan_deferred_items WHERE project_id = $1
        ORDER BY (status = 'deferred') DESC, review_due NULLS LAST, created_at`,
      [projectId],
    ).catch(() => [] as DeferredItem[]),
  ]);

  const nextMeasures: NextMeasureOption[] = nextProject
    ? await query<NextMeasureOption>(
        `SELECT id, title, cloned_from_measure_id FROM measure_designs WHERE project_id = $1 ORDER BY sort_order, created_at`,
        [nextProject.id],
      ).catch(() => [])
    : [];

  // 施策ごとの最新（承認済み > レビュー中 > 下書き）— 報告書1件
  const latest = new Map<string, ReflEvalRow>();
  for (const e of evals) {
    const cur = latest.get(e.measure_design_id);
    if (!cur || (STATUS_RANK[e.status] ?? 0) > (STATUS_RANK[cur.status] ?? 0)) latest.set(e.measure_design_id, e);
  }
  const reflByEval = new Map(reflections.map((r) => [r.evaluation_id, r]));
  const costOf = new Map(costs.map((c) => [c.measure_design_id, c.total]));

  const reports: ReportRow[] = [];
  for (const e of Array.from(latest.values())) {
    const no = (e.report_no ?? null) as ReportNo | null;
    const route = (e.route ?? null) as ReflectRoute | null;
    const pattern = no ? REPORT_PATTERNS[no] : null;
    const snap = Array.isArray(e.indicator_snapshot) ? e.indicator_snapshot : [];
    const mid = snap.find((i) => i.category_no === 8);
    const fe = e.fiscal_effect;
    const refl: ReflectionFields = reflByEval.get(e.id)
      ? { ...emptyReflection(), ...reflByEval.get(e.id)! }
      : emptyReflection();
    const hasJudgment = Boolean(e.judgment);
    const exemption = e.judgment_exemption;
    const adoptionEffective: Adoption | null =
      refl.adoption ?? (!hasJudgment ? null : !e.decided_treatment ? null : differs(e.standard_treatment, e.decided_treatment) ? "partial" : "adopted");

    // G1-9 順方向照合: 反映箇所（次期施策／章）か、理由付きの不採用があれば対応済み
    const reconciled =
      refl.reflect_kind === "measure"
        ? Boolean(refl.reflect_measure_id || refl.reflect_location)
        : refl.reflect_kind === "chapter"
          ? Boolean(refl.reflect_location)
          : refl.reflect_kind === "not_adopted"
            ? Boolean((refl.reflect_reason ?? "").trim())
            : false;
    const reconcileNote = !hasJudgment
      ? "旧フローの評価（判定なし）— fig7e1 で再評価すると照合対象になる"
      : no == null
        ? "判定保留・適用除外 — 測定設計の反映先（③指標・目標）を記入する"
        : reconciled
          ? "対応済み"
          : "未対応 — 反映箇所（または不採用・理由）が未記入";

    reports.push({
      evaluation_id: e.id,
      measure_id: e.measure_design_id,
      measure_title: e.measure_title,
      owner_department: e.owner_department,
      status: e.status,
      frozen: Boolean(e.approved_snapshot_at),
      fiscal_year: e.fiscal_year,
      evaluated_at: e.evaluated_at ?? e.created_at,
      evaluated_by: e.evaluated_by,
      path: e.judgment_path ?? "—",
      report_no: no,
      report_title: pattern ? pattern.title : exemption ? `適用除外（${EXEMPTION_META[exemption.kind].name}）` : hasJudgment ? "判定保留" : "－（判定なし）",
      state: pattern ? pattern.state : hasJudgment ? "判定に必要なデータが揃っていない" : "図E1以前の評価",
      route,
      route_name: route ? ROUTE_META[route].name : null,
      review: route ? ROUTE_META[route].review : hasJudgment ? "報告のみ（判定保留・適用除外は測定設計のみ）" : null,
      standard_treatment: e.standard_treatment,
      decided_treatment: e.decided_treatment,
      rationale_required: Boolean(e.rationale_required),
      rationale: e.rationale,
      outcome: mid
        ? {
            label: mid.label,
            baseline: withUnit(mid.baseline_value, mid.unit),
            target: withUnit(mid.target_value, mid.unit),
            result: mid.result_value != null ? withUnit(mid.result_value, mid.unit) : (mid.result_text ?? "—"),
            natural_baseline: mid.natural_baseline != null ? withUnit(mid.natural_baseline, mid.unit) : "未入力",
            x:
              mid.natural_baseline != null && mid.result_value != null
                ? withUnit(Math.round((mid.result_value - mid.natural_baseline) * 1000) / 1000, mid.unit)
                : "未算定",
          }
        : null,
      comparison_grade: e.comparison_grade,
      cost_total: fe?.cost_total ?? costOf.get(e.measure_design_id) ?? null,
      fiscal_effect: fe?.effect_total ?? null,
      fiscal_rate: fe?.rate ?? null,
      fiscal_mark: fe?.mark ?? null,
      pathways:
        fe && fe.pathways.length > 0
          ? fe.pathways.map((p) => `${p.label ?? p.pathway_key}: ${p.cumulative != null ? `¥${p.cumulative.toLocaleString()}` : "未入力"}`).join("／")
          : (e.contribution_pathways ?? []).map((p) => p.label).join("／") || "未定義",
      exemption,
      inquiry_items: route ? INQUIRY_ITEMS[route] : [],
      reflection: refl,
      adoption_effective: adoptionEffective,
      reconciled,
      reconcile_note: reconcileNote,
    });
  }

  // 逆方向照合: 次期施策に根拠（報告書からの反映 or クローン系譜）があるか
  const referenced = new Set(reports.map((r) => r.reflection.reflect_measure_id).filter(Boolean) as string[]);
  const unsourced = nextMeasures.filter((m) => !referenced.has(m.id) && !m.cloned_from_measure_id);

  const judgedReports = reports.filter((r) => r.report_no != null);
  const fy = (d: string | null) => (d ? `${d.slice(0, 4)}年度` : "—");
  return {
    project_title: pj.title,
    municipality: pj.municipality,
    plan_period: `${fy(pj.plan_start_date)}〜${fy(pj.plan_end_date)}`,
    reports,
    next_project: nextProject,
    next_measures: nextMeasures,
    unsourced_next_measures: unsourced,
    deferred,
    reconciliation: {
      total: judgedReports.length,
      reconciled: judgedReports.filter((r) => r.reconciled).length,
      unreconciled: judgedReports.filter((r) => !r.reconciled).length,
      unsourced: unsourced.length,
      exceptions: reports.filter((r) => r.rationale_required).length,
    },
  };
}

// ─── 行の文字列化（docx・画面で共用）────────────────────────

export const G1_HEADERS = ["報告書No.", "施策No.（前期）", "判定", "ルート", "標準処遇", "決定処遇", "理由書", "次期計画の反映箇所", "照合結果"] as const;

export function g1RowText(r: ReportRow, nextMeasures: NextMeasureOption[]): string[] {
  const nm = r.reflection.reflect_measure_id ? nextMeasures.find((m) => m.id === r.reflection.reflect_measure_id) : null;
  const reflect =
    r.reflection.reflect_kind === "not_adopted"
      ? `不採用・理由: ${r.reflection.reflect_reason ?? ""}`
      : r.reflection.reflect_kind
        ? [nm ? `次期施策「${nm.title}」` : null, r.reflection.reflect_location].filter(Boolean).join("／") || "（未記入）"
        : "（未記入）";
  const hist = r.reflection.decision_history
    .filter((h) => h.stage !== "draft")
    .map((h) => `${h.at.slice(0, 10)} ${h.stage === "reply" ? "答申" : "会議"}: ${h.decided_treatment ?? ""}${h.reason ? `（${h.reason}）` : ""}`)
    .join("\n");
  return [
    r.report_no ? `No.${r.report_no} ${r.report_title}` : r.report_title,
    `${r.measure_title}${r.owner_department ? `\n${r.owner_department}` : ""}`,
    `${r.path}${r.frozen ? "" : "【暫定】"}`,
    r.route ? `${r.route} ${r.route_name}` : r.exemption ? "除外" : r.report_no == null ? "保留" : "—",
    r.standard_treatment ?? "—（処遇を行わない）",
    `${r.decided_treatment ?? "—"}${hist ? `\n${hist}` : ""}`,
    r.rationale_required ? "○" : "—",
    reflect,
    r.reconciled ? "対応済み" : `未対応（${r.reconcile_note}）`,
  ];
}

export const G2_HEADERS = ["報告書No.（施策）", "評価結果の要旨", "標準処遇", "決定（採用・一部採用・不採用）", "不採用・変更の理由", "反映箇所"] as const;

export function g2RowText(r: ReportRow, nextMeasures: NextMeasureOption[]): string[] {
  const g1 = g1RowText(r, nextMeasures);
  const gist = r.report_no
    ? `${r.state}（${r.path}）${r.outcome ? `／${r.outcome.label}: ${r.outcome.baseline}→${r.outcome.result}（目標 ${r.outcome.target}）` : ""}${r.fiscal_rate != null ? `／財政効果率 ${r.fiscal_rate}%` : ""}`
    : r.state;
  return [
    `${g1[0] ?? ""}（${r.measure_title}）`,
    gist,
    r.standard_treatment ?? "—",
    r.adoption_effective ? ADOPTION_LABEL[r.adoption_effective] : "—",
    r.adoption_effective && r.adoption_effective !== "adopted" ? (r.rationale ?? "（理由書未記入）") : "－",
    g1[7] ?? "",
  ];
}

/** G4 諮問事項整理書（1葉）— ①〜⑦は自動、⑧〜⑫は手入力 */
export function g4Sections(r: ReportRow, nextMeasures: NextMeasureOption[]): { heading: string; kv: { label: string; value: string }[] }[] {
  const f = r.reflection;
  const rc = f.resource_change;
  const g1 = g1RowText(r, nextMeasures);
  const ax = (k: "a" | "b" | "c" | "d") => f.opinions[k] ?? "（未記入）";
  return [
    { heading: "① 諮問の基本事項", kv: [{ label: "諮問番号", value: f.inquiry_no ?? "（未採番）" }, { label: "諮問年月日", value: f.inquiry_date ?? "—" }, { label: "答申を要する期日", value: f.reply_due ?? "—" }] },
    { heading: "② 対象", kv: [{ label: "施策", value: r.measure_title }, { label: "主管・担当", value: r.owner_department ?? "—" }] },
    {
      heading: "③ 評価結果",
      kv: [
        { label: "報告書No.", value: g1[0] ?? "" },
        { label: "記号列", value: `${r.path}${r.frozen ? "" : "【暫定】"}` },
        { label: "比較の段", value: r.comparison_grade ?? "未入力" },
        { label: "評価実施日・評価者", value: `${(r.evaluated_at ?? "").slice(0, 10)} ／ ${r.evaluated_by ?? "—"}` },
      ],
    },
    {
      heading: "④ 成果の状況",
      kv: r.outcome
        ? [
            { label: "指標名", value: r.outcome.label },
            { label: "基準値／目標値／期末実績", value: `${r.outcome.baseline} ／ ${r.outcome.target} ／ ${r.outcome.result}` },
            { label: "ベースライン（自然体推計）／X（実績−ベースライン）", value: `${r.outcome.natural_baseline} ／ ${r.outcome.x}` },
          ]
        : [{ label: "指標", value: "中間アウトカム指標が未設定" }],
    },
    {
      heading: "⑤ 費用と効率性",
      kv: [
        { label: "事業費累計C", value: r.cost_total != null ? `¥${r.cost_total.toLocaleString()}` : "—" },
        { label: "寄与経路／財政効果", value: `${r.pathways}${r.fiscal_effect != null ? `／計 ¥${r.fiscal_effect.toLocaleString()}` : ""}` },
        { label: "効果率／判定", value: `${r.fiscal_rate != null ? `${r.fiscal_rate}%` : "算定不能"} ／ ${r.fiscal_mark ?? (r.exemption ? "適用除外" : "保留")}` },
      ],
    },
    { heading: "⑥ 標準処遇", kv: [{ label: "報告書No.ごとの初期値", value: r.standard_treatment ?? "—（処遇を行わない）" }] },
    {
      heading: "⑦ 事務局案と理由",
      kv: [
        { label: "決定処遇案", value: r.decided_treatment ?? "（未決定）" },
        { label: "理由（標準処遇と異なる場合は理由書H4を兼ねる）", value: r.rationale_required ? (r.rationale ?? "（理由書未記入）") : "標準処遇のとおり" },
      ],
    },
    { heading: "⑧ 判断4軸の所見", kv: [{ label: "ア 評価との整合性", value: ax("a") }, { label: "イ 見直しによる改善可能性", value: ax("b") }, { label: "ウ 対象・目的・手段の明確さ", value: ax("c") }, { label: "エ 実務妥当性", value: ax("d") }] },
    { heading: "⑨ 関係機関の意見", kv: [{ label: "聴取した意見と事務局案への反映状況", value: f.stakeholder_opinions ?? "（未記入）" }] },
    { heading: "⑩ 諮問事項（ルートから定型選択）", kv: [{ label: r.route ? `ルート${r.route} ${r.route_name}（${r.review}）` : "審議区分", value: r.inquiry_items.length > 0 ? r.inquiry_items.join("／") : "報告のみ（判定保留・適用除外は測定設計のみ）" }] },
    {
      heading: "⑪ 資源の異動（千円）",
      kv: [
        { label: "増減額", value: rc.delta_amount != null ? rc.delta_amount.toLocaleString() : "—" },
        { label: "解放資源の額／再配分先候補", value: `${rc.released_amount != null ? rc.released_amount.toLocaleString() : "—"} ／ ${rc.reallocation_to ?? "—"}` },
        { label: "予算中立の確認", value: rc.budget_neutral == null ? "未確認" : rc.budget_neutral ? "確認済み" : "中立でない" },
        ...(rc.note ? [{ label: "備考", value: rc.note }] : []),
      ],
    },
    { heading: "⑫ 答申後の反映先", kv: [{ label: "次期計画上の該当箇所（G1-8）", value: g1[7] ?? "" }, { label: "答申", value: f.reply_result ? `${f.reply_date ?? ""} ${f.reply_result}` : "（未答申）" }] },
  ];
}
