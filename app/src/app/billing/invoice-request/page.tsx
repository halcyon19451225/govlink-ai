"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const PLAN_INFO = {
  standard: { name: "Standard", price: 30000, tax: 3000, total: 33000 },
  premium:  { name: "Premium",  price: 80000, tax: 8000, total: 88000 },
};

const inputClass =
  "w-full rounded-lg border px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

function InvoiceRequestForm() {
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan") as "standard" | "premium" | null;

  const [plan, setPlan] = useState<"standard" | "premium">(planParam === "premium" ? "premium" : "standard");
  const [municipalityName, setMunicipalityName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [address, setAddress] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [resultInvoiceNumber, setResultInvoiceNumber] = useState("");

  // デフォルトで翌月を設定
  useEffect(() => {
    const next = new Date();
    next.setMonth(next.getMonth() + 1);
    setStartMonth(next.toISOString().slice(0, 7));
  }, []);

  const planInfo = PLAN_INFO[plan];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/invoice/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan, municipalityName, contactName, contactEmail,
          contactPhone: contactPhone || undefined,
          address, invoiceNumber: invoiceNumber || undefined,
          startMonth, notes: notes || undefined,
        }),
      });
      const json = (await res.json()) as {
        data: { invoiceId: string; invoiceNumber: string } | null;
        error: string | null;
      };
      if (!res.ok) { setError(json.error ?? "送信に失敗しました"); return; }
      setResultInvoiceNumber(json.data?.invoiceNumber ?? "");
      setDone(true);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-primary)" }}>
        <div className="w-full max-w-md rounded-2xl border p-10 text-center space-y-6"
          style={{ background: "var(--bg-secondary)", borderColor: "#10b98130" }}>
          <div className="flex items-center justify-center w-16 h-16 rounded-full mx-auto"
            style={{ background: "#10b98120" }}>
            <svg width={32} height={32} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100 mb-2">申込を受け付けました</h2>
            <p className="text-sm text-slate-500">3営業日以内に担当者よりご連絡いたします。</p>
          </div>
          <div className="rounded-xl border p-4 text-left space-y-2" style={{ borderColor: "var(--border)" }}>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">プラン</span>
              <span className="text-slate-200 font-medium">{planInfo.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">請求書番号</span>
              <span className="text-slate-200 font-mono">{resultInvoiceNumber}</span>
            </div>
          </div>
          <Link href="/pricing"
            className="block text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200">
            料金ページへ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <header className="border-b" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent neu-button-primary"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            Sinap-sys
          </Link>
          <Link href="/pricing" className="text-sm text-slate-500 hover:text-slate-300 transition-colors duration-200">
            ← 料金プランへ戻る
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-100 mb-2">請求書払いお申し込み</h1>
          <p className="text-slate-500">入力内容を確認後、3営業日以内にご連絡いたします。</p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Form */}
          <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-5">
            {error && (
              <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
                style={{ background: "#ef444410", borderColor: "#ef444430" }}>
                {error}
              </div>
            )}

            {/* Plan selection */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                プラン選択 <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(["standard", "premium"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPlan(p)}
                    className="p-4 rounded-xl border text-left transition-all duration-200"
                    style={{
                      borderColor: plan === p ? "#6366f160" : "var(--border)",
                      background: plan === p ? "#6366f115" : "var(--bg-secondary)",
                    }}>
                    <div className="font-semibold text-slate-200 mb-1">{PLAN_INFO[p].name}</div>
                    <div className="text-xs text-slate-500">¥{PLAN_INFO[p].total.toLocaleString()}/月（税込）</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                自治体名・法人名 <span className="text-red-400">*</span>
              </label>
              <input type="text" required value={municipalityName}
                onChange={(e) => setMunicipalityName(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: ○○市、○○町" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  担当者名 <span className="text-red-400">*</span>
                </label>
                <input type="text" required value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className={inputClass} style={inputStyle}
                  placeholder="例: 山田 太郎" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  電話番号
                </label>
                <input type="tel" value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={inputClass} style={inputStyle}
                  placeholder="例: 03-1234-5678" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                メールアドレス <span className="text-red-400">*</span>
              </label>
              <input type="email" required value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: yamada@city.example.jp" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                請求書送付先住所 <span className="text-red-400">*</span>
              </label>
              <textarea required value={address} rows={3}
                onChange={(e) => setAddress(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="〒000-0000 ○○県○○市○○町1-2-3 ○○課" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  適格請求書（インボイス）番号
                  <span className="text-slate-600 font-normal ml-1">任意</span>
                </label>
                <input type="text" value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className={inputClass} style={inputStyle}
                  placeholder="例: T1234567890123" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  支払い開始希望月 <span className="text-red-400">*</span>
                </label>
                <input type="month" required value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  className={inputClass} style={inputStyle} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">備考</label>
              <textarea value={notes} rows={3}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="ご質問・特記事項があればご記入ください" />
            </div>

            <button type="submit" disabled={submitting}
              className="w-full text-white py-3 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
              {submitting ? "送信中..." : "申し込みを送信する"}
            </button>
          </form>

          {/* Summary */}
          <div className="space-y-4">
            <div className="rounded-xl border p-5 sticky top-6" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
              <h3 className="text-sm font-semibold text-slate-300 mb-4">お申し込み内容</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-slate-500">プラン</p>
                  <p className="text-base font-bold text-slate-100">{planInfo.name}</p>
                </div>
                <div className="border-t pt-3 space-y-1.5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">月額（税抜）</span>
                    <span className="text-slate-300">¥{planInfo.price.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">消費税（10%）</span>
                    <span className="text-slate-300">¥{planInfo.tax.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t pt-2" style={{ borderColor: "var(--border)" }}>
                    <span className="text-slate-200">月額合計</span>
                    <span className="text-slate-100">¥{planInfo.total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 text-xs text-slate-500">
                <p>お申し込み後、<strong className="text-slate-400">3営業日以内</strong>に担当者よりご連絡します。</p>
                <p>振込先口座はご連絡時にご案内いたします（問い合わせフォーム経由で個別案内）。</p>
                <p>ご入金確認後にサービスを有効化します。</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function InvoiceRequestPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "var(--bg-primary)" }} />}>
      <InvoiceRequestForm />
    </Suspense>
  );
}
