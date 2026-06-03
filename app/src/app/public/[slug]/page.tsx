import { notFound } from "next/navigation";
import { query } from "@/lib/db";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department: string;
  slug: string;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
}

interface PostRow {
  id: string;
  type: "plan" | "progress" | "result";
  body: string;
  ai_summary: string | null;
  published_at: string;
}

const STATUS_LABEL: Record<ProjectRow["status"], string> = {
  draft: "計画中",
  active: "実施中",
  completed: "完了",
  archived: "アーカイブ",
};

const STATUS_BADGE: Record<ProjectRow["status"], string> = {
  draft: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  active: "bg-indigo-500/20 text-indigo-200 border-indigo-500/30",
  completed: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
  archived: "bg-amber-500/20 text-amber-200 border-amber-500/30",
};

const POST_TYPE_LABEL: Record<PostRow["type"], string> = {
  plan: "計画",
  progress: "進捗",
  result: "成果",
};

const POST_TYPE_BADGE: Record<PostRow["type"], string> = {
  plan: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  progress: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  result: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

export default async function PublicProjectPage({
  params,
}: {
  params: { slug: string };
}) {
  const rows = await query<ProjectRow>(
    `SELECT p.id, p.title, p.description, p.status, m.name AS department, m.slug
     FROM projects p
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE m.slug = $1
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [params.slug],
  );

  const project = rows[0];
  if (!project) notFound();

  const [kpis, posts] = await Promise.all([
    query<KpiRow>(
      `SELECT id, label, target::float AS target, current::float AS current, unit
       FROM kpis WHERE project_id = $1 ORDER BY created_at`,
      [project.id],
    ),
    query<PostRow>(
      `SELECT id, type, body, ai_summary, published_at
       FROM posts
       WHERE project_id = $1 AND published_at IS NOT NULL
       ORDER BY published_at DESC`,
      [project.id],
    ),
  ]);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      {/* グラデーションヘッダー */}
      <header
        className="px-4 py-10 text-white"
        style={{ background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)" }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-indigo-100 font-medium mb-1">{project.department}</p>
              <h1 className="text-2xl font-bold text-white leading-tight">{project.title}</h1>
            </div>
            <span
              className={`text-xs px-3 py-1 rounded-full border font-medium whitespace-nowrap ${STATUS_BADGE[project.status]}`}
              style={{ backdropFilter: "blur(8px)" }}
            >
              {STATUS_LABEL[project.status]}
            </span>
          </div>
          {project.description && (
            <p className="mt-3 text-sm text-indigo-100 leading-relaxed opacity-90">
              {project.description}
            </p>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* KPI 進捗バー */}
        {kpis.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              KPI 進捗
            </h2>
            <div
              className="rounded-2xl border p-5 space-y-4"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                boxShadow: "0 2px 16px rgba(0,0,0,0.3)",
              }}
            >
              {kpis.map((kpi) => {
                const pct =
                  kpi.target > 0 ? Math.min(100, (kpi.current / kpi.target) * 100) : 0;
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
                      className="h-2.5 rounded-full overflow-hidden"
                      style={{ background: "var(--border)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(90deg, #6366f1, #06b6d4)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 活動タイムライン */}
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
            活動タイムライン
          </h2>
          {posts.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed p-8 text-center"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-sm text-slate-500">まだ投稿がありません</p>
            </div>
          ) : (
            <div className="relative">
              {/* タイムライン縦線（シアン） */}
              <div
                className="absolute left-4 top-0 bottom-0 w-px"
                style={{ background: "#06b6d4", opacity: 0.35 }}
              />
              <div className="space-y-4 pl-10">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className="relative rounded-xl border p-5"
                    style={{
                      background: "var(--bg-secondary)",
                      borderColor: "var(--border)",
                      boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
                    }}
                  >
                    {/* タイムラインドット（シアン） */}
                    <div
                      className="absolute -left-[26px] top-5 w-2.5 h-2.5 rounded-full border-2"
                      style={{
                        background: "#06b6d4",
                        borderColor: "var(--bg-primary)",
                        boxShadow: "0 0 8px #06b6d480",
                      }}
                    />
                    <div className="flex items-center gap-3 mb-3">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${POST_TYPE_BADGE[post.type]}`}
                        style={{ backdropFilter: "blur(4px)" }}
                      >
                        {POST_TYPE_LABEL[post.type]}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(post.published_at).toLocaleDateString("ja-JP")}
                      </span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {post.body}
                    </p>
                    {post.ai_summary && (
                      <div
                        className="mt-3 rounded-r-lg px-3 py-2.5 border-l-2"
                        style={{
                          background: "#06b6d410",
                          borderLeftColor: "#06b6d4",
                          backdropFilter: "blur(4px)",
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

      {/* フッター */}
      <footer
        className="mt-12 border-t py-6 text-center"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <p
          className="text-sm font-semibold bg-clip-text text-transparent"
          style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          GovLink AI
        </p>
        <p className="text-xs text-slate-600 mt-1">政策の透明性を、すべての人に。</p>
      </footer>
    </div>
  );
}
