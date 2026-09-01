export const dynamic = "force-dynamic";

/**
 * 施策データセットの拡張部（migration 057）— 取組・アクティビティ・指標・年度別コスト。
 *
 * GET   … 一式を返す（画面はこれ1本で描ける）
 * POST  … { action: "seed" } で前工程から下書きを起こす（空いているところだけ埋める）
 * PATCH … 区画ごとの丸ごと差し替え。担当者はどの項目も後から編集できる
 *
 * 指標は別紙「プログラム評価指標一覧」の17カテゴリ。
 * 必須は評価フローが止まるものだけで、残りは未設定でも次の工程へ進める。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import {
  buildAutoFill,
  datasetGaps,
  datasetReady,
  nextWorkCode,
  type AutoFillSource,
  type MeasureActivity,
  type MeasureCheckpoint,
  type MeasureCostItem,
  type MeasureCostYear,
  type MeasureDataset,
  type MeasureIndicatorRow,
  type MeasureWork,
} from "@/lib/measure/dataset";
import { fundingMismatchYears } from "@/lib/measure/indicators";
import { normalizeMeasure } from "@/lib/measure/types";

type Params = { params: { id: string; measureId: string } };

// ─── 読み出し ──────────────────────────────────────────

async function loadDataset(projectId: string, measureId: string): Promise<MeasureDataset> {
  const [works, activities, indicators, checkpoints, costYears, costItems] = await Promise.all([
    query<MeasureWork>(
      `SELECT id, measure_design_id, code, title, summary, target, method,
              owner_department, retired, retired_reason, sort_order
         FROM measure_works
        WHERE project_id = $1 AND measure_design_id = $2
        ORDER BY sort_order, code`,
      [projectId, measureId],
    ),
    query<MeasureActivity>(
      `SELECT a.id, a.measure_work_id, a.title, a.note,
              to_char(a.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(a.due_date, 'YYYY-MM-DD') AS due_date,
              a.recurrence, a.occurrences, a.owner_department,
              a.document_required,
              to_char(a.document_deadline, 'YYYY-MM-DD') AS document_deadline,
              a.document_offset_days, a.sort_order,
              (SELECT count(*)::int FROM measure_activity_tasks t
                WHERE t.measure_activity_id = a.id) AS task_count
         FROM measure_activities a
         JOIN measure_works w ON w.id = a.measure_work_id
        WHERE a.project_id = $1 AND w.measure_design_id = $2
        ORDER BY a.sort_order, a.title`,
      [projectId, measureId],
    ),
    query<Omit<MeasureIndicatorRow, "checkpoints">>(
      `SELECT id, measure_design_id, measure_work_id, category_no, label, definition, unit,
              baseline_value::float AS baseline_value,
              to_char(baseline_date, 'YYYY-MM-DD') AS baseline_date,
              target_value::float AS target_value,
              achievement_condition, data_source, frequency, base_day,
              kpi_id, requirement, auto_filled, sort_order
         FROM measure_indicators
        WHERE project_id = $1 AND measure_design_id = $2
        ORDER BY sort_order, category_no`,
      [projectId, measureId],
    ),
    query<MeasureCheckpoint>(
      `SELECT c.id, c.measure_indicator_id, c.label, c.relative_year, c.relative_period,
              to_char(c.absolute_date, 'YYYY-MM-DD') AS absolute_date,
              c.evaluation_type, c.owner_department, c.sort_order
         FROM measure_indicator_checkpoints c
         JOIN measure_indicators i ON i.id = c.measure_indicator_id
        WHERE i.project_id = $1 AND i.measure_design_id = $2
        ORDER BY c.sort_order`,
      [projectId, measureId],
    ),
    query<MeasureCostYear>(
      `SELECT id, measure_design_id, fiscal_year,
              total_amount::float AS total_amount, funding, note
         FROM measure_cost_years
        WHERE measure_design_id = $1
        ORDER BY fiscal_year`,
      [measureId],
    ),
    query<MeasureCostItem>(
      `SELECT id, measure_design_id, item, basis, amounts, sort_order
         FROM measure_cost_items
        WHERE measure_design_id = $1
        ORDER BY sort_order, item`,
      [measureId],
    ),
  ]);

  const byIndicator = new Map<string, MeasureCheckpoint[]>();
  for (const c of checkpoints) {
    const list = byIndicator.get(c.measure_indicator_id);
    if (list) list.push(c);
    else byIndicator.set(c.measure_indicator_id, [c]);
  }

  return {
    works,
    activities,
    indicators: indicators.map((i) => ({ ...i, checkpoints: byIndicator.get(i.id) ?? [] })),
    costYears,
    costItems,
  };
}

async function respond(projectId: string, measureId: string, title: string) {
  const dataset = await loadDataset(projectId, measureId);
  const gaps = datasetGaps(dataset, title, fundingMismatchYears);
  return NextResponse.json({
    data: { ...dataset, gaps, ready: datasetReady(gaps) },
    error: null,
  });
}

async function loadMeasure(projectId: string, measureId: string) {
  return queryOne<{
    id: string;
    title: string;
    owner_department: string | null;
    measure_dialogue_id: string | null;
    period_start: string | null;
    period_end: string | null;
  }>(
    `SELECT id, title, owner_department, measure_dialogue_id,
            to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end
       FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [measureId, projectId],
  );
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const measure = await loadMeasure(params.id, params.measureId);
  if (!measure) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }
  return respond(params.id, params.measureId, measure.title);
}

// ─── 下書きの生成 ────────────────────────────────────────

/**
 * 年度は「4月始まり」で数える。3月までは前年度なので1を引く。
 * 会計年度が異なる計画に当たったら、ここを計画側の設定から取るようにする。
 */
