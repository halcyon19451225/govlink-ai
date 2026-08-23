import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import EbpmClient from "./EbpmClient";
import type { AchievementCondition } from "@/lib/stats/achievement";

interface ProjectRow { id: string; title: string }
interface KpiRow {
  id: string; label: string; target: number; current: number; unit: string;
  baseline_value: number | null;
  achievement_condition: AchievementCondition | null;
}
interface EvidenceRow {
  id: string; title: string; evidence_type: string; strength: number;
  output_kpi_id: string | null; outcome_kpi_id: string | null;
}
interface SuggestionRow {
  id: string; suggestion_type: string; title: string;
  body: string; priority: string; created_at: string;
}
interface BenchmarkRow {
  id: string; kpi_id: string; source: string;
  label: string; value: number; unit: string | null; year: number | null;
}
interface ReportRow {
  id: string; report_type: string; title: string;
  content: string; generated_at: string;
}

export default async function EbpmPage({ params }: { params: { id: string } }) {
  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const [kpis, evidences, suggestions, benchmarks, reports] = await Promise.all([
    query<KpiRow>(
      `SELECT id, label, target::float AS target, current::float AS current, unit,
              baseline_value::float AS baseline_value, achievement_condition
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [params.id],
    ),
    query<EvidenceRow>(
      `SELECT id, title, evidence_type, strength, output_kpi_id, outcome_kpi_id
       FROM evidences WHERE project_id = $1 ORDER BY created_at DESC`,
      [params.id],
    ),
    query<SuggestionRow>(
      `SELECT id, suggestion_type, title, body, priority, created_at::text
       FROM policy_suggestions WHERE project_id = $1 ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC`,
      [params.id],
    ),
    query<BenchmarkRow>(
      `SELECT bv.id, bv.kpi_id, bv.source, bv.label, bv.value::float AS value,
              bv.unit, bv.year
       FROM benchmark_values bv
       JOIN kpis k ON k.id = bv.kpi_id
       WHERE k.project_id = $1
       ORDER BY bv.fetched_at DESC`,
      [params.id],
    ),
    query<ReportRow>(
      `SELECT id, report_type, title, content, generated_at::text
       FROM reports WHERE project_id = $1 ORDER BY generated_at DESC LIMIT 10`,
      [params.id],
    ),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">EBPMダッシュボード</h2>
      </div>
      <EbpmClient
        projectId={project.id}
        kpis={kpis}
        evidences={evidences}
        initialSuggestions={suggestions}
        benchmarks={benchmarks}
        initialReports={reports}
      />
    </div>
  );
}
