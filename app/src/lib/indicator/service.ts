/**
 * 指標のサービス層 — 設計: claude/coe-dataset-model.md §9-1・§9-4・§10-5（D3）
 *
 * 指標は3つの表でできている。
 *   indicators        … 指標そのもの（どう測るか）。旧 kpis を改名して吸収した
 *   indicator_targets … 目標。計画／主要施策／取組の**スコープ付き**
 *   indicator_values  … 値の履歴。「いつ時点の値か（as_of）」「誰が・どの経路で」「どの版から」
 *
 * **画面（API ルート）も AI（対話の確定処理）も、必ずここを通る。**
 * すべての作成・変更・記録は activity_log に同じ形で残り、AI の操作でも actor は
 * その対話の担当者になる（設計 §10-5）。
 *
 * `current` という上書きされる1列は無くなった。手入力も「履歴の1行」として積む。
 *
 * ★ この層は**分野に依存しない**。特定の行政分野の語彙を書かないこと（check:generic）。
 */
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "@/lib/db";
import { logActivity, type Actor } from "@/lib/activity";
import { computeIndicator } from "./engine";
import { validateSpec, type IndicatorSpec, type Missing } from "./spec";

/**
 * 既に走っているトランザクションの中から呼ぶための入口。
 *
 * 計画の新規作成・次期計画への複製・施策構築の確定は、いずれも**1つのトランザクションの中で**
 * 指標を作る。そこで別のコネクションを取ると同じトランザクションにならず、ロールバックしても
 * 指標だけ残る。だから作成系は `*Tx(client, …)` を持ち、単体で呼ぶ版はそれを `transaction` で
 * 包んだだけのものにしてある。**サービスの外で INSERT を書かないこと**（設計 §9-1 Step 4）。
 */
async function inTx<T>(client: PoolClient | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return client ? fn(client) : transaction(fn);
}

export class IndicatorError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

// ── 型 ──────────────────────────────────────────────────────

/** 目標のスコープ。計画の KPI か、主要施策の目標か、取組の目標か */
export type TargetScope = "plan" | "measure" | "work";

/** 算出方法。manual 以外は指標エンジン（D4）が計算する */
export type CalcType = "manual" | "aggregate" | "longitudinal" | "cross" | "formula";

/** どこで生まれた指標か */
export type IndicatorOrigin = "plan" | "measure" | "dialogue" | "template";

