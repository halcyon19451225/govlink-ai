"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "@/contexts/ThemeContext";

const NAV_LINKS = [
  { href: "/dashboard", label: "ホーム" },
  { href: "/resources", label: "組織リソース" },
  { href: "/contact", label: "お問い合わせ" },
];

const SETTINGS_LINKS = [
  { href: "/templates", label: "テンプレート管理" },
  { href: "/settings/users", label: "ユーザー管理" },
  { href: "/billing", label: "プラン・請求" },
];

const HOWTO_TOOLTIP =
  "QCストーリーに基づくPDCAサイクルで\n計画策定から改善まで一貫管理。\nP（計画）→ D（実行）→ C（評価）→ A（改善）\nの4ステージで政策の継続的改善を支援します。";

export default function NavBar() {
  const pathname = usePathname();
  const [showEbpmTip, setShowEbpmTip] = useState(false);
  const [showHowtoTip, setShowHowtoTip] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <header
      className="border-b sticky top-0 z-10"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-8">
        {/* ロゴ */}
        <Link href="/dashboard" className="no-underline shrink-0 flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-coe.png" alt="Coe" style={{ height: 52, width: "auto" }} />
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
                  active ? "font-medium" : "hover:bg-white/5"
                }`}
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  background: active ? "rgba(255,255,255,0.06)" : undefined,
                }}
              >
                {link.label}
              </Link>
            );
          })}

          {/* 設定ドロップダウン */}
          <div className="relative">
            <button
              onMouseEnter={() => setShowSettings(true)}
              onMouseLeave={() => setShowSettings(false)}
              className="text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200 flex items-center gap-1"
              style={{ color: "var(--text-secondary)" }}
            >
              設定
              <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSettings && (
              <div
                className="absolute left-0 top-full mt-1 w-44 rounded-xl border shadow-2xl overflow-hidden z-50"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
                onMouseEnter={() => setShowSettings(true)}
                onMouseLeave={() => setShowSettings(false)}
              >
                {SETTINGS_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block px-4 py-2.5 text-sm hover:bg-white/5 transition-colors duration-200"
                    style={{ color: "var(--text-secondary)" }}
                    onClick={() => setShowSettings(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 使い方 */}
          <div className="relative">
            <button
              onMouseEnter={() => setShowHowtoTip(true)}
              onMouseLeave={() => setShowHowtoTip(false)}
              className="text-sm px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200"
              style={{ color: "var(--text-secondary)" }}
            >
              使い方
            </button>
            {showHowtoTip && (
              <div
                className="absolute left-0 top-full mt-2 w-72 rounded-xl border p-4 z-50 shadow-2xl"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                  PDCAサイクルによる政策管理
                </p>
                <p
                  className="text-xs leading-relaxed whitespace-pre-line"
                  style={{ color: "var(--text-secondary)" }}
                >
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
            className="text-xs hover:text-cyan-400 transition-colors duration-200 border rounded-lg px-3 py-1.5"
            style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
          >
            EBPMとは？
          </button>
          {showEbpmTip && (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-xl border p-4 z-50 text-xs leading-relaxed shadow-2xl"
              style={{
                background: "var(--bg-secondary)",
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <p className="font-semibold mb-1.5" style={{ color: "var(--text-primary)" }}>
                EBPM（証拠に基づく政策立案）とは
              </p>
              <p>
                政策の立案・実施・評価において、勘や慣例ではなく客観的なデータやエビデンスを活用する手法です。
              </p>
              <p className="mt-2">
                Coe の EBPMダッシュボードでは、KPI達成状況・エビデンス充足度・ベンチマーク比較・AI改善提案をまとめて確認できます。
              </p>
            </div>
          )}
        </div>

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

        {/* ログアウト */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-xs hover:text-red-400 transition-colors duration-200 border rounded-lg px-3 py-1.5 shrink-0"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
