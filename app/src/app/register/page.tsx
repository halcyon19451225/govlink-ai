"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

const inputClass =
  "w-full rounded-lg border px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };

export default function RegisterPage() {
  const [municipalityName, setMunicipalityName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ municipalityName, displayName, email, password }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) { setError(json.error ?? "登録に失敗しました"); return; }

      // 登録成功後、自動ログイン
      await signIn("cognito", { callbackUrl: "/dashboard" });
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0f1117" }}>
      {/* 背景グロー */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-3xl"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="text-3xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            Sinap-sys
          </Link>
          <p className="text-sm text-slate-500 mt-2">30日間無料でご利用いただけます</p>
        </div>

        <div className="rounded-2xl border p-8 shadow-2xl" style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}>
          <h1 className="text-xl font-bold text-slate-100 mb-6">アカウントを作成</h1>

          {error && (
            <div className="rounded-lg border px-4 py-3 text-sm text-red-400 mb-4"
              style={{ background: "#ef444410", borderColor: "#ef444430" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                自治体名・組織名 <span className="text-red-400">*</span>
              </label>
              <input type="text" required value={municipalityName}
                onChange={(e) => setMunicipalityName(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: ○○市、○○町" autoFocus />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                担当者名 <span className="text-red-400">*</span>
              </label>
              <input type="text" required value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: 山田 太郎" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                メールアドレス <span className="text-red-400">*</span>
              </label>
              <input type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: yamada@city.example.jp" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                パスワード <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass} style={inputStyle}
                  placeholder="8文字以上" />
                <button type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs transition-colors duration-200">
                  {showPassword ? "非表示" : "表示"}
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-1">大小英字・数字・記号を含む8文字以上</p>
            </div>

            <button type="submit" disabled={submitting}
              className="w-full text-white py-3 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 mt-2"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
              {submitting ? "登録中..." : "無料で始める（30日間）"}
            </button>
          </form>

          <p className="text-xs text-slate-600 text-center mt-4 leading-relaxed">
            登録することで
            <Link href="/terms" className="text-slate-500 hover:text-slate-300 underline mx-1">利用規約</Link>
            および
            <Link href="/privacy" className="text-slate-500 hover:text-slate-300 underline mx-1">プライバシーポリシー</Link>
            に同意したものとみなします。
          </p>

          <div className="border-t mt-6 pt-5 text-center" style={{ borderColor: "#2a2d3a" }}>
            <span className="text-sm text-slate-500">すでにアカウントをお持ちの方は </span>
            <Link href="/login" className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200">
              ログイン
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