function fiscalYearOf(date: string | null, fallback: number): number {
  if (!date) return fallback;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const raw = await req.json().catch(() => null);
  if (!raw || (raw as { action?: string }).action !== "seed") {
    return NextResponse.json({ data: null, error: "action は seed のみです" }, { status: 400 });
  }

  const measureRow = await queryOne<Record<string, unknown>>(
    `SELECT * FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [params.measureId, params.id],
  );
  if (!measureRow) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }
  const measure = normalizeMeasure(measureRow);

  // 既にある分は触らない。空のときだけ下書きを起こす
  const current = await loadDataset(params.id, params.measureId);
  if (current.works.length > 0) {
    return NextResponse.json(
      { data: null, error: "すでに取組が登録されています。下書きの生成は最初の1回だけです" },
      { status: 409 },
    );
  }

  // 対話側の材料（同じアプローチから書き出されたもの）
  const dlg = measure.measure_dialogue_id
    ? await queryOne<{
        approaches: unknown;
        experiments: unknown;
        indicators: unknown;
        costs: unknown;
      }>(
        `SELECT approaches, experiments, indicators, costs
           FROM measure_dialogues WHERE id = $1 AND project_id = $2`,
        [measure.measure_dialogue_id, params.id],
      )
    : null;

  const approaches = (dlg?.approaches as AutoFillSource["approach"][] | undefined) ?? [];
  const approach =
    approaches.find((a) => (a as { measure_design_id?: string }).measure_design_id === params.measureId) ??
    approaches[0] ??
    null;
  if (!approach) {
    return NextResponse.json(
      { data: null, error: "元になったアプローチが見つかりません。取組は手で追加してください" },
      { status: 422 },
    );
  }
  const pick = <T,>(arr: unknown, id: string): T | null =>
    Array.isArray(arr)
      ? ((arr as { approach_id?: string }[]).find((x) => x.approach_id === id) as T | undefined) ?? null
      : null;

  // ギャップ分析の指標（長期アウトカムの種）
  const kpi = await queryOne<{
    id: string;
    label: string;
    unit: string | null;
    current: number | null;
    target: number | null;
  }>(
    `SELECT k.id, k.label, k.unit, k.current::float AS current, k.target::float AS target
       FROM kpis k
       JOIN issue_hypotheses h ON h.id = $1
       JOIN issue_dialogues d ON d.id = h.issue_dialogue_id AND d.kpi_id = k.id
      WHERE k.project_id = $2
      LIMIT 1`,
    [measure.issue_hypothesis_id, params.id],
  ).catch(() => null);

  const thisYear = new Date().getUTCMonth() + 1 >= 4
    ? new Date().getUTCFullYear()
    : new Date().getUTCFullYear() - 1;
  const startYear = fiscalYearOf(measure.period_start, thisYear);
  const endYear = Math.max(startYear, fiscalYearOf(measure.period_end, startYear + 2));

  const draft = buildAutoFill({
    approach,
    experiment: measure.experiment,
    dialogueIndicators: pick(dlg?.indicators, approach.id),
    cost: pick(dlg?.costs, approach.id),
    kpi,
    planStartYear: startYear,
    planEndYear: endYear,
    ownerDepartment: measure.owner_department,
  });

  await transaction(async (client) => {
    const codeToId = new Map<string, string>();
    for (const w of draft.works) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO measure_works
           (project_id, measure_design_id, code, title, summary, target, method, owner_department, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [params.id, params.measureId, w.code, w.title, w.summary, w.target, w.method, w.owner_department, w.sort_order],
      );
      codeToId.set(w.code, res.rows[0]!.id);
    }

    for (const i of draft.indicators) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO measure_indicators
           (project_id, measure_design_id, measure_work_id, category_no, label, definition, unit,
            baseline_value, baseline_date, target_value, achievement_condition, data_source,
            frequency, base_day, kpi_id, requirement, auto_filled, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          params.id, params.measureId,
          i.work_code ? codeToId.get(i.work_code) ?? null : null,
          i.category_no, i.label, i.definition, i.unit,
          i.baseline_value, i.baseline_date, i.target_value, i.achievement_condition,
          i.data_source, i.frequency, i.base_day, i.kpi_id, i.requirement, i.auto_filled, i.sort_order,
        ],
      );
      for (const c of i.checkpoints) {
        await client.query(
          `INSERT INTO measure_indicator_checkpoints
             (measure_indicator_id, label, relative_year, relative_period, absolute_date,
              evaluation_type, owner_department, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [res.rows[0]!.id, c.label, c.relative_year, c.relative_period, c.absolute_date,
           c.evaluation_type, c.owner_department, c.sort_order],
        );
      }
    }

    for (const y of draft.costYears) {
      await client.query(
        `INSERT INTO measure_cost_years (measure_design_id, fiscal_year, total_amount, funding, note)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT (measure_design_id, fiscal_year) DO NOTHING`,
        [params.measureId, y.fiscal_year, y.total_amount, JSON.stringify(y.funding), y.note],
      );
    }
    for (const it of draft.costItems) {
      await client.query(
        `INSERT INTO measure_cost_items (measure_design_id, item, basis, amounts, sort_order)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [params.measureId, it.item, it.basis, JSON.stringify(it.amounts), it.sort_order],
      );
    }
  });

  return respond(params.id, params.measureId, measure.title);
}

// ─── 編集 ────────────────────────────────────────────

const workSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().max(20).optional(),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).nullish(),
  target: z.string().max(500).nullish(),
  method: z.string().max(200).nullish(),
  owner_department: z.string().max(100).nullish(),
  retired: z.boolean().optional(),
  retired_reason: z.string().max(300).nullish(),
  sort_order: z.number().int().optional(),
});

const activitySchema = z.object({
  id: z.string().uuid().optional(),
  measure_work_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  note: z.string().max(1000).nullish(),
  start_date: z.string().nullish(),
  due_date: z.string().nullish(),
  recurrence: z.enum(["none", "monthly", "quarterly", "semiannual", "annual"]).optional(),
  occurrences: z.number().int().min(1).max(60).nullish(),
  owner_department: z.string().max(100).nullish(),
  document_required: z.boolean().optional(),
  document_deadline: z.string().nullish(),
  document_offset_days: z.number().int().min(0).max(365).nullish(),
  sort_order: z.number().int().optional(),
});

const checkpointSchema = z.object({
  label: z.string().min(1).max(100),
  relative_year: z.number().int().min(1).max(30).nullish(),
  relative_period: z.enum(["first", "second", "end"]).nullish(),
  absolute_date: z.string().nullish(),
  evaluation_type: z.enum(["needs", "theory", "process", "outcome", "impact", "cost"]).nullish(),
  owner_department: z.string().max(100).nullish(),
});

const indicatorSchema = z.object({
  id: z.string().uuid().optional(),
  measure_work_id: z.string().uuid().nullish(),
  category_no: z.number().int().min(1).max(17),
  label: z.string().max(200),
  definition: z.string().max(1000).nullish(),
  unit: z.string().max(50).nullish(),
  baseline_value: z.number().nullish(),
  baseline_date: z.string().nullish(),
  target_value: z.number().nullish(),
  achievement_condition: z.enum(["lte", "lt", "gte", "gt", "eq"]).optional(),
  data_source: z.string().max(500).nullish(),
  frequency: z
    .enum(["monthly", "quarterly", "semiannual", "annual", "plan_period", "once", "adhoc"])
    .optional(),
  base_day: z.string().max(100).nullish(),
  kpi_id: z.string().uuid().nullish(),
  requirement: z.enum(["required", "recommended", "optional"]).optional(),
  sort_order: z.number().int().optional(),
  checkpoints: z.array(checkpointSchema).max(12).optional(),
});

const costYearSchema = z.object({
  fiscal_year: z.number().int().min(2000).max(2100),
  total_amount: z.number().nullish(),
  funding: z.record(z.string(), z.number().nullable()).optional(),
  note: z.string().max(500).nullish(),
});

const costItemSchema = z.object({
  item: z.string().min(1).max(60),
  basis: z.string().max(500).nullish(),
  amounts: z.record(z.string(), z.number()).optional(),
  sort_order: z.number().int().optional(),
});

const patchSchema = z.object({
  works: z.array(workSchema).max(30).optional(),
  activities: z.array(activitySchema).max(200).optional(),
  indicators: z.array(indicatorSchema).max(200).optional(),
  cost_years: z.array(costYearSchema).max(30).optional(),
  cost_items: z.array(costItemSchema).max(40).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const measure = await loadMeasure(params.id, params.measureId);
  if (!measure) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }
  const d = parsed.data;

  await transaction(async (client) => {
    if (d.works) {
      const existing = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM measure_works WHERE measure_design_id = $1`,
        [params.measureId],
      );
      const keep = new Set(d.works.map((w) => w.id).filter(Boolean) as string[]);
      // 送られてこなかった取組は取り下げ扱いにする。行は消さない
      // （指標・アクティビティが measure_work_id で参照しているため）
      for (const row of existing.rows) {
        if (!keep.has(row.id)) {
          await client.query(
            `UPDATE measure_works SET retired = true, updated_at = now() WHERE id = $1`,
            [row.id],
          );
        }
      }
      let codes = existing.rows.map((r) => ({ code: r.code })) as { code: string }[];
      for (let i = 0; i < d.works.length; i++) {
        const w = d.works[i]!;
        if (w.id) {
          await client.query(
            `UPDATE measure_works
                SET title=$2, summary=$3, target=$4, method=$5, owner_department=$6,
                    retired=COALESCE($7, retired), retired_reason=$8,
                    sort_order=$9, updated_at=now()
              WHERE id=$1 AND measure_design_id=$10`,
            [w.id, w.title, w.summary ?? null, w.target ?? null, w.method ?? null,
             w.owner_department ?? null, w.retired ?? null, w.retired_reason ?? null,
             w.sort_order ?? i, params.measureId],
          );
        } else {
          const code = w.code ?? nextWorkCode(codes as never);
          codes = [...codes, { code }];
          await client.query(
            `INSERT INTO measure_works
               (project_id, measure_design_id, code, title, summary, target, method, owner_department, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [params.id, params.measureId, code, w.title, w.summary ?? null, w.target ?? null,
             w.method ?? null, w.owner_department ?? null, w.sort_order ?? i],
          );
        }
      }
    }

    if (d.activities) {
      const workIds = await client.query<{ id: string }>(
        `SELECT id FROM measure_works WHERE measure_design_id = $1`,
        [params.measureId],
      );
      const valid = new Set(workIds.rows.map((r) => r.id));
      const rows = d.activities.filter((a) => valid.has(a.measure_work_id));
      const keep = new Set(rows.map((a) => a.id).filter(Boolean) as string[]);
      const existing = await client.query<{ id: string }>(
        `SELECT a.id FROM measure_activities a
           JOIN measure_works w ON w.id = a.measure_work_id
          WHERE w.measure_design_id = $1`,
        [params.measureId],
      );
      for (const row of existing.rows) {
        // アクティビティは取組と違い参照が無いので、消してよい
        if (!keep.has(row.id)) {
          await client.query(`DELETE FROM measure_activities WHERE id = $1`, [row.id]);
        }
      }
      for (let i = 0; i < rows.length; i++) {
        const a = rows[i]!;
        const args = [
          a.measure_work_id, a.title, a.note ?? null, a.start_date ?? null, a.due_date ?? null,
          a.recurrence ?? "none", a.occurrences ?? null, a.owner_department ?? null,
          a.document_required ?? false, a.document_deadline ?? null,
          a.document_offset_days ?? null, a.sort_order ?? i,
        ];
        if (a.id) {
          await client.query(
            `UPDATE measure_activities
                SET measure_work_id=$2, title=$3, note=$4, start_date=$5, due_date=$6,
                    recurrence=$7, occurrences=$8, owner_department=$9,
                    document_required=$10, document_deadline=$11, document_offset_days=$12,
                    sort_order=$13, updated_at=now()
              WHERE id=$1`,
            [a.id, ...args],
          );
        } else {
          await client.query(
            `INSERT INTO measure_activities
               (project_id, measure_work_id, title, note, start_date, due_date, recurrence,
                occurrences, owner_department, document_required, document_deadline,
                document_offset_days, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [params.id, ...args],
          );
        }
      }
    }

    if (d.indicators) {
      const keep = new Set(d.indicators.map((i) => i.id).filter(Boolean) as string[]);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM measure_indicators WHERE measure_design_id = $1`,
        [params.measureId],
      );
      for (const row of existing.rows) {
        if (!keep.has(row.id)) {
          await client.query(`DELETE FROM measure_indicators WHERE id = $1`, [row.id]);
        }
      }
      for (let n = 0; n < d.indicators.length; n++) {
        const i = d.indicators[n]!;
        const args = [
          i.measure_work_id ?? null, i.category_no, i.label, i.definition ?? null, i.unit ?? null,
          i.baseline_value ?? null, i.baseline_date ?? null, i.target_value ?? null,
          i.achievement_condition ?? "gte", i.data_source ?? null, i.frequency ?? "annual",
          i.base_day ?? null, i.kpi_id ?? null, i.requirement ?? "optional", i.sort_order ?? n,
        ];
        let id = i.id ?? null;
        if (id) {
          await client.query(
            `UPDATE measure_indicators
                SET measure_work_id=$2, category_no=$3, label=$4, definition=$5, unit=$6,
                    baseline_value=$7, baseline_date=$8, target_value=$9,
                    achievement_condition=$10, data_source=$11, frequency=$12, base_day=$13,
                    kpi_id=$14, requirement=$15, sort_order=$16,
                    auto_filled=false, updated_at=now()
              WHERE id=$1`,
            [id, ...args],
          );
        } else {
          const res = await client.query<{ id: string }>(
            `INSERT INTO measure_indicators
               (project_id, measure_design_id, measure_work_id, category_no, label, definition, unit,
                baseline_value, baseline_date, target_value, achievement_condition, data_source,
                frequency, base_day, kpi_id, requirement, sort_order, auto_filled)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false)
             RETURNING id`,
            [params.id, params.measureId, ...args],
          );
          id = res.rows[0]!.id;
        }
        if (i.checkpoints) {
          await client.query(
            `DELETE FROM measure_indicator_checkpoints WHERE measure_indicator_id = $1`,
            [id],
          );
          for (let k = 0; k < i.checkpoints.length; k++) {
            const c = i.checkpoints[k]!;
            await client.query(
              `INSERT INTO measure_indicator_checkpoints
                 (measure_indicator_id, label, relative_year, relative_period, absolute_date,
                  evaluation_type, owner_department, sort_order)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [id, c.label, c.relative_year ?? null, c.relative_period ?? null,
               c.absolute_date ?? null, c.evaluation_type ?? null, c.owner_department ?? null, k],
            );
          }
        }
      }
    }

    if (d.cost_years) {
      const keep = new Set(d.cost_years.map((y) => y.fiscal_year));
      await client.query(
        `DELETE FROM measure_cost_years
          WHERE measure_design_id = $1 AND NOT (fiscal_year = ANY($2::int[]))`,
        [params.measureId, Array.from(keep)],
      );
      for (const y of d.cost_years) {
        await client.query(
          `INSERT INTO measure_cost_years (measure_design_id, fiscal_year, total_amount, funding, note)
           VALUES ($1,$2,$3,$4::jsonb,$5)
           ON CONFLICT (measure_design_id, fiscal_year)
           DO UPDATE SET total_amount = EXCLUDED.total_amount,
                         funding = EXCLUDED.funding,
                         note = EXCLUDED.note,
                         updated_at = now()`,
          [params.measureId, y.fiscal_year, y.total_amount ?? null,
           JSON.stringify(y.funding ?? {}), y.note ?? null],
        );
      }
    }

    if (d.cost_items) {
      await client.query(`DELETE FROM measure_cost_items WHERE measure_design_id = $1`, [
        params.measureId,
      ]);
      for (let i = 0; i < d.cost_items.length; i++) {
        const it = d.cost_items[i]!;
        await client.query(
          `INSERT INTO measure_cost_items (measure_design_id, item, basis, amounts, sort_order)
           VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [params.measureId, it.item, it.basis ?? null, JSON.stringify(it.amounts ?? {}), it.sort_order ?? i],
        );
      }
    }
  });

  return respond(params.id, params.measureId, measure.title);
}