export interface IndicatorRow {
  id: string;
  project_id: string;
  label: string;
  unit: string;
  description: string | null;
  calc_type: CalcType;
  spec: Record<string, unknown>;
  time_granularity: "day" | "month" | "fiscal_year";
  data_source: string | null;
  frequency: string | null;
  base_day: string | null;
  origin: IndicatorOrigin;
  /** ロジックモデル上の段階（process / outcome_initial / …）。旧 kpis から引き継いだ列 */
  indicator_type: string;
  goal_id: string | null;
  contributes_to_kpi_id: string | null;
  cloned_from_kpi_id: string | null;
  target_needs_review: boolean;
  previous_value: string | null;
  previous_target: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndicatorTargetRow {
  id: string;
  indicator_id: string;
  scope: TargetScope;
  measure_design_id: string | null;
  measure_work_id: string | null;
  baseline_value: string | null;
  baseline_as_of: string | null;
  target_value: string | null;
  achievement_condition: string;
  target_deadline: string | null;
  note: string | null;
}

export interface IndicatorValueRow {
  id: string;
  indicator_id: string;
  as_of: string;
  scope: TargetScope;
  measure_design_id: string | null;
  measure_work_id: string | null;
  cohort_id: string | null;
  arm: string | null;
  value: string | null;
  value_text: string | null;
  numerator: string | null;
  denominator: string | null;
  n: number | null;
  inputs: Record<string, unknown>;
  note: string | null;
  computed_at: string;
  actor: string | null;
  via: string;
}

/** 一覧の1件（目標と最新値を添えたもの） */
export interface IndicatorListItem extends IndicatorRow {
  target_value: string | null;
  baseline_value: string | null;
  achievement_condition: string | null;
  target_deadline: string | null;
  latest_value: string | null;
  latest_as_of: string | null;
  latest_via: string | null;
  value_count: number;
}

const INDICATOR_COLS = `i.id, i.project_id, i.label, i.unit, i.description, i.calc_type, i.spec,
  i.time_granularity, i.data_source, i.frequency, i.base_day, i.origin, i.indicator_type,
  i.goal_id, i.contributes_to_kpi_id, i.cloned_from_kpi_id, i.target_needs_review,
  i.previous_value, i.previous_target, i.created_at::text AS created_at, i.updated_at::text AS updated_at`;

// ── 参照 ─────────────────────────────────────────────────────

/**
 * 計画の指標一覧。`scope` を指定すると、そのスコープの目標と最新値を添える。
 * 既定は計画（旧 KPI 一覧に相当）。
 */
export async function listIndicators(
  projectId: string,
  opts: { scope?: TargetScope; measureDesignId?: string; measureWorkId?: string; origins?: IndicatorOrigin[] } = {},
): Promise<IndicatorListItem[]> {
  const scope = opts.scope ?? "plan";
  return query<IndicatorListItem>(
    `SELECT ${INDICATOR_COLS},
            t.target_value, t.baseline_value, t.achievement_condition, t.target_deadline::text AS target_deadline,
            lv.value AS latest_value, lv.as_of::text AS latest_as_of, lv.via AS latest_via,
            (SELECT COUNT(*)::int FROM indicator_values v2
              WHERE v2.indicator_id = i.id AND v2.scope = $2) AS value_count
       FROM indicators i
       LEFT JOIN indicator_targets t
              ON t.indicator_id = i.id AND t.scope = $2
             AND t.measure_design_id IS NOT DISTINCT FROM $3::uuid
             AND t.measure_work_id IS NOT DISTINCT FROM $4::uuid
       LEFT JOIN LATERAL (
         SELECT v.value, v.as_of, v.via FROM indicator_values v
          WHERE v.indicator_id = i.id AND v.scope = $2
            AND v.cohort_id IS NULL AND v.arm IS NULL
          ORDER BY v.as_of DESC, v.computed_at DESC LIMIT 1
       ) lv ON true
      WHERE i.project_id = $1
        AND ($5::text[] IS NULL OR i.origin = ANY($5::text[]))
        AND ($2 <> 'plan' OR i.origin = 'plan')
      ORDER BY i.created_at`,
    [projectId, scope, opts.measureDesignId ?? null, opts.measureWorkId ?? null, opts.origins ?? null],
  );
}

export async function getIndicator(projectId: string, indicatorId: string): Promise<IndicatorRow | null> {
  return queryOne<IndicatorRow>(
    `SELECT ${INDICATOR_COLS} FROM indicators i WHERE i.id = $1 AND i.project_id = $2`,
    [indicatorId, projectId],
  );
}

export async function listTargets(indicatorId: string): Promise<IndicatorTargetRow[]> {
  return query<IndicatorTargetRow>(
    `SELECT id, indicator_id, scope, measure_design_id, measure_work_id, baseline_value,
            baseline_as_of::text AS baseline_as_of, target_value, achievement_condition,
            target_deadline::text AS target_deadline, note
       FROM indicator_targets WHERE indicator_id = $1 ORDER BY scope`,
    [indicatorId],
  );
}

export async function listValues(
  indicatorId: string,
  opts: { scope?: TargetScope; limit?: number } = {},
): Promise<IndicatorValueRow[]> {
  return query<IndicatorValueRow>(
    `SELECT id, indicator_id, as_of::text AS as_of, scope, measure_design_id, measure_work_id,
            cohort_id, arm, value, value_text, numerator, denominator, n, inputs, note,
            computed_at::text AS computed_at, actor, via
       FROM indicator_values
      WHERE indicator_id = $1 AND ($2::text IS NULL OR scope = $2)
      ORDER BY as_of DESC, computed_at DESC
      LIMIT $3`,
    [indicatorId, opts.scope ?? null, opts.limit ?? 200],
  );
}

/** そのスコープの最新値（as_of が最大のうち、計算が最新のもの） */
export async function latestValue(
  indicatorId: string,
  scope: TargetScope = "plan",
): Promise<IndicatorValueRow | null> {
  const rows = await query<IndicatorValueRow>(
    `SELECT id, indicator_id, as_of::text AS as_of, scope, measure_design_id, measure_work_id,
            cohort_id, arm, value, value_text, numerator, denominator, n, inputs, note,
            computed_at::text AS computed_at, actor, via
       FROM indicator_values
      WHERE indicator_id = $1 AND scope = $2 AND cohort_id IS NULL AND arm IS NULL
      ORDER BY as_of DESC, computed_at DESC LIMIT 1`,
    [indicatorId, scope],
  );
  return rows[0] ?? null;
}

// ── 作成・更新 ───────────────────────────────────────────────

export interface CreateIndicatorInput {
  label: string;
  unit?: string;
  description?: string | null;
  indicatorType?: string;
  origin?: IndicatorOrigin;
  calcType?: CalcType;
  /** 算出の設定（タイプごと）。手入力なら不要。lib/indicator/spec.ts の validateSpec を通すこと */
  spec?: Record<string, unknown>;
  timeGranularity?: "day" | "month" | "fiscal_year";
  dataSource?: string | null;
  frequency?: string | null;
  baseDay?: string | null;
  goalId?: string | null;
  contributesToId?: string | null;
  previousValue?: number | null;
  previousTarget?: number | null;
  targetNeedsReview?: boolean;
  /** 同時に目標を置く場合 */
  target?: SetTargetInput;
}

export interface SetTargetInput {
  scope: TargetScope;
  measureDesignId?: string | null;
  measureWorkId?: string | null;
  baselineValue?: number | null;
  baselineAsOf?: string | null;
  targetValue?: number | null;
  achievementCondition?: string;
  targetDeadline?: string | null;
  note?: string | null;
}

const CONDITIONS = new Set(["gte", "lte", "eq", "gt", "lt"]);

function validateTarget(input: SetTargetInput): void {
  if (!["plan", "measure", "work"].includes(input.scope)) throw new IndicatorError("目標のスコープが不正です");
  if (input.scope === "measure" && !input.measureDesignId) throw new IndicatorError("主要施策の目標には施策の指定が必要です");
  if (input.scope === "work" && !input.measureWorkId) throw new IndicatorError("取組の目標には取組の指定が必要です");
  if (input.scope === "plan" && (input.measureDesignId || input.measureWorkId)) {
    throw new IndicatorError("計画の目標に施策・取組は指定できません");
  }
  if (input.achievementCondition && !CONDITIONS.has(input.achievementCondition)) {
    throw new IndicatorError("達成条件が不正です");
  }
  if (input.baselineAsOf && !/^\d{4}-\d{2}-\d{2}$/.test(input.baselineAsOf)) throw new IndicatorError("基準日は YYYY-MM-DD で指定してください");
  if (input.targetDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDeadline)) throw new IndicatorError("期限は YYYY-MM-DD で指定してください");
}

