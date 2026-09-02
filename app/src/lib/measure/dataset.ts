/**
 * 施策データセットの拡張部（migration 057）— 取組・アクティビティ・指標・年度別コスト。
 *
 * 既存の measure_designs（主要施策の本体）はそのまま残し、
 * この層を足して「主要施策 → 取組 → アクティビティ」の二層と、
 * 別紙「プログラム評価指標一覧」17カテゴリの指標を持てるようにする。
 *
 * ここには**純粋なロジックだけ**を置く（DB アクセスは API 側）。
 * 自動補完は「空いているところだけ埋める」設計にしてあり、
 * 担当者が手で直した値を後から上書きしない。
 */

import {
  INDICATOR_BY_NO,
  INDICATOR_CATEGORIES,
  indicatorGaps,
  type IndicatorFrequency,
  type IndicatorGap,
  type IndicatorRequirement,
  type RelativePeriod,
  type EvaluationKind,
  type FundingKey,
} from "./indicators";
import type { ApproachCost, ApproachIndicators, ApproachItem, ExperimentPlan } from "./types";
import type {
  ContributionPathway,
  FiscalEffectPathwayAmount,
  JudgmentExemption,
} from "@/lib/evaluation/judgment";

// ─── 行の形 ───────────────────────────────────────────

export interface MeasureWork {
  id: string;
  measure_design_id: string;
  /** 画面表示用の符号（W-1） */
  code: string;
  title: string;
  summary: string | null;
  target: string | null;
  /** 直営／委託／補助 等 */
  method: string | null;
  owner_department: string | null;
  retired: boolean;
  retired_reason: string | null;
  sort_order: number;
}

export type ActivityRecurrence = "none" | "monthly" | "quarterly" | "semiannual" | "annual";

export const RECURRENCE_LABEL: Record<ActivityRecurrence, string> = {
  none: "なし",
  monthly: "毎月",
  quarterly: "四半期ごと",
  semiannual: "半期ごと",
  annual: "毎年度",
};

export interface MeasureActivity {
  id: string;
  measure_work_id: string;
  title: string;
  note: string | null;
  start_date: string | null;
  /** 実施期限。未設定のものはスケジュールへ反映しない */
  due_date: string | null;
  recurrence: ActivityRecurrence;
  occurrences: number | null;
  owner_department: string | null;
  document_required: boolean;
  document_deadline: string | null;
  /** 「開催後30日」のような相対指定 */
  document_offset_days: number | null;
  sort_order: number;
  /** 反映済みのスケジュールタスク数（結合して埋める） */
  task_count: number;
}

export interface MeasureIndicatorRow {
  id: string;
  measure_design_id: string;
  /** null なら主要施策レベル */
  measure_work_id: string | null;
  category_no: number;
  label: string;
  definition: string | null;
  unit: string | null;
  baseline_value: number | null;
  baseline_date: string | null;
  /** 自然体推計値（施策がなかった場合の推移）— 060。X＝実績−この値。目標値との差ではない */
  natural_baseline: number | null;
  /** 自然体推計の根拠（推計方法・出典） */
  baseline_source: string | null;
  target_value: number | null;
  achievement_condition: "lte" | "lt" | "gte" | "gt" | "eq";
  data_source: string | null;
  frequency: IndicatorFrequency;
  base_day: string | null;
  kpi_id: string | null;
  requirement: IndicatorRequirement;
  auto_filled: boolean;
  sort_order: number;
  checkpoints: MeasureCheckpoint[];
}

export interface MeasureCheckpoint {
  id: string;
  measure_indicator_id: string;
  label: string;
  relative_year: number | null;
  relative_period: RelativePeriod | null;
  absolute_date: string | null;
  evaluation_type: EvaluationKind | null;
  owner_department: string | null;
  sort_order: number;
}

