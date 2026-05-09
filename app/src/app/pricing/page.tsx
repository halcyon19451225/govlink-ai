"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "@/contexts/ThemeContext";

const HeroParticles = dynamic(() => import("@/components/HeroParticles"), {
  ssr: false,
  loading: () => <div className="absolute inset-0" />,
});

const PLANS = [
  {
    key: "free",
    name: "Free",
    subtitle: "まずは試してみる",
    monthlyPrice: 0,
    color: "#64748b",
    gradient: "linear-gradient(135deg, #475569, #64748b)",
    features: [
      "計画 1件",
      "ユーザー 3名",
      "AI生成 10回/月",
      "基本ダッシュボード",
      "ロジックモデル生成",
      "PDF帳票出力",
    ],
    limitations: ["テンプレート共有不可", "請求書払い不可"],
    cta: { label: "無料で試す", href: "/register", type: "link" as const },
    badge: null,
  },
  {
    key: "standard",
    name: "Standard",
    subtitle: "中規模自治体向け",
    monthlyPrice: 30000,
    color: "#6366f1",
    gradient: "linear-gradient(135deg, #6366f1, #06b6d4)",
    features: [
      "計画 10件",
      "ユーザー 10名",
      "AI生成 100回/月",
      "テンプレート共有",
      "KPI報告・承認ワークフロー",
      "EBPMスコアリング",
      "請求書払い対応",
      "メールサポート",
    ],
    limitations: [],
    cta: null,
    badge: "おすすめ",
  },
  {
    key: "premium",
    name: "Premium",
    subtitle: "大規模・複数部署向け",
    monthlyPrice: 80000,
    color: "#f59e0b",
    gradient: "linear-gradient(135deg, #f59e0b, #fbbf24)",
    features: [
      "計画 無制限",
      "ユーザー 無制限",
      "AI生成 無制限",
      "テンプレート共有",
      "全機能フルアクセス",
      "請求書払い対応",
      "優先サポート（電話・メール）",
      "導入支援コンサルティング",
    ],
    limitations: [],
    cta: null,
    badge: null,
  },
] as const;

const FAQS = [
  {
    q: "試用期間はありますか？",
    a: "Freeプランは30日間無料でお試しいただけます。クレジットカードの登録不要です。",
  },
  {
    q: "途中でプランを変更できますか？",
    a: "いつでもプランのアップグレード・ダウングレードが可能です。Stripeカスタマーポータルからご自身で変更できます。",
  },
  {
    q: "請求書払いはどのような自治体が対象ですか？",
    a: "StandardプランおよびPremiumプランでご利用いただけます。申込フォームからお申し込みいただくと、3営業日以内にご連絡いたします。",
  },
  {
    q: "消費税はどうなりますか？",
    a: "表示価格は税抜き価格です。請求時に消費税10%が加算されます。適格請求書（インボイス）にも対応しています。",
  },
  {
    q: "データのエクスポートはできますか？",
    a: "計画データ・KPI・レポートはCSVおよびPDF形式でエクスポートできます。解約後30日間はデータのエクスポートが可能です。",
  },
];

