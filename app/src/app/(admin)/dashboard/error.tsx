"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="rounded-2xl border p-10 flex flex-col items-center gap-6 text-center max-w-md mx-auto mt-12"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "#ef444430",
        boxShadow: "0 4px 24px rgba(239,68,68,0.08)",
      }}
    >
      <span className="text-4xl opacity-60">⚠️</span>
      <div>
        <h2 className="text-lg font-bold text-slate-100 mb-2">
          ダッシュボードの読み込みに失敗しました
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          {error.message || "データの取得中にエラーが発生しました。"}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="text-white px-5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          再試行
        </button>
        <Link
          href="/dashboard"
          className="text-sm font-medium px-5 py-2 rounded-xl border hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-200 text-slate-400"
          style={{ borderColor: "var(--border)" }}
        >
          ページを再読み込み
        </Link>
      </div>
    </div>
  );
}
