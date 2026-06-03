export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import LogicModelSection, { type LogicModel } from "./LogicModelSection";
import BackButton from "@/components/BackButton";
import PdcaNav from "@/components/PdcaNav";
import ProjectModuleNav from "@/components/ProjectModuleNav";
import KnowledgePanelButton from "@/components/KnowledgePanelButton";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department: string;
  slug: string;
  created_at: string;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
}

interface LogicModelRow {
  inputs: string[];
  activities: string[];
  outputs: string[];
  outcomes: { term: "short" | "long"; text: string }[];
}

interface ScheduleSummaryRow {
  total_tasks: number;
  completed_tasks: number;
  next_due_title: string | null;
  next_due_date: string | null;
}

interface EvidenceSummaryRow {
  total_evidences: number;
  kpis_with_evidence: number;
}

interface PostRow {
  id: string;
  type: "plan" | "progress" | "result";
  body: string;
  ai_summary: string | null;
  published_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<ProjectRow["status"], string> = {
  draft: "計画中",
  active: "実施中",
  completed: "完了",
  archived: "アーカイブ",
};

const STATUS_BADGE: Record<ProjectRow["status"], string> = {
  draft: "bg-slate-500/20 text-slate-400 border-slate-500/20",
  active: "bg-indigo-500/20 text-indigo-400 border-indigo-500/20",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
  archived: "bg-amber-500/20 text-amber-400 border-amber-500/20",
};

const POST_TYPE_LABEL: Record<PostRow["type"], string> = {
  plan: "計画",
  progress: "進捗",
  result: "成果",
};

const POST_TYPE_BADGE: Record<PostRow["type"], string> = {
  plan: "bg-purple-500/20 text-purple-400 border-purple-500/20",
  progress: "bg-indigo-500/20 text-indigo-400 border-indigo-500/20",
  result: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
};

function kpiBarColor(pct: number): string {
  if (pct >= 80) return "#10b981";
  if (pct >= 50) return "#f59e0b";
  return "#ef4444";
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const rows = await query<ProjectRow>(
    `SELECT p.id, p.title, p.description, p.status, m.name AS department, m.slug, p.created_at
     FROM projects p
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE p.id = $1`,
    [params.id],
  );

  const project = rows[0];
  if (!project) notFound();

  const [kpis, posts, logicModelRows, schedSummaryRows, evidenceSummaryRows] = await Promise.all([
    query<KpiRow>(
      `SELECT id, label, target::float AS target, current::float AS current, unit
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [project.id],
    ),
    query<PostRow>(
      `SELECT id, type, body, ai_summary, published_at, created_at
       FROM posts WHERE project_id = $1 ORDER BY created_at DESC`,
      [project.id],
    ),
    query<LogicModelRow>(
      `SELECT inputs, activities, outputs, outcomes
       FROM logic_models WHERE project_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [project.id],
    ),
    query<ScheduleSummaryRow>(
      `SELECT
         COUNT(t.id)::int                                             AS total_tasks,
         COUNT(t.completed_at)::int                                   AS completed_tasks,
         (SELECT title FROM schedule_tasks
          WHERE project_id = $1 AND completed_at IS NULL AND due_date IS NOT NULL
          ORDER BY due_date LIMIT 1)                                  AS next_due_title,
         to_char(
           (SELECT due_date FROM schedule_tasks
            WHERE project_id = $1 AND completed_at IS NULL AND due_date IS NOT NULL
            ORDER BY due_date LIMIT 1),
           'YYYY-MM-DD')                                              AS next_due_date
       FROM schedule_tasks t
       WHERE t.project_id = $1`,
      [project.id],
    ),
    query<EvidenceSummaryRow>(
      `SELECT
         COUNT(e.id)::int                                                               AS total_evidences,
         COUNT(DISTINCT k.id) FILTER (
           WHERE e.output_kpi_id = k.id OR e.outcome_kpi_id = k.id
         )::int                                                                         AS kpis_with_evidence
       FROM kpis k
       LEFT JOIN evidences e ON e.project_id = $1
         AND (e.output_kpi_id = k.id OR e.outcome_kpi_id = k.id)
       WHERE k.project_id = $1`,
      [project.id],
    ),
  ]);

  const schedSummary = schedSummaryRows[0] ?? null;
  const hasSchedule = schedSummary && schedSummary.total_tasks > 0;
  const evidenceSummary = evidenceSummaryRows[0] ?? null;

  const latestLogicModel = logicModelRows[0] ?? null;
  const initialLogicModel: LogicModel | null = latestLogicModel
    ? {
        inputs: latestLogicModel.inputs,
        activities: latestLogicModel.activities,
        outputs: latestLogicModel.outputs,
        short_outcomes: latestLogicModel.outcomes
          .filter((o) => o.term === "short")
          .map((o) => o.text),
        long_outcomes: latestLogicModel.outcomes
          .filter((o) => o.term === "long")
          .map((o) => o.text),
      }
    : null;

  const cardStyle = {
    background: "var(--bg-secondary)",
    borderColor: "var(--border)",
    boxShadow: "0 2px 16px rgba(0,0,0,0.25)",
  };

  return (
    <div className="max-w-3xl space-y-8">
      <PdcaNav currentStage="P" currentStep="セオリー評価" projectId={project.id} />
      <div className="mb-2">
        <BackButton />
      </div>
      <ProjectModuleNav projectId={project.id} />
      {/* ヘッダーカード */}
      <div className="rounded-2xl border p-6" style={cardStyle}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-500 mt-2">{project.department}</p>
            <h2 className="text-2xl font-bold text-slate-100 mt-1">{project.title}</h2>
            {project.description && (
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">{project.description}</p>
            )}
            <p className="mt-2 text-xs text-slate-600">
              登録日: {new Date(project.created_at).toLocaleDateString("ja-JP")}
            </p>
          </div>
          <span
            className={`text-xs px-3 py-1 rounded-full border font-medium whitespace-nowrap ${STATUS_BADGE[project.status]}`}
            style={{ backdropFilter: "blur(4px)" }}
          >
            {STATUS_LABEL[project.status]}
          </span>
        </div>

        <div className="mt-5 flex gap-3 flex-wrap">
          <div className="neu-button-wrap">
            <Link
            href={`/projects/${project.id}/post`}
            className="text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            進捗を報告する
          </Link>
          </div>
          <Link
            href={`/projects/${project.id}/schedule`}
            className="text-sm font-medium px-5 py-2 rounded-xl border hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-200 text-slate-400"
            style={{ borderColor: "var(--border)" }}
          >
            スケジュールを管理
          </Link>
          <Link
            href={`/projects/${project.id}/documents`}
            className="text-sm font-medium px-5 py-2 rounded-xl border hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-200 text-slate-400"
            style={{ borderColor: "var(--border)" }}
          >
            ドキュメント管理
          </Link>
          <Link
            href={`/projects/${project.id}/evidences`}
            className="text-sm font-medium px-5 py-2 rounded-xl border hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-200 text-slate-400"
            style={{ borderColor: "var(--border)" }}
          >
            エビデンス管理
          </Link>
          <Link
            href={`/projects/${project.id}/ebpm`}
            className="text-sm font-semibold px-5 py-2 rounded-xl border hover:border-cyan-500/40 hover:text-cyan-400 transition-all duration-200 text-slate-400"
            style={{ borderColor: "var(--border)" }}
          >
            EBPMダッシュボード
          </Link>
          <KnowledgePanelButton projectId={project.id} />
          <Link
            href={`/projects/${project.id}/pdca`}
            className="text-sm font-semibold px-5 py-2 rounded-xl border transition-all duration-200"
            style={{
              borderColor: "#6366f140",
              color: "#818cf8",
              background: "#6366f108",
            }}
          >
            PDCAサイクル全体図
          </Link>
          <Link
            href={`/public/${project.slug}`}
            className="text-sm font-medium px-5 py-2 rounded-xl border hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-200 text-slate-400"
            style={{ borderColor: "var(--border)" }}
            target="_blank"
            rel="noopener noreferrer"
          >
            公開フィードを見る ↗
          </Link>
        </div>

        {/* エビデンス充足度インジケーター */}
        {evidenceSummary !== null && kpis.length > 0 && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-500">エビデンス充足度:</span>
            <span
              className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                evidenceSummary.total_evidences === 0
                  ? "bg-slate-500/20 text-slate-400 border-slate-500/20"
                  : "bg-indigo-500/20 text-indigo-400 border-indigo-500/20"
              }`}
            >
              登録済み {evidenceSummary.total_evidences} 件
            </span>
            <span
              className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                evidenceSummary.kpis_with_evidence === 0
                  ? "bg-slate-500/20 text-slate-400 border-slate-500/20"
                  : evidenceSummary.kpis_with_evidence >= kpis.length
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/20 text-amber-400 border-amber-500/20"
              }`}
            >
              KPI対応 {evidenceSummary.kpis_with_evidence} / {kpis.length}
            </span>
          </div>
        )}
      </div>

      {/* スケジュール進捗サマリー */}
      {hasSchedule && (
        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            スケジュール進捗
          </h3>
          <div
            className="rounded-2xl border p-5 flex flex-wrap gap-6 items-center"
            style={cardStyle}
          >
            <div className="flex-1 min-w-[140px]">
              <p className="text-xs text-slate-500 mb-1">タスク完了</p>
              <div className="flex items-baseline gap-1">
                <span
                  className="text-2xl font-bold"
                  style={{
                    background: "linear-gradient(135deg, #6366f1, #06b6d4)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {schedSummary.completed_tasks}
                </span>
                <span className="text-slate-500 text-sm">/ {schedSummary.total_tasks} 件</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${schedSummary.total_tasks > 0 ? (schedSummary.completed_tasks / schedSummary.total_tasks) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #6366f1, #06b6d4)",
                  }}
                />
              </div>
            </div>
            {schedSummary.next_due_title && schedSummary.next_due_date && (
              <div className="flex-1 min-w-[160px]">
                <p className="text-xs text-slate-500 mb-1">直近期限タスク</p>
                <p className="text-sm font-medium text-slate-200 truncate">{schedSummary.next_due_title}</p>
                <p className="text-xs text-amber-400 mt-0.5">
                  {new Date(schedSummary.next_due_date).toLocaleDateString("ja-JP")}
                </p>
              </div>
            )}
            <Link
              href={`/projects/${project.id}/schedule`}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors duration-200 whitespace-nowrap"
            >
              詳細を見る →
            </Link>
          </div>
        </section>
      )}

      {/* KPI */}
      {kpis.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              KPI 進捗
            </h3>
            <div className="flex gap-2">
              <Link
                href={`/projects/${project.id}/kpi-report`}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors duration-200"
                style={{ background: "#06b6d410", borderColor: "#06b6d430", color: "#22d3ee" }}
              >
                実績を報告
              </Link>
              <Link
                href={`/projects/${project.id}/kpi-summary`}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors duration-200"
                style={{ background: "#6366f110", borderColor: "#6366f130", color: "#818cf8" }}
              >
                取りまとめ
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            {kpis.map((kpi) => {
              const pct = kpi.target > 0 ? Math.min(100, (kpi.current / kpi.target) * 100) : 0;
              return (
                <div key={kpi.id}>
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-sm font-medium text-slate-200">{kpi.label}</span>
                    <span className="text-sm text-slate-500">
                      {kpi.current} / {kpi.target}
                      {kpi.unit && <span className="ml-1">{kpi.unit}</span>}
                      <span className="ml-2 font-semibold text-slate-300">
                        {Math.round(pct)}%
                      </span>
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: "var(--border)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: kpiBarColor(pct) }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* AIロジックモデル */}
      <LogicModelSection
        projectId={project.id}
        projectTitle={project.title}
        projectDescription={project.description}
        kpis={kpis.map((k) => ({ label: k.label, target: k.target, unit: k.unit }))}
        initialLogicModel={initialLogicModel}
      />

      {/* 投稿一覧 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          投稿一覧
        </h3>
        {posts.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-8 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm text-slate-500">まだ投稿がありません</p>
          </div>
        ) : (
          <div className="relative">
            {/* タイムライン縦線 */}
            <div
              className="absolute left-4 top-0 bottom-0 w-px"
              style={{
                background: "linear-gradient(180deg, #6366f1, #06b6d4)",
                opacity: 0.4,
              }}
            />
            <div className="space-y-4 pl-10">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="relative rounded-xl border p-5 transition-all duration-200"
                  style={cardStyle}
                >
                  {/* タイムラインドット */}
                  <div
                    className="absolute -left-[26px] top-5 w-2.5 h-2.5 rounded-full border-2"
                    style={{
                      background: "#6366f1",
                      borderColor: "var(--bg-primary)",
                      boxShadow: "0 0 8px #6366f180",
                    }}
                  />
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${POST_TYPE_BADGE[post.type]}`}
                      style={{ backdropFilter: "blur(4px)" }}
                    >
                      {POST_TYPE_LABEL[post.type]}
                    </span>
                    {post.published_at ? (
                      <span className="text-xs text-slate-500">
                        公開: {new Date(post.published_at).toLocaleDateString("ja-JP")}
                      </span>
                    ) : (
                      <span
                        className="text-xs text-slate-500 px-2 py-0.5 rounded-full border"
                        style={{ borderColor: "var(--border)" }}
                      >
                        下書き
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {post.body}
                  </p>
                  {post.ai_summary && (
                    <div
                      className="mt-3 rounded-lg px-3 py-2.5 border-l-2"
                      style={{
                        background: "#06b6d410",
                        borderLeftColor: "#06b6d4",
                      }}
                    >
                      <p className="text-xs font-semibold text-cyan-400 mb-1">AIサマリー</p>
                      <p className="text-xs text-slate-400 leading-relaxed">{post.ai_summary}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
