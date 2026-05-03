import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import BackButton from "@/components/BackButton";
import PdcaNav from "@/components/PdcaNav";

interface ProjectRow { id: string; title: string }

export default async function EvaluationsPage({ params }: { params: { id: string } }) {
  const projects = await query<ProjectRow>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

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

      <div
        className="rounded-2xl border border-dashed p-16 text-center"
        style={{ borderColor: "#2a2d3a" }}
      >
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
          style={{ background: "#f59e0b18" }}
        >
          <svg width={32} height={32} fill="none" viewBox="0 0 24 24" stroke="#f59e0b" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-300 mb-2">評価機能は準備中です</p>
        <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
          プロセス評価・アウトカム評価機能は近日公開予定です。
          現在は <a href={`/projects/${project.id}/ebpm`} className="text-cyan-400 underline underline-offset-2">EBPMダッシュボード</a> でスコア確認・AI評価が利用できます。
        </p>
      </div>
    </div>
  );
}
