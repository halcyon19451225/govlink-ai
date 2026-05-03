"use client";

import { useState } from "react";
import Link from "next/link";

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

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

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
    <div className="min-h-screen" style={{ background: "#0f1117" }}>
      {/* Header */}
      <header className="border-b" style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            Sinap-sys
          </Link>
          <div className="flex gap-4 items-center">
            <Link href="/login" className="text-sm text-slate-400 hover:text-slate-200 transition-colors duration-200">
              ログイン
            </Link>
            <Link href="/register"
              className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all duration-200"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-20">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-100 mb-4">
            シンプルな料金体系
          </h1>
          <p className="text-lg text-slate-500 mb-8">
            自治体の規模に合わせて選べる3つのプラン。いつでも変更できます。
          </p>

          {/* Annual toggle */}
          <div className="inline-flex items-center gap-3 p-1 rounded-xl border" style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}>
            <button
              onClick={() => setAnnual(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              style={!annual ? { background: "linear-gradient(135deg, #6366f1, #06b6d4)", color: "#fff" } : { color: "#64748b" }}
            >
              月払い
            </button>
            <button
              onClick={() => setAnnual(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2"
              style={annual ? { background: "linear-gradient(135deg, #6366f1, #06b6d4)", color: "#fff" } : { color: "#64748b" }}
            >
              年払い
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{ background: "#10b98120", color: "#34d399", border: "1px solid #10b98140" }}>
                2ヶ月分無料
              </span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 sm:grid-cols-3 mb-20">
          {PLANS.map((plan) => (
            <div
              key={plan.key}
              className="relative rounded-2xl border p-8 flex flex-col"
              style={{
                background: "#1a1d27",
                borderColor: plan.badge ? plan.color + "60" : "#2a2d3a",
                boxShadow: plan.badge ? `0 0 40px ${plan.color}20` : "none",
              }}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full text-white"
                  style={{ background: plan.gradient }}>
                  {plan.badge}
                </div>
              )}

              {/* Plan name */}
              <div className="mb-6">
                <h2 className="text-xl font-bold mb-1" style={{ color: plan.color }}>{plan.name}</h2>
                <p className="text-sm text-slate-500">{plan.subtitle}</p>
              </div>

              {/* Price */}
              <div className="mb-6">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-slate-100">{displayPrice(plan.monthlyPrice)}</span>
                  {plan.monthlyPrice > 0 && (
                    <span className="text-slate-500 text-sm">/{annual ? "年" : "月"} (税抜)</span>
                  )}
                  {plan.monthlyPrice === 0 && (
                    <span className="text-slate-500 text-sm">/ 30日間</span>
                  )}
                </div>
                {annual && plan.monthlyPrice > 0 && (
                  <p className="text-xs text-emerald-400 mt-1">
                    月換算 ¥{(plan.monthlyPrice * 10 / 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}/月
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                    <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
                {plan.limitations.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                    <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="#374151" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTAs */}
              <div className="space-y-2">
                {plan.key === "free" && (
                  <Link href="/register"
                    className="block text-center text-sm font-semibold py-3 rounded-xl text-white transition-all duration-200"
                    style={{ background: plan.gradient }}>
                    無料で試す
                  </Link>
                )}
                {(plan.key === "standard" || plan.key === "premium") && (
                  <>
                    <button
                      onClick={() => void handleStripeCheckout(plan.key as "standard" | "premium")}
                      disabled={loadingPlan !== null}
                      className="w-full text-sm font-semibold py-3 rounded-xl text-white transition-all duration-200 disabled:opacity-50"
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
          <h2 className="text-2xl font-bold text-slate-100 text-center mb-8">よくある質問</h2>
          <div className="max-w-3xl mx-auto space-y-4">
            {FAQS.map((faq) => (
              <div key={faq.q} className="rounded-xl border p-6" style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}>
                <h3 className="text-sm font-semibold text-slate-200 mb-2">{faq.q}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="rounded-2xl border p-12 text-center"
          style={{ background: "#1a1d27", borderColor: "#6366f130", boxShadow: "0 0 60px #6366f110" }}>
          <h2 className="text-2xl font-bold text-slate-100 mb-3">
            自治体・団体向けの特別プランをご相談ください
          </h2>
          <p className="text-slate-500 mb-6">
            50以上の部署・複数自治体での一括契約など、ご要望に応じたカスタムプランをご用意します。
          </p>
          <Link href="/contact"
            className="inline-flex items-center gap-2 text-sm font-semibold text-white px-6 py-3 rounded-xl transition-all duration-200"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            お問い合わせフォーム →
          </Link>
        </div>
      </main>

    </div>
  );
}