export async function createIndicator(
  actor: Actor,
  projectId: string,
  input: CreateIndicatorInput,
): Promise<IndicatorRow> {
  return createIndicatorTx(null, actor, projectId, input);
}

/** 既に走っているトランザクションの中から作る（client を渡す）。詳細は `inTx` の注記 */
export async function createIndicatorTx(
  client: PoolClient | null,
  actor: Actor,
  projectId: string,
  input: CreateIndicatorInput,
): Promise<IndicatorRow> {
  const label = String(input.label ?? "").trim();
  if (!label) throw new IndicatorError("指標名が必要です");
  if (label.length > 200) throw new IndicatorError("指標名は200文字以内にしてください");
  if (input.target) validateTarget(input.target);

  return inTx(client, async (client) => {
    const r = await client.query<IndicatorRow>(
      `INSERT INTO indicators
         (project_id, label, unit, description, indicator_type, origin, calc_type, time_granularity,
          data_source, frequency, base_day, goal_id, contributes_to_kpi_id,
          previous_value, previous_target, target_needs_review, spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, project_id, label, unit, description, calc_type, spec, time_granularity,
                 data_source, frequency, base_day, origin, indicator_type, goal_id,
                 contributes_to_kpi_id, cloned_from_kpi_id, target_needs_review,
                 previous_value, previous_target, created_at::text AS created_at, updated_at::text AS updated_at`,
      [
        projectId, label, input.unit ?? "", input.description ?? null,
        input.indicatorType ?? "process", input.origin ?? (actor.via === "dialogue" ? "dialogue" : "plan"),
        input.calcType ?? "manual", input.timeGranularity ?? "fiscal_year",
        input.dataSource ?? null, input.frequency ?? null, input.baseDay ?? null,
        input.goalId ?? null, input.contributesToId ?? null,
        input.previousValue ?? null, input.previousTarget ?? null, input.targetNeedsReview === true,
        JSON.stringify(input.spec ?? {}),
      ],
    );
    const created = r.rows[0]!;
    await logActivity(client, {
      projectId, actor, entity: "indicator", entityId: created.id, action: "create",
      summary: { label, unit: input.unit ?? "", origin: created.origin },
    });
    if (input.target) {
      await writeTarget(client, actor, projectId, created.id, input.target);
    }
    return created;
  });
}