const FEATURES = [
  {
    icon: "🎤",
    title: "市民の声を自動収集",
    description:
      "パブリックコメント・SNS・アンケートなど多様なチャネルから市民の声を一括収集。入力の手間をなくし、漏れのない声の把握を実現します。",
  },
  {
    icon: "📊",
    title: "統計学的に分析・整理",
    description:
      "収集した声を自然言語処理と統計的手法で自動分類・優先度付け。根拠のある意思決定を支援するエビデンスを生成します。",
  },
  {
    icon: "📋",
    title: "行政計画へ一気通貫で反映",
    description:
      "ギャップ分析・ロジックモデル・KPI設定まで、PDCAサイクル全体を一つのプラットフォームでシームレスに管理します。",
  },
] as const;

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  const videoUrl = process.env.NEXT_PUBLIC_INTRO_VIDEO_URL;

  const displayPrice = (monthly: number) => {
    if (monthly === 0) return "¥0";
    const price = annual ? Math.round(monthly * 10) : monthly;
    return `¥${price.toLocaleString()}`;
  };

  const handleStripeCheckout = async (plan: "standard" | "premium") => {
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/billing/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = (await res.json()) as { data: { url: string } | null; error: string | null };
      if (json.data?.url) {
        window.location.href = json.data.url;
      } else {
        alert(json.error ?? "エラーが発生しました");
      }
    } catch {
      alert("通信エラーが発生しました");
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>

      {/* ── ヘッダー ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 border-b"
        style={{
          background: theme === "dark" ? "rgba(15,17,23,0.88)" : "rgba(255,255,255,0.92)",
          borderColor: "var(--border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-coe.png" alt="Coe" style={{ height: 52, width: "auto" }} />
          </Link>
          <div className="flex gap-3 items-center">
            {/* テーマ切り替えトグル */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "ライトモードへ切り替え" : "ダークモードへ切り替え"}
              style={{
                position: "relative",
                width: 44,
                height: 24,
                borderRadius: 12,
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
                background: theme === "dark"
                  ? "linear-gradient(135deg, #1e293b, #0f172a)"
                  : "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
                transition: "background 0.3s ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: 0,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: theme === "dark" ? "#ffffff" : "#1e293b",
                  transform: theme === "dark" ? "translateX(23px)" : "translateX(3px)",
                  transition: "transform 0.25s ease, background 0.25s ease",
                }}
              />
            </button>
            <Link
              href="/login"
              className="text-sm transition-colors duration-200"
              style={{ color: "var(--text-secondary)" }}
            >
              ログイン
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all duration-200 hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      {/* ── ヒーローセクション（2カラム） ── */}
      <section
        className="pt-16"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
          <div className="flex flex-col lg:flex-row items-center gap-10 lg:gap-14">

            {/* 左カラム: テキストコンテンツ (55%) */}
            {/* position+z-index でパーティクルcanvasより上に積む */}
            <div className="w-full lg:w-[55%] flex flex-col gap-6" style={{ position: "relative", zIndex: 10, background: "var(--bg-primary)" }}>
              {/* ロゴ */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-coe.png"
                alt="Coe"
                style={{ width: 360, height: "auto" }}
              />

              {/* サービス名 */}
              <h1
                className="text-4xl sm:text-5xl font-bold tracking-tight text-left"
                style={{ color: "var(--text-primary)" }}
              >
                Coe（こえ）
              </h1>

              {/* コンセプトメッセージ */}
              <p
                className="text-lg sm:text-xl font-semibold text-left"
                style={{
                  background: "linear-gradient(135deg, #06b6d4, #3b82f6)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                社会の声を聞き、政策という名の声で応える。
              </p>

              {/* コンセプト説明（左寄せ） */}
              <div
                className="text-sm sm:text-base leading-relaxed text-left space-y-4"
                style={{ color: "var(--text-secondary)" }}
              >
                <p>
                  人々の声は、かつてないほどに多様化し、膨大に溢れています。
                  パブリックコメントに寄せられる切実な願い、SNSで交わされる日常の機微、
                  そして統計情報という名の、人々の生活が発する「声なき声」。
                </p>
                <p>
                  こうした社会に散らばるCoe（データ）が瞬時に公共政策に反映される社会。
                  その可能性を夢見て、Coe（こえ）は生まれました。
                </p>
                <p>
                  Coeは、統計情報や会議体の議事録、職務上の記録までを統計学的な視点で整理・分析し、
                  エビデンスに基づく行政計画のPDCAを「一気通貫」でサポートします。
                </p>
                <p>
                  政策が、社会にもたらす影響を評価し、手段の合理性を検証し、更なる改善へ結びつける。
                  Coeは、データとAIの力で、より良い社会の構築をサポートします。
                </p>
              </div>

              {/* CTAボタン（左寄せ） */}
              <div className="flex justify-start">
                <Link
                  href="/register"
                  className="inline-block text-white font-bold px-8 py-3.5 rounded-xl text-sm transition-all duration-200 hover:opacity-90 hover:scale-105"
                  style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
                >
                  無料で始める →
                </Link>
              </div>

              {/* パーティクルのテキスト境界フェードゾーン（左端: 透明→不透明） */}
              <div
                className="hidden lg:block absolute pointer-events-none"
                style={{
                  left: -260,
                  top: -400,
                  bottom: -400,
                  width: 260,
                  background: "linear-gradient(to right, transparent 0%, var(--bg-primary) 100%)",
                }}
              />
              {/* パーティクルのテキスト境界フェードゾーン（右端: 不透明→透明） */}
              <div
                className="hidden lg:block absolute pointer-events-none"
                style={{
                  right: -260,
                  top: -400,
                  bottom: -400,
                  width: 260,
                  background: "linear-gradient(to right, var(--bg-primary) 0%, transparent 100%)",
                }}
              />
            </div>

            {/* 右カラム: 3Dパーティクル (45%) */}
            {/* z-index を左カラム(10)より低くすることでcanvasが文字の裏に回る */}
            <div
              className="relative w-full lg:w-[45%]"
              style={{ height: 380, background: "var(--bg-primary)", overflow: "visible", zIndex: 5 }}
            >
              <HeroParticles />
            </div>

          </div>
        </div>
      </section>

      {/* ── 動画紹介セクション ── */}
      <section className="py-20 px-6" style={{ borderTop: "1px solid var(--border)", position: "relative", zIndex: 20 }}>
        <div className="max-w-5xl mx-auto">
          <h2
            className="text-3xl sm:text-4xl font-bold text-center mb-12"
            style={{ color: "var(--text-primary)" }}
          >
            Coeで変わる、行政と市民の対話
          </h2>

          {/* 動画エリア */}
          <div
            className="relative rounded-2xl overflow-hidden mb-14"
            style={{
              aspectRatio: "16 / 9",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {videoUrl ? (
              <iframe
                src={videoUrl}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center border-2"
                  style={{ borderColor: "#06b6d460", background: "rgba(6,182,212,0.1)" }}
                >
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="#06b6d4">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                  紹介動画は準備中です
                </p>
              </div>
            )}
          </div>

          {/* 3つの特徴カード */}
          <div className="grid sm:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border p-6 flex flex-col gap-3"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <span className="text-3xl">{f.icon}</span>
                <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
                  {f.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 料金プランセクション ── */}
      <div style={{ borderTop: "1px solid var(--border)" }}>
        <main className="max-w-6xl mx-auto px-6 py-20">

          {/* セクション見出し */}
          <div className="text-center mb-16">
            <h2
              className="text-4xl sm:text-5xl font-bold mb-4"
              style={{ color: "var(--text-primary)" }}
            >
              料金プラン
            </h2>
            <p className="text-lg mb-8" style={{ color: "var(--text-secondary)" }}>
              自治体の規模に合わせて選べる3つのプラン。いつでも変更できます。
            </p>

            {/* 年払い/月払いトグル */}
            <div
              className="inline-flex items-center gap-3 p-1 rounded-xl border"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
            >
              <button
                onClick={() => setAnnual(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                style={
                  !annual
                    ? { background: "linear-gradient(135deg, #6366f1, #06b6d4)", color: "#fff" }
                    : { color: "var(--text-secondary)" }
                }
              >
                月払い
              </button>
              <button
                onClick={() => setAnnual(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2"
                style={
                  annual
                    ? { background: "linear-gradient(135deg, #6366f1, #06b6d4)", color: "#fff" }
                    : { color: "var(--text-secondary)" }
                }
              >
                年払い
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{ background: "#10b98120", color: "#34d399", border: "1px solid #10b98140" }}
                >
                  2ヶ月分無料
                </span>
              </button>
            </div>
          </div>

          {/* プランカード */}
          <div className="grid gap-6 sm:grid-cols-3 mb-20">
            {PLANS.map((plan) => (
              <div
                key={plan.key}
                className="relative rounded-2xl border p-8 flex flex-col"
                style={{
                  background: "var(--bg-secondary)",
                  borderColor: plan.badge ? plan.color + "60" : "var(--border)",
                  boxShadow: plan.badge ? `0 0 40px ${plan.color}20` : "none",
                }}
              >
                {plan.badge && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full text-white"
                    style={{ background: plan.gradient }}
                  >
                    {plan.badge}
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold mb-1" style={{ color: plan.color }}>
                    {plan.name}
                  </h3>
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {plan.subtitle}
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                      {displayPrice(plan.monthlyPrice)}
                    </span>
                    {plan.monthlyPrice > 0 && (
                      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                        /{annual ? "年" : "月"} (税抜)
                      </span>
                    )}
                    {plan.monthlyPrice === 0 && (
                      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                        / 30日間
                      </span>
                    )}
                  </div>
                  {annual && plan.monthlyPrice > 0 && (
                    <p className="text-xs text-emerald-400 mt-1">
                      月換算 ¥
                      {(plan.monthlyPrice * 10 / 12).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      /月
                    </p>
                  )}
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-sm"
                      style={{ color: "var(--text-primary)" }}
                    >
                      <svg
                        width={14}
                        height={14}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="#10b981"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                  {plan.limitations.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <svg
                        width={14}
                        height={14}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="#374151"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="space-y-2">
                  {plan.key === "free" && (
                    <Link
                      href="/register"
                      className="block text-center text-sm font-semibold py-3 rounded-xl text-white transition-all duration-200 hover:opacity-90"
                      style={{ background: plan.gradient }}
                    >
                      無料で試す
                    </Link>
                  )}
                  {(plan.key === "standard" || plan.key === "premium") && (
                    <>
                      <button
                        onClick={() =>
                          void handleStripeCheckout(plan.key as "standard" | "premium")
                        }
                        disabled={loadingPlan !== null}
                        className="w-full text-sm font-semibold py-3 rounded-xl text-white transition-all duration-200 disabled:opacity-50 hover:opacity-90"
                        style={{ background: plan.gradient }}
                      >
                        {loadingPlan === plan.key ? "処理中..." : "カードで申し込む"}
                      </button>
                      <Link
                        href={`/contact?type=${encodeURIComponent("請求書払いのご相談")}`}
                        className="block text-center text-sm font-semibold py-2.5 rounded-xl border transition-all duration-200 hover:bg-white/5"
                        style={{ borderColor: plan.color + "40", color: plan.color }}
                      >
                        請求書払いのご相談
                      </Link>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* FAQ */}
          <section className="mb-20">
            <h2
              className="text-2xl font-bold text-center mb-8"
              style={{ color: "var(--text-primary)" }}
            >
              よくある質問
            </h2>
            <div className="max-w-3xl mx-auto space-y-4">
              {FAQS.map((faq) => (
                <div
                  key={faq.q}
                  className="rounded-xl border p-6"
                  style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
                >
                  <h3
                    className="text-sm font-semibold mb-2"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {faq.q}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* フッターCTA */}
          <div
            className="rounded-2xl border p-12 text-center"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "#06b6d430",
              boxShadow: "0 0 60px #06b6d410",
            }}
          >
            <h2
              className="text-2xl font-bold mb-3"
              style={{ color: "var(--text-primary)" }}
            >
              自治体・団体向けの特別プランをご相談ください
            </h2>
            <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
              50以上の部署・複数自治体での一括契約など、ご要望に応じたカスタムプランをご用意します。
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white px-6 py-3 rounded-xl transition-all duration-200 hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
            >
              お問い合わせフォーム →
            </Link>
          </div>
        </main>
      </div>

    </div>
  );
}