export interface MeasureCostYear {
  id: string;
  measure_design_id: string;
  /** 年度の開始する西暦年（2026 = 令和8年度） */
  fiscal_year: number;
  total_amount: number | null;
  funding: Partial<Record<FundingKey, number | null>>;
  note: string | null;
}

export interface MeasureCostItem {
  id: string;
  measure_design_id: string;
  item: string;
  basis: string | null;
  /** 年度別の金額 {"2026": 300000} */
  amounts: Record<string, number>;
  sort_order: number;
}

/** 施策本体に持つ「計画時の前提」（060）— 寄与経路・事前推計・適用除外・前提条件表（H2） */
export interface MeasureJudgmentSetup {
  contribution_pathways: ContributionPathway[];
  fiscal_effect_estimates: FiscalEffectPathwayAmount[];
  judgment_exemption: JudgmentExemption | null;
  preconditions: MeasurePrecondition[];
}

/** 様式H2 前提条件表の1行（measure_designs.preconditions） */
export interface MeasurePrecondition {
  id: string;
  /** 前提（崩れると施策全体が止まる急所） */
  condition: string;
  /** 確認方法（年次評価で機械的に確認できる事実） */
  check_method: string;
  /** 崩れた場合の対応（発動条件を含む） */
  fallback: string;
  /** 直近の年次確認の結果 */
  status: "unchecked" | "holds" | "broken";
  checked_fiscal_year: number | null;
  note: string | null;
}

export interface MeasureDataset {
  works: MeasureWork[];
  activities: MeasureActivity[];
  indicators: MeasureIndicatorRow[];
  costYears: MeasureCostYear[];
  costItems: MeasureCostItem[];
  setup: MeasureJudgmentSetup;
}

/** 取り下げていない取組 */
export function activeWorks(works: MeasureWork[]): MeasureWork[] {
  return works.filter((w) => !w.retired);
}

/** 次の取組コード（W-1, W-2…。取り下げた分も含めた総数で採番し、番号は再利用しない） */
export function nextWorkCode(works: MeasureWork[]): string {
  const used = new Set(works.map((w) => w.code));
  for (let i = works.length + 1; ; i++) {
    const code = `W-${i}`;
    if (!used.has(code)) return code;
  }
}

// ─── 自動補完 ─────────────────────────────────────────

/** 補完の材料 — 対話と上流の工程から取れるもの */
export interface AutoFillSource {
  approach: ApproachItem;
  experiment: ExperimentPlan | null;
  dialogueIndicators: ApproachIndicators | null;
  cost: ApproachCost | null;
  /** ギャップ分析の指標（長期アウトカムの種） */
  kpi: { id: string; label: string; unit: string | null; current: number | null; target: number | null } | null;
  /** 計画期間（年度の開始西暦年） */
  planStartYear: number;
  planEndYear: number;
  ownerDepartment: string | null;
}

/** 補完で作る下書き（DBへ入れる前の形） */
export interface AutoFillDraft {
  works: { code: string; title: string; summary: string | null; target: string | null; method: string | null; owner_department: string | null; sort_order: number }[];
  /** work は code で参照する（採番前のため） */
  indicators: (Omit<MeasureIndicatorRow, "id" | "measure_design_id" | "measure_work_id" | "checkpoints"> & {
    work_code: string | null;
    checkpoints: Omit<MeasureCheckpoint, "id" | "measure_indicator_id">[];
  })[];
  costYears: Omit<MeasureCostYear, "id" | "measure_design_id">[];
  costItems: Omit<MeasureCostItem, "id" | "measure_design_id">[];
}