export interface UpdateIndicatorInput {
  label?: string;
  unit?: string;
  description?: string | null;
  indicatorType?: string;
  calcType?: CalcType;
  spec?: Record<string, unknown>;
  timeGranularity?: "day" | "month" | "fiscal_year";
  dataSource?: string | null;
  frequency?: string | null;
  baseDay?: string | null;
  goalId?: string | null;
  contributesToId?: string | null;
  targetNeedsReview?: boolean;
  previousValue?: number | null;
  previousTarget?: number | null;
}

export async function updateIndicator(
  actor: Actor,
  projectId: string,
  indicatorId: string,
  patch: UpdateIndicatorInput,
): Promise<IndicatorRow> {
  return updateIndicatorTx(null, actor, projectId, indicatorId, patch);
}

/** 既に走っているトランザクションの中から更新する */
export async function updateIndicatorTx(
  client: PoolClient | null,
  actor: Actor,
  projectId: string,
  indicatorId: string,
  patch: UpdateIndicatorInput,
): Promise<IndicatorRow> {

  const map: Array<[keyof UpdateIndicatorInput, string]> = [
    ["label", "label"], ["unit", "unit"], ["description", "description"],
    ["indicatorType", "indicator_type"], ["calcType", "calc_type"], ["spec", "spec"],
    ["timeGranularity", "time_granularity"], ["dataSource", "data_source"],
    ["frequency", "frequency"], ["baseDay", "base_day"], ["goalId", "goal_id"],
    ["contributesToId", "contributes_to_kpi_id"], ["targetNeedsReview", "target_needs_review"],
    ["previousValue", "previous_value"], ["previousTarget", "previous_target"],
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of map) {
    if (patch[k] === undefined) continue;
    vals.push(k === "spec" ? JSON.stringify(patch[k]) : patch[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  sets.push("updated_at = now()");
  vals.push(indicatorId, projectId);

  return inTx(client, async (client) => {
    if (sets.length === 1) {
      const cur = await client.query<IndicatorRow>(
        `SELECT ${INDICATOR_COLS} FROM indicators i WHERE i.id = $1 AND i.project_id = $2`,
        [indicatorId, projectId],
      );
      if (cur.rowCount === 0) throw new IndicatorError("指標が見つかりません", 404);
      return cur.rows[0]!;
    }
    const r = await client.query<IndicatorRow>(
      `UPDATE indicators SET ${sets.join(", ")}
        WHERE id = $${vals.length - 1} AND project_id = $${vals.length}
       RETURNING id, project_id, label, unit, description, calc_type, spec, time_granularity,
                 data_source, frequency, base_day, origin, indicator_type, goal_id,
                 contributes_to_kpi_id, cloned_from_kpi_id, target_needs_review,
                 previous_value, previous_target, created_at::text AS created_at, updated_at::text AS updated_at`,
      vals,
    );
    if (r.rowCount === 0) throw new IndicatorError("指標が見つかりません", 404);
    await logActivity(client, {
      projectId, actor, entity: "indicator", entityId: indicatorId, action: "update",
      summary: { fields: Object.keys(patch) },
    });
    return r.rows[0]!;
  });
}

export async function deleteIndicator(actor: Actor, projectId: string, indicatorId: string): Promise<void> {
  const existing = await getIndicator(projectId, indicatorId);
  if (!existing) throw new IndicatorError("指標が見つかりません", 404);
  await transaction(async (client) => {
    // 目標・値は ON DELETE CASCADE で消える。履歴（activity_log）には残る
    await client.query(`DELETE FROM indicators WHERE id = $1 AND project_id = $2`, [indicatorId, projectId]);
    await logActivity(client, {
      projectId, actor, entity: "indicator", entityId: indicatorId, action: "delete",
      summary: { label: existing.label },
    });
  });
}

// ── 目標 ─────────────────────────────────────────────────────

async function writeTarget(
  client: PoolClient,
  actor: Actor,
  projectId: string,
  indicatorId: string,
  input: SetTargetInput,
): Promise<IndicatorTargetRow> {
  const r = await client.query<IndicatorTargetRow>(
    `INSERT INTO indicator_targets
       (indicator_id, scope, measure_design_id, measure_work_id, baseline_value, baseline_as_of,
        target_value, achievement_condition, target_deadline, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (indicator_id, scope, measure_design_id, measure_work_id) DO UPDATE SET
       baseline_value = EXCLUDED.baseline_value, baseline_as_of = EXCLUDED.baseline_as_of,
       target_value = EXCLUDED.target_value, achievement_condition = EXCLUDED.achievement_condition,
       target_deadline = EXCLUDED.target_deadline, note = EXCLUDED.note, updated_at = now()
     RETURNING id, indicator_id, scope, measure_design_id, measure_work_id, baseline_value,
               baseline_as_of::text AS baseline_as_of, target_value, achievement_condition,
               target_deadline::text AS target_deadline, note`,
    [
      indicatorId, input.scope, input.measureDesignId ?? null, input.measureWorkId ?? null,
      input.baselineValue ?? null, input.baselineAsOf ?? null, input.targetValue ?? null,
      input.achievementCondition ?? "gte", input.targetDeadline ?? null, input.note ?? null,
    ],
  );
  await logActivity(client, {
    projectId, actor, entity: "indicator_target", entityId: r.rows[0]!.id, action: "update",
    summary: { indicator_id: indicatorId, scope: input.scope, target_value: input.targetValue ?? null },
  });
  return r.rows[0]!;
}

/** 目標を置く（同じスコープに既にあれば上書き） */
export async function setTarget(
  actor: Actor,
  projectId: string,
  indicatorId: string,
  input: SetTargetInput,
): Promise<IndicatorTargetRow> {
  return setTargetTx(null, actor, projectId, indicatorId, input);
}

/** 既に走っているトランザクションの中から目標を置く */
export async function setTargetTx(
  client: PoolClient | null,
  actor: Actor,
  projectId: string,
  indicatorId: string,
  input: SetTargetInput,
): Promise<IndicatorTargetRow> {
  validateTarget(input);
  return inTx(client, async (c) => {
    const ind = await c.query(`SELECT id FROM indicators WHERE id = $1 AND project_id = $2`, [indicatorId, projectId]);
    if (ind.rowCount === 0) throw new IndicatorError("指標が見つかりません", 404);
    return writeTarget(c, actor, projectId, indicatorId, input);
  });
}

// ── 値の記録 ─────────────────────────────────────────────────

export interface RecordValueInput {
  /** いつ時点の値か（計算・入力した日ではない） */
  asOf: string;
  scope?: TargetScope;
  measureDesignId?: string | null;
  measureWorkId?: string | null;
  cohortId?: string | null;
  arm?: string | null;
  value?: number | null;
  valueText?: string | null;
  numerator?: number | null;
  denominator?: number | null;
  n?: number | null;
  /** 使った版など。手入力なら空 */
  inputs?: Record<string, unknown>;
  note?: string | null;
}

/**
 * 値を履歴に1行積む。
 * **同じ as_of で再計算しても上書きしない**（新しい版が上がって値が変わったことを追えるように）。
 * 手入力も同じ形で積む（`current` という上書きされる1列は無い）。
 */
export async function recordValue(
  actor: Actor,
  projectId: string,
  indicatorId: string,
  input: RecordValueInput,
): Promise<IndicatorValueRow> {
  return recordValueTx(null, actor, projectId, indicatorId, input);
}

/** 既に走っているトランザクションの中から値を積む */
export async function recordValueTx(
  client: PoolClient | null,
  actor: Actor,
  projectId: string,
  indicatorId: string,
  input: RecordValueInput,
): Promise<IndicatorValueRow> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new IndicatorError("基準日は YYYY-MM-DD で指定してください");
  if (input.value === undefined && input.valueText === undefined) throw new IndicatorError("値が必要です");
  const scope = input.scope ?? "plan";
  if (scope === "measure" && !input.measureDesignId) throw new IndicatorError("主要施策の値には施策の指定が必要です");
  if (scope === "work" && !input.measureWorkId) throw new IndicatorError("取組の値には取組の指定が必要です");

  return inTx(client, async (client) => {
    const ind = await client.query(`SELECT id FROM indicators WHERE id = $1 AND project_id = $2`, [indicatorId, projectId]);
    if (ind.rowCount === 0) throw new IndicatorError("指標が見つかりません", 404);
    const r = await client.query<IndicatorValueRow>(
      `INSERT INTO indicator_values
         (indicator_id, as_of, scope, measure_design_id, measure_work_id, cohort_id, arm,
          value, value_text, numerator, denominator, n, inputs, note, actor, via, dialogue_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, indicator_id, as_of::text AS as_of, scope, measure_design_id, measure_work_id,
                 cohort_id, arm, value, value_text, numerator, denominator, n, inputs, note,
                 computed_at::text AS computed_at, actor, via`,
      [
        indicatorId, input.asOf, scope, input.measureDesignId ?? null, input.measureWorkId ?? null,
        input.cohortId ?? null, input.arm ?? null,
        input.value ?? null, input.valueText ?? null, input.numerator ?? null,
        input.denominator ?? null, input.n ?? null,
        JSON.stringify(input.inputs ?? {}), input.note ?? null,
        actor.userRoleId, actor.via, actor.dialogueRef ? JSON.stringify(actor.dialogueRef) : null,
      ],
    );
    await logActivity(client, {
      projectId, actor, entity: "indicator_value", entityId: r.rows[0]!.id, action: "compute",
      summary: { indicator_id: indicatorId, as_of: input.asOf, scope, value: input.value ?? null },
    });
    return r.rows[0]!;
  });
}

// ── 施策・取組への割当（measure_indicators） ─────────────────

/**
 * 施策・取組の指標に、指標の実体を割り当てる。
 * `measure_indicators` は「どの施策・取組で・どのカテゴリか」だけを持つ割当表。
 */
export async function assignToMeasure(
  actor: Actor,
  projectId: string,
  measureIndicatorId: string,
  indicatorId: string,
): Promise<void> {
  const ind = await getIndicator(projectId, indicatorId);
  if (!ind) throw new IndicatorError("指標が見つかりません", 404);
  await transaction(async (client) => {
    const r = await client.query(
      `UPDATE measure_indicators SET indicator_id = $1, updated_at = now()
        WHERE id = $2 AND project_id = $3`,
      [indicatorId, measureIndicatorId, projectId],
    );
    if (r.rowCount === 0) throw new IndicatorError("割当先が見つかりません", 404);
    await logActivity(client, {
      projectId, actor, entity: "indicator", entityId: indicatorId, action: "update",
      summary: { assigned_to_measure_indicator: measureIndicatorId },
    });
  });
}

// ── 算出（指標エンジンを呼んで、結果を履歴に積む） ─────────

export interface ComputeAndRecordOk {
  ok: true;
  indicatorId: string;
  label: string;
  value: number;
  valueRow: IndicatorValueRow;
}
export interface ComputeAndRecordNg {
  ok: false;
  indicatorId: string;
  label: string;
  /** 何をいつ時点で上げてほしいか（構造。画面も AI も同じものを読む。設計 §9-5） */
  missing: Missing[];
}
export type ComputeAndRecordResult = ComputeAndRecordOk | ComputeAndRecordNg;

/**
 * 「最新値の確認」— 指標を1つ計算して、値を履歴に1行積む。
 *
 * **計算（engine）と記録（recordValue）を分けている。** 画面の「確認」ボタン・一括取得・
 * ギャップ分析・AI の対話は、どれもこの関数を呼ぶので、残るものが同じ形になる（設計 §10-5）。
 * 手入力型（manual）は計算しない — 人が入れるものなので、そのまま返す。
 */
export async function computeAndRecord(
  actor: Actor,
  projectId: string,
  indicatorId: string,
  asOf: string,
  opts: { scope?: TargetScope; measureDesignId?: string | null; measureWorkId?: string | null } = {},
): Promise<ComputeAndRecordResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new IndicatorError("基準日は YYYY-MM-DD で指定してください");
  const ind = await getIndicator(projectId, indicatorId);
  if (!ind) throw new IndicatorError("指標が見つかりません", 404);
  if (ind.calc_type === "manual") {
    throw new IndicatorError("この指標は手入力です。値を直接入力してください", 400);
  }
  const errs = validateSpec(ind.spec);
  if (errs.length > 0) throw new IndicatorError(`指標の設定が未完成です: ${errs[0]}`, 400);

  const result = await computeIndicator(projectId, ind.spec as unknown as IndicatorSpec, asOf);
  if (!result.ok) {
    return { ok: false, indicatorId, label: ind.label, missing: result.missing };
  }
  const valueRow = await recordValue(actor, projectId, indicatorId, {
    asOf,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.measureDesignId !== undefined ? { measureDesignId: opts.measureDesignId } : {}),
    ...(opts.measureWorkId !== undefined ? { measureWorkId: opts.measureWorkId } : {}),
    value: result.value,
    numerator: result.numerator,
    denominator: result.denominator,
    n: result.n,
    inputs: result.inputs as unknown as Record<string, unknown>,
  });
  return { ok: true, indicatorId, label: ind.label, value: result.value, valueRow };
}

