import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import EvidencesClient from "./EvidencesClient";
import { assertProjectPage } from "@/lib/tenant-page";

interface ProjectRow {
  id: string;
  title: string;
}

interface KpiRow {
  id: string;
  label: string;
}

interface DocumentRow {
  id: string;
  title: string;
}

export default async function EvidencesPage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const [kpis, documents] = await Promise.all([
    query<KpiRow>(
      "SELECT id, label FROM kpis WHERE project_id = $1 ORDER BY created_at",
      [params.id],
    ),
    query<DocumentRow>(
      "SELECT id, title FROM documents WHERE project_id = $1 ORDER BY uploaded_at DESC",
      [params.id],
    ),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">エビデンス管理</h2>
      </div>
      <EvidencesClient projectId={project.id} kpis={kpis} documents={documents} />
    </div>
  );
}
