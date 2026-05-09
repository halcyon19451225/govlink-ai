export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

interface KpiRow { target: number; current: number }
interface EvidenceRow { strength: number }
interface ScheduleRow { total_tasks: number; completed_tasks: number }
interface DocumentRow { count: number; required: number }

export async function GET(
  _req: NextRequest, // eslint-disable-line @typescript-eslint/no-unused-vars
  { params }: { params: { projectId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const { projectId } = params;

  const [kpis, evidences, scheduleRows, docRows] = await Promise.all([
    query<KpiRow>(
      `SELECT target::float AS target, current::float AS current
       FROM kpis WHERE project_id = $1`,
      [projectId],
    ),
    query<EvidenceRow>(
      `SELECT strength FROM evidences WHERE project_id = $1`,
      [projectId],
    ),
    query<ScheduleRow>(
      `SELECT COUNT(id)::int AS total_tasks,
              COUNT(completed_at)::int AS completed_tasks
       FROM schedule_tasks WHERE project_id = $1`,
      [projectId],
    ),
    query<DocumentRow>(
      `SELECT
         (SELECT COUNT(id)::int FROM documents WHERE project_id = $1) AS count,
         GREATEST(
           (SELECT COUNT(id)::int FROM schedule_tasks WHERE project_id = $1 AND document_required = true),
           1
         ) AS required`,
      [projectId],
    ),
  ]);

  // evidence_score: (エビデンス数 / KPI数) × 強度平均 × 20、MAX 100
  const kpiCount = kpis.length || 1;
  const evidenceCount = evidences.length;
  const avgStrength =
    evidenceCount > 0
      ? evidences.reduce((s, e) => s + e.strength, 0) / evidenceCount
      : 0;
  const evidence_score = Math.min(100, (evidenceCount / kpiCount) * avgStrength * 20);

  // kpi_score: 各KPIの達成率平均、MAX 100
  const kpi_score =
    kpis.length === 0
      ? 0
      : Math.min(
          100,
          kpis.reduce((s, k) => s + (k.target > 0 ? (k.current / k.target) * 100 : 0), 0) /
            kpis.length,
        );

  // schedule_score: 完了タスク / 全タスク × 100、MAX 100
  const sched = scheduleRows[0] ?? { total_tasks: 0, completed_tasks: 0 };
  const schedule_score =
    sched.total_tasks === 0 ? 0 : (sched.completed_tasks / sched.total_tasks) * 100;

  // document_score: アップロード済み / 必要数 × 100、MAX 100
  const doc = docRows[0] ?? { count: 0, required: 1 };
  const document_score = Math.min(100, (doc.count / doc.required) * 100);

  // total_score: 加重平均 (evidence:30%, kpi:40%, schedule:20%, document:10%)
  const total_score =
    evidence_score * 0.3 +
    kpi_score * 0.4 +
    schedule_score * 0.2 +
    document_score * 0.1;

  return NextResponse.json({
    data: {
      evidence_score: Math.round(evidence_score),
      kpi_score: Math.round(kpi_score),
      schedule_score: Math.round(schedule_score),
      document_score: Math.round(document_score),
      total_score: Math.round(total_score),
    },
    error: null,
  });
}
