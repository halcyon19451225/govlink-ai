import { notFound } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import BackButton from "@/components/BackButton";
import PdcaNav from "@/components/PdcaNav";

interface ProjectRow { id: string; title: string; description: string }
interface KpiRow { id: string; target: number; current: number }
interface ActivityRow {
  event_type: string;
  title: string;
  created_at: string;
}

// PDCAステップ定義
const PDCA_FLOW = [
  {
    stage: "P" as const,
    stageLabel: "計画",
    stageColor: "#6366f1",
    stageBg: "#6366f118",
    stageBorder: "#6366f140",
    steps: [
      { num: "①", label: "現状把握・ニーズ分析", href: "needs", disabled: true },
      { num: "②", label: "目標設定・ロジックモデル", href: "", disabled: false },
      { num: "③", label: "施策・スケジュール策定", href: "schedule", disabled: false },
    ],
  },
  {
    stage: "D" as const,
    stageLabel: "実行",
    stageColor: "#06b6d4",
    stageBg: "#06b6d418",
    stageBorder: "#06b6d440",
    steps: [
      { num: "④", label: "施策の実施", href: "post", disabled: false },
      { num: "⑤", label: "進捗・KPI管理", href: "post", disabled: false },
      { num: "⑥", label: "ドキュメント記録", href: "documents", disabled: false },
    ],
  },
  {
    stage: "C" as const,
    stageLabel: "評価",
    stageColor: "#f59e0b",
    stageBg: "#f59e0b18",
    stageBorder: "#f59e0b40",
    steps: [
      { num: "⑦", label: "プロセス評価", href: "evaluations", disabled: false },
      { num: "⑧", label: "アウトカム評価", href: "evaluations", disabled: false },
      { num: "⑨", label: "EBPMスコア確認", href: "ebpm", disabled: false },
    ],
  },
  {
    stage: "A" as const,
    stageLabel: "改善",
    stageColor: "#10b981",
    stageBg: "#10b98118",
    stageBorder: "#10b98140",
    steps: [
      { num: "⑩", label: "課題の特定・改善提案", href: "ebpm", disabled: false },
      { num: "⑪", label: "次期計画へのフィードバック", href: "", disabled: true },
      { num: "⑫", label: "報告書作成", href: "ebpm", disabled: false },
    ],
  },
] as const;

const ACTIVITY_LABELS: Record<string, { label: string; color: string }> = {
  post: { label: "進捗報告", color: "#6366f1" },
  document: { label: "書類登録", color: "#06b6d4" },
  suggestion: { label: "AI提案", color: "#10b981" },
  report: { label: "レポート生成", color: "#f59e0b" },
  kpi: { label: "KPI更新", color: "#8b5cf6" },
};

