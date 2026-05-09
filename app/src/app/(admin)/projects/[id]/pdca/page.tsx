export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import PdcaDashboardClient from "./PdcaDashboardClient";

export interface PdcaCheckpoint {
  id: string;
  name: string;
  cycle_type: string;
  phase: string;
  description: string | null;
  evaluation_tiers: string[];
  modules_involved: string[];
  qc_step: string | null;
  instructions: string | null;
  scheduled_date: string;
  scheduled_date_end: string | null;
  status: "upcoming" | "in_progress" | "completed" | "skipped";
  sort_order: number;
}

export default async function PdcaPage({ params }: { params: { id: string } }) {
  const project = await queryOne<{
    id: string;
    title: string;
    description: string | null;
    plan_start_date: string | null;
    plan_end_date: string | null;
    status: string;
  }>(
    `SELECT p.id, p.title, p.description,
            to_char(p.plan_start_date, 'YYYY-MM-DD') AS plan_start_date,
            to_char(p.plan_end_date, 'YYYY-MM-DD') AS plan_end_date, p.status
     FROM projects p WHERE p.id = $1`,
    [params.id],
  );
  if (!project) notFound();

  const checkpoints = await query<PdcaCheckpoint>(
    `SELECT id, name, cycle_type, phase, description, evaluation_tiers, modules_involved,
            qc_step, instructions,
            to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            to_char(scheduled_date_end, 'YYYY-MM-DD') AS scheduled_date_end,
            status, sort_order
     FROM project_pdca_checkpoints WHERE project_id = $1
     ORDER BY sort_order, scheduled_date`,
    [params.id],
  );

  return (
    <PdcaDashboardClient
      project={project}
      checkpoints={checkpoints}
      projectId={params.id}
    />
  );
}
