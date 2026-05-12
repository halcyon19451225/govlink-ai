export const dynamic = 'force-dynamic'

import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { ProjectCard } from "./ProjectCard";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "archived";
  department: string;
  created_at: Date;
  post_count: number;
  suggestion_count: number;
}

type PdcaStage = "P" | "D" | "C" | "A";

function determinePdcaStage(row: ProjectRow): PdcaStage {
  if (row.suggestion_count > 0) return "A";
  if (row.post_count > 0) return "D";
  return "P";
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  void session;

  let projects: ProjectRow[] = [];
  let dbError: string | null = null;

  try {
    projects = await query<ProjectRow>(
      `SELECT p.id, p.title, p.description, p.status, m.name AS department, p.created_at,
              COUNT(DISTINCT po.id)::int AS post_count,
              COUNT(DISTINCT ps.id)::int AS suggestion_count
       FROM projects p
       JOIN municipalities m ON m.id = p.municipality_id
       LEFT JOIN posts po ON po.project_id = p.id
       LEFT JOIN policy_suggestions ps ON ps.project_id = p.id
       GROUP BY p.id, p.title, p.description, p.status, m.name, p.created_at
       ORDER BY p.created_at DESC`,
    );
  } catch {
    dbError = "政策一覧の取得に失敗しました";
  }

  return (
    <div className="space-y-8">
      {/* 政策一覧 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-300">政策一覧</h3>
          <Link
            href="/projects/new"
            className="text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 active:opacity-80 transition-all duration-200 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            ＋ 新規政策を登録
          </Link>
        </div>

        {dbError ? (
          <div
            className="rounded-xl border px-4 py-3 text-sm text-red-400"
            style={{ background: "var(--bg-secondary)", borderColor: "#ef444430" }}
          >
            {dbError}
          </div>
        ) : projects.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-12 flex flex-col items-center justify-center text-center"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <span className="text-4xl mb-4 opacity-40">🏛️</span>
            <p className="text-slate-400 font-medium">政策がまだ登録されていません</p>
            <p className="text-sm text-slate-500 mt-1">
              右上の「新規政策を登録」から追加してください。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                id={project.id}
                title={project.title}
                description={project.description}
                status={project.status}
                department={project.department}
                pdcaStage={determinePdcaStage(project)}
              />
            ))}
          </div>
        )}
      </section>

      {/* クイックリンク */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/resources"
          className="rounded-xl border p-5 flex flex-col items-center gap-2 transition-all duration-200 hover:-translate-y-0.5"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
          }}
        >
          <span className="text-3xl">🏛️</span>
          <p className="font-medium text-slate-300 text-sm">組織リソース</p>
          <span className="text-xs text-slate-500">諮問機関・会議体・ツール</span>
        </Link>
        {[
          { label: "AI 分析", icon: "🤖" },
          { label: "レポート", icon: "📄" },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border p-5 flex flex-col items-center gap-2 opacity-40"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <span className="text-3xl">{item.icon}</span>
            <p className="font-medium text-slate-400 text-sm">{item.label}</p>
            <span
              className="text-xs text-slate-500 px-2 py-0.5 rounded-full border"
              style={{ borderColor: "var(--border)" }}
            >
              準備中
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
