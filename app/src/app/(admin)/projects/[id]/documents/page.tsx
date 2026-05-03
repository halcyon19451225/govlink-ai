import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import BackButton from "@/components/BackButton";
import DocumentsClient from "./DocumentsClient";
import PdcaNav from "@/components/PdcaNav";

interface ProjectRow {
  id: string;
  title: string;
}

interface TaskRow {
  id: string;
  title: string;
}

export default async function DocumentsPage({ params }: { params: { id: string } }) {
  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const tasks = await query<TaskRow>(
    `SELECT id, title FROM schedule_tasks WHERE project_id = $1 ORDER BY due_date NULLS LAST`,
    [params.id],
  );

  return (
    <div className="max-w-4xl">
      <PdcaNav currentStage="D" currentStep="ドキュメント管理" projectId={project.id} />
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">ドキュメント管理</h2>
      </div>
      <DocumentsClient projectId={project.id} tasks={tasks} />
    </div>
  );
}
