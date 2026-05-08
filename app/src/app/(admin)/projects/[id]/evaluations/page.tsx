export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import BackButton from "@/components/BackButton";
import PdcaNav from "@/components/PdcaNav";

interface ProjectRow { id: string; title: string }

interface EvaluationRow {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  status: string;
  summary: string | null;
  created_at: string;
}

const TIER_LABELS: Record<string, string> = {
  needs:   "ニーズ評価",
  theory:  "セオリー評価",
  process: "プロセス評価",
  outcome: "アウトカム評価",
  cost:    "コスト効率評価",
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft:     { bg: "#64748b15", text: "#94a3b8", border: "#64748b30" },
  in_review: { bg: "#f59e0b15", text: "#fbbf24", border: "#f59e0b30" },
  approved:  { bg: "#10b98115", text: "#34d399", border: "#10b98130" },
};

export default async function EvaluationsPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) notFound();

  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const evaluations = await query<EvaluationRow>(
    `SELECT id, evaluation_tier, fiscal_year, status, summary,
            to_char(created_at, 'YYYY-MM-DD') AS created_at
     FROM program_evaluations
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [params.id],
  ).catch(() => [] as EvaluationRow[]);

  return (
    <div className="max-w-4xl">
      <PdcaNav currentStage="C" currentStep="プロセス評価" projectId={project.id} />
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="mb-6">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">評価管理</h2>
      </div>

      {evaluations.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed p-12 text-center"
          style={{ borderColor: "#2a2d3a" }}
        >
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
            style={{ background: "#6366f118" }}
          >
            <svg width={28} height={28} fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-300 mb-2">評価レコードがありません</p>
          <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
            プログラム評価は 5 階層（ニーズ・セオリー・プロセス・アウトカム・コスト）で管理されます。
            評価を開始するには <a href={`/projects/${project.id}/ebpm`} className="text-cyan-400 underline underline-offset-2">EBPMダッシュボード</a> を利用してください。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {evaluations.map((ev) => {
            const colors = STATUS_COLORS[ev.status] ?? STATUS_COLORS["draft"]!;
            return (
              <div
                key={ev.id}
                className="rounded-xl border p-4"
                style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: "#6366f115", color: "#818cf8", border: "1px solid #6366f130" }}
                      >
                        {TIER_LABELS[ev.evaluation_tier] ?? ev.evaluation_tier}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                      >
                        {ev.status}
                      </span>
                      {ev.fiscal_year && (
                        <span className="text-xs text-slate-500">{ev.fiscal_year}年度</span>
                      )}
                    </div>
                    {ev.summary && (
                      <p className="text-sm text-slate-300 mt-1 leading-relaxed line-clamp-2">{ev.summary}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-600 shrink-0">{ev.created_at}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
