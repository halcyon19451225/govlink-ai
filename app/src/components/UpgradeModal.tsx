"use client";

import { useEffect } from "react";
import Link from "next/link";

interface UpgradeModalProps {
  message?: string;
  onClose: () => void;
}

export default function UpgradeModal({ message, onClose }: UpgradeModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl neu-card"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">⚡</span>
          <h3 className="text-lg font-bold text-slate-100">プランのアップグレードが必要です</h3>
        </div>

        <p className="text-sm text-slate-400 mb-5 leading-relaxed">
          {message ?? "現在のプランの上限に達しました。"}
          <br />
          プランをアップグレードして、制限を解除してください。
        </p>

        <div className="flex items-center gap-3">
          <div className="neu-button-wrap flex-1">
            <Link
            href="/pricing"
            className="w-full text-center text-sm font-semibold text-white px-4 py-2.5 rounded-xl transition-all duration-200 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            onClick={onClose}
          >
            プランを見る
          </Link>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2.5 rounded-xl border transition-colors duration-200"
            style={{ borderColor: "var(--border)" }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
