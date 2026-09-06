export const dynamic = "force-dynamic";

/**
 * アクティビティ（実施項目）をスケジュール設定のタスクへ反映する。
 *
 * GET  … 何件のタスクになるかの下見（押す前に見せる）
 * POST … 実際に schedule_tasks へ書き込む
 *
 * 反映は繰り返し実行できる。前回この施策から作ったタスクのうち、
 * **未完了のものだけ**を作り直し、担当者が完了にしたタスクは残す
 * （実績が消えると、指標No.5「アクティビティ指標」の分子が失われるため）。
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { planSchedule } from "@/lib/measure/schedule";
import type { MeasureActivity } from "@/lib/measure/dataset";

type Params = { params: { id: string; measureId: string } };

async function loadActivities(projectId: string, measureId: string) {
  return query<MeasureActivity>(
    `SELECT a.id, a.measure_work_id, a.title, a.note,
            to_char(a.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(a.due_date, 'YYYY-MM-DD') AS due_date,
            a.recurrence, a.occurrences, a.owner_department,
            a.document_required,
            to_char(a.document_deadline, 'YYYY-MM-DD') AS document_deadline,
            a.document_offset_days, a.sort_order, 0 AS task_count
       FROM measure_activities a
       JOIN measure_works w ON w.id = a.measure_work_id
      WHERE a.project_id = $1 AND w.measure_design_id = $2 AND w.retired = false
      ORDER BY a.sort_order, a.title`,
    [projectId, measureId],
  );
}

async function loadPlanYears(projectId: string, measureId: string): Promise<number> {
  const row = await queryOne<{ years: number | null }>(
    `SELECT GREATEST(1,
              EXTRACT(YEAR FROM age(COALESCE(period_end, period_start + interval '3 years'),
                                    period_start))::int)  AS years
       FROM measure_designs
      WHERE id = $1 AND project_id = $2 AND period_start IS NOT NULL`,
    [measureId, projectId],
  ).catch(() => null);
  return row?.years && row.years > 0 ? row.years : 3;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "view");
  if (deny) return deny;

  const [activities, planYears] = await Promise.all([
    loadActivities(params.id, params.measureId),
    loadPlanYears(params.id, params.measureId),
  ]);
  return NextResponse.json({ data: planSchedule(activities, planYears), error: null });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const measure = await queryOne<{ id: string; title: string }>(
    `SELECT id, title FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [params.measureId, params.id],
  );
  if (!measure) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }

  const [activities, planYears] = await Promise.all([
    loadActivities(params.id, params.measureId),
    loadPlanYears(params.id, params.measureId),
  ]);
  const plan = planSchedule(activities, planYears);
  if (plan.tasks.length === 0) {
    return NextResponse.json(
      {
        data: null,
        error:
          plan.skipped.length > 0
            ? `実施期限が設定されていないため反映できません（${plan.skipped.map((s) => s.title).join("、")}）`
            : "反映できる実施項目がありません",
      },
      { status: 422 },
    );
  }

  const result = await transaction(async (client) => {
    // 反映先のスケジュール。無ければ実施フェーズのものを1つ作る
    const found = await client.query<{ id: string }>(
      `SELECT id FROM project_schedules
        WHERE project_id = $1 AND phase = 'implementation'
        ORDER BY created_at LIMIT 1`,
      [params.id],
    );
    let scheduleId = found.rows[0]?.id ?? null;
    if (!scheduleId) {
      const dates = plan.tasks.map((t) => t.due_date).sort();
      const created = await client.query<{ id: string }>(
        `INSERT INTO project_schedules (project_id, phase, title, start_date, end_date, created_by_ai)
         VALUES ($1, 'implementation', $2, $3::date, $4::date, true) RETURNING id`,
        [params.id, "実施スケジュール", dates[0], dates[dates.length - 1]],
      );
      scheduleId = created.rows[0]!.id;
    }

    // 前回この施策から作った未完了タスクを消す（完了済みは実績なので残す）
    const linked = await client.query<{ task_id: string; completed_at: string | null }>(
      `SELECT t.id AS task_id, t.completed_at
         FROM measure_activity_tasks m
         JOIN schedule_tasks t ON t.id = m.schedule_task_id
         JOIN measure_activities a ON a.id = m.measure_activity_id
         JOIN measure_works w ON w.id = a.measure_work_id
        WHERE w.measure_design_id = $1`,
      [params.measureId],
    );
    const stale = linked.rows.filter((r) => r.completed_at == null).map((r) => r.task_id);
    if (stale.length > 0) {
      await client.query(`DELETE FROM schedule_tasks WHERE id = ANY($1::uuid[])`, [stale]);
    }
    const keptDates = new Set(
      linked.rows.filter((r) => r.completed_at != null).map((r) => r.task_id),
    );

    let created = 0;
    for (const t of plan.tasks) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO schedule_tasks
           (schedule_id, project_id, title, due_date, document_required, document_deadline,
            measure_design_id, owner_department)
         VALUES ($1,$2,$3,$4::date,$5,$6::date,$7,$8) RETURNING id`,
        [
          scheduleId, params.id, t.title, t.due_date, t.document_required,
          t.document_deadline, params.measureId, t.owner_department,
        ],
      );
      await client.query(
        `INSERT INTO measure_activity_tasks (measure_activity_id, schedule_task_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [t.activity_id, ins.rows[0]!.id],
      );
      created++;
    }

    return { created, kept: keptDates.size, schedule_id: scheduleId };
  });

  return NextResponse.json({
    data: { ...result, skipped: plan.skipped },
    error: null,
  });
}
