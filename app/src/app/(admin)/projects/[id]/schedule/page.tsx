import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import ScheduleClient, { PhaseRow, TaskRow } from "./ScheduleClient";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
}

interface KpiRow {
  label: string;
  target: number;
  unit: string;
}

export interface PdcaCheckpointRow {
  id: string;
  checkpoint_name: string;
  scheduled_date: string;
  status: string;
  phase: string;
  cycle_name: string;
}

export default async function SchedulePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) notFound();

  const projects = await query<ProjectRow>(
    "SELECT id, title, description FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const [kpis, phases, tasks, pdcaCheckpoints, measures, improvementLinks, checkpointStats] = await Promise.all([
    query<KpiRow>(
      "SELECT label, target::float AS target, unit FROM kpis WHERE project_id = $1 ORDER BY created_at",
      [params.id],
    ),
    query<PhaseRow>(
      `SELECT id, phase, title,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date,   'YYYY-MM-DD') AS end_date,
              status
       FROM project_schedules
       WHERE project_id = $1
       ORDER BY start_date`,
      [params.id],
    ),
    query<TaskRow>(
      `SELECT id, schedule_id, title,
              to_char(due_date,          'YYYY-MM-DD') AS due_date,
              document_required,
              to_char(document_deadline, 'YYYY-MM-DD') AS document_deadline,
              gcal_event_id,
              completed_at::text AS completed_at,
              measure_design_id, owner_department
       FROM schedule_tasks
       WHERE project_id = $1
       ORDER BY due_date NULLS LAST`,
      [params.id],
    ),
    query<PdcaCheckpointRow>(
      `SELECT ppc.id,
              cpd.name AS checkpoint_name,
              to_char(ppc.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
              ppc.status,
              cyc.phase,
              cyc.name AS cycle_name
       FROM project_pdca_checkpoints ppc
       JOIN pdca_checkpoint_defs cpd ON cpd.id = ppc.checkpoint_def_id
       JOIN pdca_cycle_defs cyc      ON cyc.id = cpd.cycle_id
       WHERE ppc.project_id = $1
       ORDER BY ppc.scheduled_date`,
      [params.id],
    ).catch(() => [] as PdcaCheckpointRow[]),
    // 進捗ボードの施策軸（S1 D①）
    query<{ id: string; title: string; owner_department: string | null }>(
      `SELECT id, title, owner_department FROM measure_designs
       WHERE project_id = $1 ORDER BY sort_order, created_at LIMIT 50`,
      [params.id],
    ),
    // 改善アクション由来のタスク（🔧バッジ）
    query<{ reflect_schedule_task_id: string }>(
      `SELECT reflect_schedule_task_id FROM improvement_actions
       WHERE project_id = $1 AND reflect_schedule_task_id IS NOT NULL`,
      [params.id],
    ),
    // チェックポイント完了率（CA監査の残課題 — 日数経過率だけにしない）
    query<{ total: number; completed: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM project_pdca_checkpoints WHERE project_id = $1 AND status <> 'skipped'`,
      [params.id],
    ),
  ]);

  const improvementTaskIds = improvementLinks.map((r) => r.reflect_schedule_task_id);
  const ckpt = checkpointStats[0] ?? { total: 0, completed: 0 };

  return (
    <div>
      {/* ヘルプはレイアウトの AutoHelpButton（右下）が自動設置する — M3 */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-100">スケジュール管理</h2>
      </div>

      {pdcaCheckpoints.length > 0 && (
        <div className="mb-6 rounded-xl border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            PDCAチェックポイント
          </h3>
          <div className="space-y-2">
            {pdcaCheckpoints.map((cp) => (
              <div key={cp.id} className="flex items-center gap-3">
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono font-bold shrink-0 w-8 text-center"
                  style={{
                    background: cp.phase === "P" ? "#6366f118"
                      : cp.phase === "D" ? "#06b6d418"
                      : cp.phase === "C" || cp.phase === "C-A" ? "#f59e0b18"
                      : "#10b98118",
                    color: cp.phase === "P" ? "#818cf8"
                      : cp.phase === "D" ? "#22d3ee"
                      : cp.phase === "C" || cp.phase === "C-A" ? "#fbbf24"
                      : "#34d399",
                  }}
                >
                  {cp.phase}
                </span>
                <span className="text-xs text-slate-300 flex-1 truncate">{cp.checkpoint_name}</span>
                <span className="text-xs text-slate-500 shrink-0">{cp.scheduled_date}</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: cp.status === "completed" ? "#10b98115" : "#64748b12",
                    color: cp.status === "completed" ? "#34d399" : "#64748b",
                  }}
                >
                  {cp.status === "completed" ? "完了" : cp.status === "in_progress" ? "進行中" : "予定"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ScheduleClient
        projectId={project.id}
        projectTitle={project.title}
        projectDescription={project.description}
        kpis={kpis}
        phases={phases}
        tasks={tasks}
        measures={measures}
        improvementTaskIds={improvementTaskIds}
        checkpointStats={ckpt}
      />
    </div>
  );
}
