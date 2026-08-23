export const dynamic = "force-dynamic";

import Link from "next/link";
import { queryOne } from "@/lib/db";

export default async function OrdoAdminDashboard() {
  const [
    municipalityCount,
    userCount,
    tier1DocCount,
    pendingDocCount,
  ] = await Promise.all([
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM municipalities"),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM user_roles"),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM knowledge_documents WHERE tier = 1"),
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM knowledge_documents WHERE tier = 1 AND status = 'pending'"),
  ]);

  const stats = [
    { label: "登録自治体数", value: municipalityCount?.count ?? "0", icon: "🏛", color: "#6366f1" },
    { label: "総ユーザー数", value: userCount?.count ?? "0", icon: "👥", color: "#06b6d4" },
    { label: "Tier1ナレッジ文書数", value: tier1DocCount?.count ?? "0", icon: "📚", color: "#10b981" },
    { label: "未処理文書数", value: pendingDocCount?.count ?? "0", icon: "⏳", color: "#f59e0b" },
  ];

  const quickLinks = [
    { label: "ナレッジ管理（Tier 1）", href: "/ordo-admin/knowledge", icon: "📚", desc: "Tier1ナレッジ文書の管理・AI処理" },
    { label: "自治体管理", href: "/ordo-admin/municipalities", icon: "🏛", desc: "登録済み自治体の一覧・管理" },
    { label: "ユーザー管理", href: "/ordo-admin/users", icon: "👥", desc: "全ユーザーの管理" },
    { label: "独自AI管理", href: "/ordo-admin/ai", icon: "🤖", desc: "AIゲートウェイのルーティング（段階移行のダイヤル）と利用状況" },
    { label: "コーパス管理", href: "/ordo-admin/corpus", icon: "🌐", desc: "横断学習データの検収・ナレッジ抽出・自治体同意の管理" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          運営管理ダッシュボード
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Ordo システム全体の管理・モニタリング
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="glass-card rounded-2xl p-5"
            style={{ borderLeft: `3px solid ${stat.color}` }}
          >
            <div className="flex items-center gap-3 mb-2">
              <span style={{ fontSize: 22 }}>{stat.icon}</span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{stat.label}</span>
            </div>
            <p className="text-3xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* クイックリンク */}
      <div>
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          管理メニュー
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="glass-card rounded-2xl p-6 hover:border-indigo-500/40 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-2">
                <span style={{ fontSize: 28 }}>{link.icon}</span>
                <span className="font-semibold group-hover:text-indigo-400 transition-colors"
                  style={{ color: "var(--text-primary)" }}>
                  {link.label}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{link.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