function indicatorDraft(
  no: number,
  workCode: string | null,
  over: Partial<Omit<MeasureIndicatorRow, "id" | "measure_design_id" | "measure_work_id" | "checkpoints">> = {},
  checkpoints: Omit<MeasureCheckpoint, "id" | "measure_indicator_id">[] = [],
): AutoFillDraft["indicators"][number] {
  const cat = INDICATOR_BY_NO[no]!;
  return {
    work_code: workCode,
    category_no: no,
    label: over.label ?? "",
    definition: over.definition ?? cat.definition,
    unit: over.unit ?? null,
    baseline_value: over.baseline_value ?? null,
    baseline_date: over.baseline_date ?? null,
    natural_baseline: over.natural_baseline ?? null,
    baseline_source: over.baseline_source ?? null,
    target_value: over.target_value ?? null,
    achievement_condition: over.achievement_condition ?? "gte",
    data_source: over.data_source ?? cat.sourceHint,
    frequency: over.frequency ?? cat.frequency,
    base_day: over.base_day ?? null,
    kpi_id: over.kpi_id ?? null,
    requirement: over.requirement ?? cat.requirement,
    auto_filled: true,
    sort_order: no,
    checkpoints,
  };
}

/**
 * 前工程の情報から、施策データセットの下書きを起こす。
 *
 * 埋められるのは「前の工程で担当者とAIが決めたこと」だけで、
 * 目標値のように現場でしか決まらないものは空のまま残す（画面で入力してもらう）。
 * 何を埋めたかは auto_filled で分かるようにしてある。
 */
export function buildAutoFill(src: AutoFillSource): AutoFillDraft {
  const { approach, experiment, dialogueIndicators, cost, kpi } = src;

  // 取組の原案 — アプローチの介入内容をそのまま1件目に置く。
  // 複数の取組に割るのは担当者の仕事なので、こちらで無理に分割しない。
  const works: AutoFillDraft["works"] = [
    {
      code: "W-1",
      title: approach.measure_title,
      summary: approach.intervention || null,
      target: approach.target || null,
      method: null,
      owner_department: src.ownerDepartment,
      sort_order: 0,
    },
  ];

  const indicators: AutoFillDraft["indicators"] = [];

  // 取組レベル — 対話で決めた三層指標を移す
  const st = dialogueIndicators?.structure ?? [];
  const pr = dialogueIndicators?.process ?? [];
  if (st.length > 0) {
    indicators.push(indicatorDraft(4, "W-1", { label: st[0]!, unit: "有無" }));
  }
  indicators.push(
    indicatorDraft(5, "W-1", {
      label: pr[0] ?? "",
      data_source: "事業実施記録（アクティビティのタスク完了実績）",
    }),
  );
  indicators.push(indicatorDraft(6, "W-1", { label: pr[1] ?? "" }));

  const initial = (dialogueIndicators?.outcome_initial ?? []).find((k) => k.label.trim());
  indicators.push(
    indicatorDraft(7, "W-1", {
      label: initial?.label ?? "",
      unit: initial?.unit ?? null,
      baseline_value: initial?.baseline ?? null,
      target_value: initial?.target ?? null,
      achievement_condition: initial?.condition ?? "gte",
      kpi_id: initial?.existing_kpi_id ?? null,
    }),
  );

  // 主要施策レベル
  const inter = (dialogueIndicators?.outcome_intermediate ?? []).find((k) => k.label.trim());
  indicators.push(
    indicatorDraft(8, null, {
      label: inter?.label ?? "",
      unit: inter?.unit ?? null,
      baseline_value: inter?.baseline ?? null,
      target_value: inter?.target ?? null,
      achievement_condition: inter?.condition ?? "gte",
      kpi_id: inter?.existing_kpi_id ?? null,
    }),
    // 計画期間評価の時点を1つ置いておく（第3年度 上期）
    );
  const interIdx = indicators.length - 1;
  indicators[interIdx]!.checkpoints = [
    {
      label: "計画期間評価",
      relative_year: src.planEndYear - src.planStartYear + 1,
      relative_period: "first",
      absolute_date: null,
      evaluation_type: "outcome",
      owner_department: src.ownerDepartment,
      sort_order: 0,
    },
  ];

  // インプット（執行率の分母分子）
  indicators.push(
    indicatorDraft(3, null, {
      label: "事業費（予算額・決算額）",
      unit: "円",
      baseline_value: cost?.total_budget ?? null,
      data_source: "予算書・決算書",
    }),
  );

  // 単位コスト — 対話で決めた算定式をそのまま入れる
  indicators.push(
    indicatorDraft(15, null, {
      label: "単位コスト",
      unit: "円",
      definition: cost?.cost_per_outcome_note || INDICATOR_BY_NO[15]!.definition,
      data_source: cost?.cost_per_outcome_note || INDICATOR_BY_NO[15]!.sourceHint,
      achievement_condition: "lte",
    }),
  );

  // インパクト — 実験設計の主要評価項目がそのまま純効果の指標になる
  if (experiment?.primary_outcome) {
    indicators.push(
      indicatorDraft(13, null, {
        label: experiment.primary_outcome,
        definition: `実験設計（${experiment.design}）の主要評価項目。${experiment.rationale}`,
        data_source: experiment.data_design || INDICATOR_BY_NO[13]!.sourceHint,
      }),
    );
  }

  // 長期アウトカム — ギャップ分析の指標をそのまま引き継ぐ
  if (kpi) {
    indicators.push(
      indicatorDraft(9, null, {
        label: kpi.label,
        unit: kpi.unit,
        baseline_value: kpi.current,
        target_value: kpi.target,
        kpi_id: kpi.id,
        data_source: "ギャップ分析の指標",
      }),
    );
  }

  // 年度別コスト — 初年度に対話のコストを置き、以降は0で枠だけ作る。
  // 2年目以降は担当者が編集する（勝手に同額を並べない）。
  const costYears: AutoFillDraft["costYears"] = [];
  for (let y = src.planStartYear; y <= src.planEndYear; y++) {
    costYears.push({
      fiscal_year: y,
      total_amount: y === src.planStartYear ? (cost?.total_budget ?? null) : null,
      funding: {},
      note: y === src.planStartYear ? "対話のコスト整理から自動で入れた概算" : null,
    });
  }

  // 積算内訳 — 対話で費目を積んでいればそれを初年度に置く
  const costItems: AutoFillDraft["costItems"] = (cost?.breakdown ?? []).map((b, i) => ({
    item: b.item,
    basis: b.note ?? null,
    amounts: b.amount != null ? { [String(src.planStartYear)]: b.amount } : {},
    sort_order: i,
  }));

  return { works, indicators, costYears, costItems };
}