export default async function PdcaPage({ params }: { params: { id: string } }) {
  const projects = await query<ProjectRow>(
    "SELECT id, title, description FROM projects WHERE id = $1",
    [params.id],
  );
  const project = projects[0];
  if (!project) notFound();

  const [kpis, postRows, suggestionRows, reportRows, documentRows] = await Promise.all([
    query<KpiRow>(
      "SELECT id, target::float AS target, current::float AS current FROM kpis WHERE project_id = $1",
      [params.id],
    ),
    query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM posts WHERE project_id = $1",
      [params.id],
    ),
    query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM policy_suggestions WHERE project_id = $1",
      [params.id],
    ),
    query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM reports WHERE project_id = $1",
      [params.id],
    ),
    query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM documents WHERE project_id = $1",
      [params.id],
    ),
    // activity feed: union of recent events
  ]);

  const postCount = postRows[0]?.count ?? 0;
  const suggestionCount = suggestionRows[0]?.count ?? 0;
  const reportCount = reportRows[0]?.count ?? 0;
  const documentCount = documentRows[0]?.count ?? 0;

  // 最近のアクティビティ（各テーブルをUNION、enum型はすべて::textでキャスト）
  const activities = await query<ActivityRow>(
    `(SELECT 'post' AS event_type, type::text AS title, created_at::text FROM posts
      WHERE project_id = $1 ORDER BY created_at DESC LIMIT 4)
     UNION ALL
     (SELECT 'document' AS event_type, title::text, uploaded_at::text AS created_at FROM documents
      WHERE project_id = $1 ORDER BY uploaded_at DESC LIMIT 3)
     UNION ALL
     (SELECT 'suggestion' AS event_type, title::text, created_at::text FROM policy_suggestions
      WHERE project_id = $1 ORDER BY created_at DESC LIMIT 3)
     ORDER BY created_at DESC LIMIT 10`,
    [params.id],
  );

  // PDCAステージごとの完了率（概算）
  const kpiScore = kpis.length === 0 ? 0 :
    Math.min(100, Math.round(kpis.reduce((s, k) => s + (k.target > 0 ? (k.current / k.target) * 100 : 0), 0) / kpis.length));

  const stageProgress = {
    P: kpis.length > 0 ? 60 : 30,
    D: postCount > 0 ? Math.min(100, postCount * 20 + documentCount * 10) : 0,
    C: 0, // evaluations 未実装
    A: suggestionCount > 0 ? Math.min(100, suggestionCount * 20 + reportCount * 15) : 0,
  };

  const cardStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };

  return (
    <div className="max-w-4xl space-y-8">
      <PdcaNav currentStage="P" currentStep="セオリー評価" projectId={project.id} />
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="mb-2">
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">PDCAサイクル全体図</h2>
      </div>

      {/* ── 上部: 4ステージゲージ ── */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {PDCA_FLOW.map((s) => {
          const pct = stageProgress[s.stage];
          return (
            <div key={s.stage} className="rounded-2xl border p-4 flex flex-col gap-3" style={cardStyle}>
              <div className="flex items-center gap-2">
                <span
                  className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold"
                  style={{ background: s.stageBg, color: s.stageColor, border: `1px solid ${s.stageBorder}` }}
                >
                  {s.stage}
                </span>
                <span className="text-sm font-semibold text-slate-300">{s.stageLabel}</span>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-slate-500">完了率</span>
                  <span className="text-xs font-semibold" style={{ color: s.stageColor }}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "#2a2d3a" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: s.stageColor }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* KPI達成率サマリー */}
      {kpis.length > 0 && (
        <div
          className="rounded-xl border px-4 py-3 flex items-center gap-4"
          style={{ ...cardStyle, borderColor: "#6366f140" }}
        >
          <span className="text-xs text-slate-400">KPI総合達成率</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#2a2d3a" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${kpiScore}%`,
                background: `linear-gradient(90deg, #6366f1, #06b6d4)`,
              }}
            />
          </div>
          <span className="text-sm font-bold" style={{ color: kpiScore >= 80 ? "#10b981" : kpiScore >= 50 ? "#06b6d4" : "#f59e0b" }}>
            {kpiScore}%
          </span>
        </div>
      )}

      {/* ── 中央: QCストーリーフロー図 ── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          QCストーリーに基づくPDCAフロー
        </h3>
        <div className="space-y-4">
          {PDCA_FLOW.map((s, stageIdx) => (
            <div key={s.stage}>
              {/* ステージブロック */}
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: s.stageBorder }}>
                {/* ステージヘッダー */}
                <div
                  className="flex items-center gap-3 px-5 py-3"
                  style={{ background: s.stageBg, borderBottom: `1px solid ${s.stageBorder}` }}
                >
                  <span
                    className="flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold shrink-0"
                    style={{ background: s.stageColor + "30", color: s.stageColor }}
                  >
                    {s.stage}
                  </span>
                  <span className="font-semibold text-slate-100">{s.stageLabel}</span>
                  <span className="ml-auto text-xs font-semibold" style={{ color: s.stageColor }}>
                    {stageProgress[s.stage]}%
                  </span>
                </div>

                {/* ステップ一覧 */}
                <div className="divide-y" style={{ background: "#0f1117", borderColor: "#1a1d27" }}>
                  {s.steps.map((step) => {
                    const href = step.href === ""
                      ? `/projects/${params.id}`
                      : step.href
                      ? `/projects/${params.id}/${step.href}`
                      : null;

                    const inner = (
                      <div
                        className={`flex items-center gap-3 px-5 py-3.5 transition-colors duration-200 ${
                          !step.disabled && href ? "hover:bg-white/5" : "opacity-50"
                        }`}
                      >
                        <span
                          className="text-base font-bold shrink-0 w-6 text-center"
                          style={{ color: s.stageColor }}
                        >
                          {step.num}
                        </span>
                        <span className="text-sm text-slate-200 flex-1">{step.label}</span>
                        {step.disabled ? (
                          <span className="text-xs text-slate-600 border rounded px-1.5 py-0.5 shrink-0" style={{ borderColor: "#2a2d3a" }}>
                            準備中
                          </span>
                        ) : (
                          <svg className="shrink-0" width={14} height={14} fill="none" viewBox="0 0 24 24"
                            stroke={s.stageColor} strokeWidth={2} style={{ opacity: 0.6 }}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    );

                    return href && !step.disabled ? (
                      <Link key={step.num} href={href}>{inner}</Link>
                    ) : (
                      <div key={step.num}>{inner}</div>
                    );
                  })}
                </div>
              </div>

              {/* ステージ間の矢印 */}
              {stageIdx < PDCA_FLOW.length - 1 && (
                <div className="flex justify-center py-2">
                  <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="#374151" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              )}
            </div>
          ))}

          {/* 次サイクルへ */}
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl border"
            style={{ background: "#6366f108", borderColor: "#6366f130" }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm text-indigo-400 font-semibold">次のPDCAサイクルへ → 継続的改善</span>
          </div>
        </div>
      </section>

      {/* ── 下部: アクティビティタイムライン ── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          直近のアクティビティ
        </h3>
        {activities.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "#2a2d3a" }}>
            <p className="text-sm text-slate-500">まだアクティビティがありません</p>
          </div>
        ) : (
          <div className="relative">
            <div
              className="absolute left-4 top-0 bottom-0 w-px"
              style={{ background: "linear-gradient(180deg, #6366f1, #06b6d4)", opacity: 0.4 }}
            />
            <div className="space-y-3 pl-10">
              {activities.map((a, idx) => {
                const meta = ACTIVITY_LABELS[a.event_type] ?? { label: a.event_type, color: "#94a3b8" };
                return (
                  <div key={idx} className="relative rounded-xl border p-4" style={cardStyle}>
                    <div
                      className="absolute -left-[26px] top-4 w-2.5 h-2.5 rounded-full border-2"
                      style={{ background: meta.color, borderColor: "#0f1117", boxShadow: `0 0 8px ${meta.color}80` }}
                    />
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full border font-medium"
                        style={{ background: meta.color + "18", borderColor: meta.color + "40", color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(a.created_at).toLocaleDateString("ja-JP")}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 truncate">{a.title}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
