export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import BackButton from "@/components/BackButton";
import ProjectModuleNav from "@/components/ProjectModuleNav";
import ServiceVolumeClient from "./ServiceVolumeClient";

interface ServiceVolumePlan {
  id: string;
  project_id: string;
  checkpoint_id: string | null;
  service_name: string;
  service_category: string | null;
  fiscal_year: number;
  planned_cert_rate: number | null;
  planned_recep_rate: number | null;
  planned_unit_benefit: number | null;
  planned_users: number | null;
  planned_benefit: number | null;
  actual_cert_rate: number | null;
  actual_recep_rate: number | null;
  actual_unit_benefit: number | null;
  actual_users: number | null;
  actual_benefit: number | null;
  cert_deviation_pct: number | null;
  deviation_analysis: unknown;
  deviation_notes: string | null;
  ai_deviation_analysis: string | null;
  created_at: string;
}

interface CheckpointRow {
  id: string;
  name: string;
}

export default async function ServiceVolumePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) notFound();

  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [plans, checkpoints] = await Promise.all([
    query<ServiceVolumePlan>(
      `SELECT id, project_id, checkpoint_id, service_name, service_category, fiscal_year,
              planned_cert_rate::float, planned_recep_rate::float, planned_unit_benefit::float,
              planned_users, planned_benefit::float,
              actual_cert_rate::float, actual_recep_rate::float, actual_unit_benefit::float,
              actual_users, actual_benefit::float,
              cert_deviation_pct::float,
              deviation_analysis, deviation_notes, ai_deviation_analysis,
              created_at::text
       FROM service_volume_plans
       WHERE project_id = $1
       ORDER BY fiscal_year, service_name`,
      [params.id],
    ).catch(() => [] as ServiceVolumePlan[]),
    query<CheckpointRow>(
      "SELECT id, name FROM project_pdca_checkpoints WHERE project_id = $1 ORDER BY created_at",
      [params.id],
    ).catch(() => [] as CheckpointRow[]),
  ]);

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <BackButton />
      </div>
      <ProjectModuleNav projectId={params.id} activeModule="service_volume" />
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">サービス見込量管理</h2>
      </div>
      <ServiceVolumeClient
        project={project}
        plans={plans}
        checkpoints={checkpoints}
      />
    </div>
  );
}
