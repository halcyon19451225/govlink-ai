import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import ScheduleClient, { PhaseRow, TaskRow } from "./ScheduleClient";
import BackButton from "@/components/BackButton";

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

  const [kpis, phases, tasks] = await Promise.all([
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
              completed_at::text AS completed_at
       FROM schedule_tasks
       WHERE project_id = $1
       ORDER BY due_date NULLS LAST`,
      [params.id],
    ),
  ]);

  return (
    <div>
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-100">スケジュール管理</h2>
      </div>

      <ScheduleClient
        projectId={project.id}
        projectTitle={project.title}
        projectDescription={project.description}
        kpis={kpis}
        phases={phases}
        tasks={tasks}
      />
    </div>
  );
}
