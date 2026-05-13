import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import GradientBackground from "@/components/GradientBackground";
import type { ReactNode } from "react";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

export default async function OrdoAdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)", position: "relative" }}>
      <GradientBackground />
      <div style={{ position: "relative", zIndex: 1 }}>
        <header
          className="glass-dark sticky top-0 z-50"
          style={{ borderRadius: 0, borderBottom: "1px solid rgba(99,102,241,0.3)" }}
        >
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 22 }}>⚙️</span>
              <span className="font-bold text-lg" style={{ color: "var(--accent)" }}>
                Ordo 運営管理
              </span>
            </div>
            <div style={{ flexGrow: 1 }} />
            <Link
              href="/dashboard"
              className="text-sm hover:opacity-80 transition-opacity flex items-center gap-1"
              style={{ color: "var(--text-secondary)" }}
            >
              ← 管理ダッシュボードへ戻る
            </Link>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
