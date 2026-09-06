import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import KpiSummaryClient from "./KpiSummaryClient";
import type { AchievementCondition } from "@/lib/stats/achievement";
import { assertProjectPage } from "@/lib/tenant-page";

interface ProjectRow { id: string; title: string }

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  indicator_type: string;
  baseline_value: number | null;
  achievement_condition: AchievementCondition | null;
}

interface ReportRow {
  id: string;
  kpi_id: string;
  kpi_label: string;
  kpi_unit: string;
  reported_value: number;
  report_period: string;
  comment: string | null;
  status: string;
  reported_by: string;
  reported_by_name: string | null;
  created_at: string;
}

export default async function KpiSummaryPage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const [kpis, reports] = await Promise.all([
    query<KpiRow>(
      `SELECT id, label, target::float, current::float, unit,
              baseline_value::float AS baseline_value,
              achievement_condition,
              COALESCE(indicator_type, 'process') AS indicator_type
       FROM kpis WHERE project_id = $1 ORDER BY id`,
      [params.id],
    ),
    query<ReportRow>(
      `SELECT kr.id, kr.kpi_id, k.label AS kpi_label, k.unit AS kpi_unit,
              kr.reported_value::float, kr.report_period, kr.comment,
              kr.status, kr.reported_by, kr.reported_by_name, kr.created_at::text
       FROM kpi_reports kr
       JOIN kpis k ON k.id = kr.kpi_id
       WHERE kr.project_id = $1
       ORDER BY kr.created_at DESC`,
      [params.id],
    ),
  ]);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">KPI報告取りまとめ</h2>
        <p className="text-sm text-slate-500 mt-1">
          担当者からの実績報告を確認・承認してください。承認するとKPI値に反映されます。
        </p>
      </div>
      <KpiSummaryClient projectId={project.id} kpis={kpis} initialReports={reports} />
    </div>
  );
}
