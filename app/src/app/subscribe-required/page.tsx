import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getActivePlan } from "@/lib/plan-limits";
import OrgCodeSection from "../(admin)/billing/OrgCodeSection";

export const dynamic = "force-dynamic";
export const metadata = { title: "ご利用には契約が必要です | Coe" };

/**
 * 完全有償化: 有効な有料プランを持たないユーザーがログインした際の案内ページ。
 * - 有料プランの申し込み（/pricing）への導線
 * - 組織から発行された許諾コードの入力（管理者のみ登録可能）
 */
export default async function SubscribeRequiredPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/pricing");

  // すでに有効なプランがあればダッシュボードへ
  const municipalityId = session.user?.municipalityId;
  if (municipalityId) {
    const plan = await getActivePlan(municipalityId);
    if (plan !== "free") redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-primary)" }}>
      <div className="w-full max-w-xl">
        <div className="rounded-2xl border p-8" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-coe.svg" alt="Coe" style={{ height: 44, width: "auto", marginBottom: 16 }} />
          <h1 className="text-xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>
            ご利用には有料プランの契約が必要です
          </h1>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Coe は有償サービスです。ご利用を開始するには、有料プランをお申し込みいただくか、
            所属組織の担当者から発行された許諾コードを登録してください。
          </p>

          <div className="flex gap-3 flex-wrap mb-8">
            <Link
              href="/pricing"
              className="text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-all duration-200 hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
            >
              料金プランを見る・申し込む
            </Link>
            <Link
              href="/contact"
              className="text-sm font-semibold px-5 py-2.5 rounded-xl border transition-all duration-200 hover:bg-white/5"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              お問い合わせ
            </Link>
          </div>

          {/* 組織コード・許諾コードの登録（組織の管理者のみ保存可能） */}
          <OrgCodeSection />
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
            許諾コードの登録は組織の管理者アカウントで行ってください。登録が完了すると、
            組織の全メンバーが契約プランでご利用いただけるようになります。
          </p>
        </div>
      </div>
    </div>
  );
}
