"use client";

import { useState } from "react";
import Link from "next/link";


const INQUIRY_TYPES = [
  "サービスへのご質問",
  "無料試用のお申し込み",
  "請求書払いのご相談",
  "その他",
];

const inputClass =
  "w-full rounded-lg border px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

export default function ContactPage() {
  const [inquiryType, setInquiryType] = useState("");
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError("個人情報の取り扱いへの同意が必要です");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryType, orgName, name, email, body }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "送信に失敗しました");
        return;
      }
      setDone(true);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <header className="border-b" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <div className="max-w-4xl mx-auto px-6 py-4">
            <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent neu-button-primary"
              style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
              Sinap-sys
            </Link>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border p-10 text-center space-y-6"
            style={{ background: "var(--bg-secondary)", borderColor: "#10b98130" }}>
            <div className="flex items-center justify-center w-16 h-16 rounded-full mx-auto"
              style={{ background: "#10b98120" }}>
              <svg width={32} height={32} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100 mb-2">お問い合わせを受け付けました</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                3営業日以内にご連絡します。
                <br />
                ご登録のメールアドレスに自動返信メールをお送りしました。
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <Link href="/"
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200">
                トップへ戻る
              </Link>
              <span className="text-slate-600">|</span>
              <Link href="/pricing"
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200">
                料金プランを見る
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <header className="border-b" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent neu-button-primary"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            Sinap-sys
          </Link>
          <div className="flex gap-4 text-sm">
            <Link href="/pricing" className="text-slate-500 hover:text-slate-300 transition-colors duration-200">料金プラン</Link>
            <Link href="/terms" className="text-slate-500 hover:text-slate-300 transition-colors duration-200">利用規約</Link>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16 flex-1 w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-100 mb-2">お問い合わせ</h1>
          <p className="text-sm text-slate-500">
            ご質問・ご相談はこちらのフォームよりお送りください。
            <strong className="text-slate-400"> 3営業日以内</strong>にご連絡します。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
              style={{ background: "#ef444410", borderColor: "#ef444430" }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              お問い合わせ種別 <span className="text-red-400">*</span>
            </label>
            <select
              required
              value={inquiryType}
              onChange={(e) => setInquiryType(e.target.value)}
              className={inputClass}
              style={{ ...inputStyle, appearance: "auto" }}
            >
              <option value="" disabled>選択してください</option>
              {INQUIRY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              組織名（自治体名・法人名） <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例: ○○市役所、○○株式会社"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              お名前 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例: 田中 太郎"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              メールアドレス <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例: tanaka@city.example.jp"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              お問い合わせ内容 <span className="text-red-400">*</span>
            </label>
            <textarea
              required
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="ご質問・ご相談の内容をご記入ください"
            />
          </div>

          <div className="flex items-start gap-3 pt-1">
            <input
              id="agree"
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-indigo-500"
            />
            <label htmlFor="agree" className="text-sm text-slate-400 leading-relaxed cursor-pointer">
              <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300 underline" target="_blank">
                プライバシーポリシー
              </Link>
              に同意の上、個人情報を送信します。
              <span className="text-red-400 ml-1">*</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || !agreed}
            className="w-full text-white py-3 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {submitting ? "送信中..." : "送信する"}
          </button>
        </form>

        <div className="mt-10 rounded-xl border p-4 text-xs text-slate-500 space-y-1" style={{ borderColor: "var(--border)" }}>
          <p className="font-medium text-slate-400">株式会社 Ordo</p>
          <p>熊本県上益城郡御船町上野1652番地1</p>
          <p>※ 電話番号・メールアドレスは非公開です。お問い合わせはフォームよりお願いします。</p>
        </div>
      </main>

    </div>
  );
}
