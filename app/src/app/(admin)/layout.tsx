import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getActivePlan } from "@/lib/plan-limits";
import NavBar from "@/components/NavBar";
import GradientBackground from "@/components/GradientBackground";
import type { ReactNode } from "react";

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // 完全有償化: 有効な有料プラン（Stripe契約 or 組織コード契約）がない場合は
  // 案内ページへ（開発環境ではスキップ）
  if (process.env.NODE_ENV === "production") {
    const municipalityId = session.user?.municipalityId;
    const plan = municipalityId ? await getActivePlan(municipalityId) : "free";
    if (plan === "free") redirect("/subscribe-required");
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)", position: "relative" }}>
      <GradientBackground />
      <div style={{ position: "relative", zIndex: 1 }}>
        <NavBar />
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
