"use client";

import { useEffect } from "react";

export default function Error({
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
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-10 flex flex-col items-center gap-6 text-center"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}
      >
        <span className="text-5xl opacity-60">⚠️</span>
        <div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">エラーが発生しました</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            {error.message || "予期しないエラーが発生しました。"}
          </p>
        </div>
        <button
          onClick={reset}
          className="text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          再試行
        </button>
      </div>
    </div>
  );
}
