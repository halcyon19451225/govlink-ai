"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_LINKS = [
  { href: "/dashboard", label: "ホーム" },
  { href: "/resources", label: "組織リソース" },
];

const HOWTO_TOOLTIP =
  "QCストーリーに基づくPDCAサイクルで\n計画策定から改善まで一貫管理。\nP（計画）→ D（実行）→ C（評価）→ A（改善）\nの4ステージで政策の継続的改善を支援します。";

export default function NavBar() {
  const pathname = usePathname();
  const [showEbpmTip, setShowEbpmTip] = useState(false);
  const [showHowtoTip, setShowHowtoTip] = useState(false);

  return (
    <header
      className="border-b sticky top-0 z-10"
      style={{
        background: "#1a1d27",
        borderColor: "#2a2d3a",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-8">
        {/* ロゴ */}
        <Link href="/dashboard" className="no-underline shrink-0">
          <span
            className="text-xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            Sinap-sys
          </span>
        </Link>

        {/* 中央ナビ */}
        <nav className="flex items-center gap-1 flex-1">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors duration-200 ${
                  active
                    ? "text-slate-100 font-medium"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                }`}
                style={active ? { background: "#ffffff10" } : {}}
              >
                {link.label}
              </Link>
            );
          })}

          {/* 使い方（ツールチップ付き） */}
          <div className="relative">
            <button
              onMouseEnter={() => setShowHowtoTip(true)}
              onMouseLeave={() => setShowHowtoTip(false)}
              className="text-sm px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors duration-200"
            >
              使い方
            </button>
            {showHowtoTip && (
              <div
                className="absolute left-0 top-full mt-2 w-72 rounded-xl border p-4 z-50 shadow-2xl"
                style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}
              >
                <p className="text-xs font-semibold text-slate-100 mb-2">PDCAサイクルによる政策管理</p>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">
                  {HOWTO_TOOLTIP}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {(["P: 計画", "D: 実行", "C: 評価", "A: 改善"] as const).map((s, i) => {
                    const colors = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981"];
                    return (
                      <span
                        key={s}
                        className="text-xs px-2 py-1 rounded-lg text-center font-semibold"
                        style={{ background: colors[i] + "20", color: colors[i] }}
                      >
                        {s}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* EBPMについてツールチップ */}
        <div className="relative shrink-0">
          <button
            onMouseEnter={() => setShowEbpmTip(true)}
            onMouseLeave={() => setShowEbpmTip(false)}
            className="text-xs text-slate-500 hover:text-cyan-400 transition-colors duration-200 border rounded-lg px-3 py-1.5"
            style={{ borderColor: "#2a2d3a" }}
          >
            EBPMとは？
          </button>
          {showEbpmTip && (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-xl border p-4 z-50 text-xs text-slate-300 leading-relaxed shadow-2xl"
              style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}
            >
              <p className="font-semibold text-slate-100 mb-1.5">EBPM（証拠に基づく政策立案）とは</p>
              <p>
                政策の立案・実施・評価において、勘や慣例ではなく客観的なデータやエビデンスを活用する手法です。
              </p>
              <p className="mt-2">
                Sinap-sys の EBPM ダッシュボードでは、KPI達成状況・エビデンス充足度・ベンチマーク比較・AI改善提案をまとめて確認できます。
              </p>
            </div>
          )}
        </div>

        {/* ログアウト */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors duration-200 border rounded-lg px-3 py-1.5 shrink-0"
          style={{ borderColor: "#2a2d3a" }}
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
