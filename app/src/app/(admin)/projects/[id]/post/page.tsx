import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import PostForm, { type KpiForForm } from "./PostForm";

interface ProjectRow {
  id: string;
  title: string;
}

export default async function PostReportPage({
  params,
}: {
  params: { id: string };
}) {
  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );

  const project = projects[0];
  if (!project) notFound();

  const kpis = await query<KpiForForm>(
    `SELECT id, label, target::float AS target, current::float AS current, unit
     FROM kpis WHERE project_id = $1 ORDER BY created_at`,
    [project.id],
  );

  return (
    <div>
      <PostForm
        projectId={project.id}
        projectTitle={project.title}
        kpis={kpis}
      />
    </div>
  );
}
