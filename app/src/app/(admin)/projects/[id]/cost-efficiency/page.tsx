export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import Link from "next/link";
import CostEfficiencyClient from "./CostEfficiencyClient";

interface CostEffRecord {
  id: string;
  major_policy_name: string | null;
  fiscal_year: number | null;
  evaluation_type: string;
  labor_cost: number | null;
  operating_cost: number | null;
  total_investment: number | null;
  insured_n: number | null;
  utilization_rate: number | null;
  unit_benefit: number | null;
  delta_cert_rate: number | null;
  reduction_a: number | null;
  delta_recep_rate: number | null;
  reduction_b: number | null;
  recipient_count: number | null;
  delta_unit_benefit: number | null;
  reduction_c: number | null;
  total_reduction: number | null;
  cost_ratio: number | null;
  actual_total_reduction: number | null;
  actual_cost_ratio: number | null;
  evidence_basis: string | null;
  notes: string | null;
  created_at: string;
}

export default async function CostEfficiencyPage({
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

  const [records, evaluations] = await Promise.all([
    query<CostEffRecord>(
      `SELECT id, major_policy_name, fiscal_year, evaluation_type,
              labor_cost::float, operating_cost::float, total_investment::float,
              insured_n, utilization_rate::float, unit_benefit::float,
              delta_cert_rate::float, reduction_a::float,
              delta_recep_rate::float, reduction_b::float,
              recipient_count, delta_unit_benefit::float, reduction_c::float,
              total_reduction::float, cost_ratio::float,
              actual_total_reduction::float, actual_cost_ratio::float,
              evidence_basis, notes, created_at::text
       FROM cost_efficiency_records WHERE project_id = $1 ORDER BY fiscal_year, evaluation_type`,
      [params.id],
    ).catch(() => [] as CostEffRecord[]),
    query<{ id: string; evaluation_tier: string; fiscal_year: number | null }>(
      `SELECT id, evaluation_tier, fiscal_year FROM program_evaluations
       WHERE project_id = $1 AND evaluation_tier = 'cost' ORDER BY created_at DESC LIMIT 10`,
      [params.id],
    ).catch(() => []),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">コスト効率分析</h2>
      </div>

      {/* 移動案内バナー（フェーズP4: 効率性評価はプログラム評価へ統合） */}
      <div
        className="mb-6 rounded-xl border px-4 py-3 flex items-center justify-between gap-4"
        style={{ background: "#6366f110", borderColor: "#6366f140" }}
      >
        <p className="text-sm text-slate-300">
          ℹ️ この機能はプログラム評価の「効率性評価」タブに移動しました。
        </p>
        <Link
          href={`/projects/${project.id}/program-evaluation`}
          className="shrink-0 text-sm font-medium px-4 py-1.5 rounded-lg text-white"
          style={{ background: "#6366f1" }}
        >
          プログラム評価へ移動 →
        </Link>
      </div>

      <CostEfficiencyClient
        project={project}
        records={records}
        evaluations={evaluations}
      />
    </div>
  );
}