/**
 * 一括取得。指標を順に計算し、**成功した分だけ履歴に積む**（失敗は不足として返す）。
 * 計算式型は他の指標の値に依存するので、**それ以外を先に**計算する。
 */
export async function computeMany(
  actor: Actor,
  projectId: string,
  indicatorIds: string[],
  asOf: string,
): Promise<ComputeAndRecordResult[]> {
  const rows = await query<{ id: string; calc_type: CalcType }>(
    `SELECT id, calc_type FROM indicators WHERE project_id = $1 AND id = ANY($2::uuid[])`,
    [projectId, indicatorIds],
  );
  const order = [...rows].sort((a, b) => Number(a.calc_type === "formula") - Number(b.calc_type === "formula"));
  const out: ComputeAndRecordResult[] = [];
  for (const r of order) {
    try {
      out.push(await computeAndRecord(actor, projectId, r.id, asOf));
    } catch (e) {
      const ind = await getIndicator(projectId, r.id);
      out.push({
        ok: false, indicatorId: r.id, label: ind?.label ?? "",
        missing: [{ reason: "dependency_missing", indicatorId: r.id, neededAsOf: asOf,
          ...(e instanceof IndicatorError ? { indicatorLabel: e.message } : {}) }],
      });
    }
  }
  return out;
}
