import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import KpiReportForm from "./KpiReportForm";
import type { AchievementCondition } from "@/lib/stats/achievement";

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

export default async function KpiReportPage({ params }: { params: { id: string } }) {
  const projects = await query<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const kpis = await query<KpiRow>(
    `SELECT id, label, target::float, current::float, unit,
            baseline_value::float AS baseline_value,
            achievement_condition,
            COALESCE(indicator_type, 'process') AS indicator_type
     FROM kpis WHERE project_id = $1 ORDER BY id`,
    [params.id],
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">KPI実績を報告</h2>
        <p className="text-sm text-slate-500 mt-1">
          担当するKPIの実績値を入力してください。管理者が確認後、KPIに反映されます。
        </p>
      </div>
      <KpiReportForm projectId={project.id} kpis={kpis} />
    </div>
  );
}
