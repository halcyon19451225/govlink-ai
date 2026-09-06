import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import DocumentsClient from "./DocumentsClient";
import { assertProjectPage } from "@/lib/tenant-page";

interface ProjectRow {
  id: string;
  title: string;
}

interface TaskRow {
  id: string;
  title: string;
}

export default async function DocumentsPage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
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
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">ドキュメント管理</h2>
      </div>
      <DocumentsClient projectId={project.id} tasks={tasks} />
    </div>
  );
}