// ─── 完成度 ───────────────────────────────────────────

export interface DatasetGaps {
  /** 必須指標の不足 */
  indicators: IndicatorGap[];
  /** 期限が未設定でスケジュールへ反映できないアクティビティ */
  activitiesWithoutDue: { id: string; title: string }[];
  /** 事業費計と財源内訳が食い違う年度 */
  fundingMismatch: number[];
  /** 取組が1件も無い */
  noWorks: boolean;
}

export function datasetGaps(
  ds: MeasureDataset,
  measureTitle: string,
  fundingMismatchYears: (rows: MeasureCostYear[]) => number[],
): DatasetGaps {
  const alive = activeWorks(ds.works);
  const aliveIds = new Set(alive.map((w) => w.id));
  return {
    noWorks: alive.length === 0,
    indicators: indicatorGaps(
      alive.map((w) => ({ id: w.id, title: `${w.code} ${w.title}` })),
      ds.indicators,
      measureTitle,
    ),
    activitiesWithoutDue: ds.activities
      .filter((a) => aliveIds.has(a.measure_work_id) && !a.due_date)
      .map((a) => ({ id: a.id, title: a.title })),
    fundingMismatch: fundingMismatchYears(ds.costYears),
  };
}

/** 必須が満たされているか（確定の可否） */
export function datasetReady(g: DatasetGaps): boolean {
  return !g.noWorks && g.indicators.length === 0;
}

/** カテゴリ一覧を層で分けて画面に出す用 */
export function categoriesFor(level: "work" | "measure") {
  return INDICATOR_CATEGORIES.filter((c) => c.level === level);
}
