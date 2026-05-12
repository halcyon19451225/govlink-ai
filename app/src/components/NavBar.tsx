"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "@/contexts/ThemeContext";
import SearchBox from "@/components/SearchBox";

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const second = parts[1] ?? "";
  if (parts.length >= 2 && first && second) return (first[0]! + second[0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function AvatarButton({
  onClick,
  image,
  name,
}: {
  onClick: () => void;
  image?: string | null;
  name?: string | null;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center rounded-full overflow-hidden shrink-0 hover:ring-2 hover:ring-cyan-500 transition-all duration-200"
      style={{ width: 36, height: 36 }}
      aria-label="アカウントメニュー"
    >
      {image ? (
        <Image src={image} alt={name ?? "avatar"} width={36} height={36} style={{ objectFit: "cover" }} />
      ) : (
        <span
          className="w-full h-full flex items-center justify-center text-xs font-bold text-white"
          style={{ background: "linear-gradient(135deg, #06b6d4, #6366f1)" }}
        >
          {getInitials(name)}
        </span>
      )}
    </button>
  );
}

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"
    fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/>
    <path strokeLinecap="round" d="M21 21l-4.35-4.35"/>
  </svg>
);

export default function NavBar() {
  const { data: session } = useSession();
  const [showAccount, setShowAccount] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const accountRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccount(false);
      }
      if (mobileSearchRef.current && !mobileSearchRef.current.contains(e.target as Node)) {
        setMobileSearch(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const avatarSrc = session?.user?.image ?? session?.user?.avatarUrl ?? null;
  const userName = session?.user?.name ?? null;
  const userEmail = session?.user?.email ?? null;

  return (
    <header
      className="glass-dark sticky top-0 z-50 border-b-0"
      style={{ borderRadius: 0 }}
    >
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center">
        {/* ロゴ */}
        <Link href="/dashboard" className="no-underline shrink-0 flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-coe.png" alt="Coe" style={{ height: 52, width: "auto" }} />
        </Link>

        {/* スペーサー */}
        <div style={{ flexGrow: 1 }} />

        {/* 右端: 検索 + アカウント */}
        <div className="flex items-center" style={{ gap: 12 }}>
          {/* デスクトップ検索 */}
          <div className="hidden md:block">
            <SearchBox />
          </div>

          {/* モバイル検索アイコン */}
          <div className="md:hidden relative" ref={mobileSearchRef}>
            <button
              type="button"
              onClick={() => setMobileSearch((v) => !v)}
              className="flex items-center justify-center rounded-xl hover:bg-white/10 transition-colors duration-200"
              style={{
                width: 36, height: 36,
                color: "var(--text-secondary)",
              }}
              aria-label="検索"
            >
              <SearchIcon />
            </button>

            {mobileSearch && (
              <div
                className="absolute right-0 top-full mt-2 z-50"
                style={{ width: "min(320px, 90vw)" }}
              >
                <SearchBox />
              </div>
            )}
          </div>

          {/* アカウントアバター */}
          <div className="relative shrink-0" ref={accountRef}>
            <AvatarButton
              onClick={() => setShowAccount((v) => !v)}
              image={avatarSrc}
              name={userName}
            />

            {showAccount && (
              <div
                className="glass-dark is-popup absolute right-0 top-full mt-2 w-72 overflow-hidden z-50 shadow-2xl"
                style={{ boxShadow: "0 20px 50px rgba(0,0,0,0.4)" }}
              >
                {/* ユーザー情報 */}
                <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="rounded-full overflow-hidden shrink-0" style={{ width: 48, height: 48 }}>
                    {avatarSrc ? (
                      <Image src={avatarSrc} alt={userName ?? "avatar"} width={48} height={48}
                        style={{ objectFit: "cover" }} />
                    ) : (
                      <span
                        className="flex items-center justify-center text-sm font-bold text-white"
                        style={{
                          display: "flex", width: 48, height: 48,
                          background: "linear-gradient(135deg, #06b6d4, #6366f1)",
                        }}
                      >
                        {getInitials(userName)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {userName ?? "ユーザー"}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                      {userEmail ?? ""}
                    </p>
                  </div>
                </div>

                {/* メニュー項目 */}
                <div className="py-1">
                  <Link href="/settings/account" onClick={() => setShowAccount(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors duration-200"
                    style={{ color: "var(--text-primary)" }}>
                    <span className="text-base">👤</span>アカウントを管理
                  </Link>
                  <Link href="/settings/municipality" onClick={() => setShowAccount(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors duration-200"
                    style={{ color: "var(--text-primary)" }}>
                    <span className="text-base">🏛</span>自治体設定
                  </Link>

                  {/* テーマ切替 */}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-base">{theme === "dark" ? "🌙" : "☀️"}</span>
                      <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                        {theme === "dark" ? "ダークモード" : "ライトモード"}
                      </span>
                    </div>
                    <button
                      type="button" onClick={toggleTheme} aria-label="テーマ切替"
                      style={{
                        position: "relative", width: 40, height: 22, borderRadius: 11,
                        border: "none", cursor: "pointer",
                        background: theme === "dark"
                          ? "linear-gradient(135deg, #1e293b, #0f172a)"
                          : "linear-gradient(135deg, #e2e8f0, #cbd5e1)",
                        transition: "background 0.3s ease",
                      }}
                    >
                      <span style={{
                        position: "absolute", top: 3, left: 0, width: 16, height: 16,
                        borderRadius: "50%",
                        background: theme === "dark" ? "#ffffff" : "#1e293b",
                        transform: theme === "dark" ? "translateX(21px)" : "translateX(3px)",
                        transition: "transform 0.25s ease, background 0.25s ease",
                      }} />
                    </button>
                  </div>

                  {/* 設定 */}
                  <Link href="/settings/account" onClick={() => setShowAccount(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors duration-200"
                    style={{ color: "var(--text-primary)" }}>
                    <span className="text-base">⚙️</span>設定
                  </Link>

                  {/* ヘルプ */}
                  <Link href="/help" onClick={() => setShowAccount(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/5 transition-colors duration-200"
                    style={{ color: "var(--text-primary)" }}>
                    <span className="text-base">❓</span>ヘルプ
                  </Link>
                </div>

                <div className="border-t py-1" style={{ borderColor: "var(--border)" }}>
                  <button
                    onClick={() => { setShowAccount(false); signOut({ callbackUrl: "/login" }); }}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-red-500/10 transition-colors duration-200"
                    style={{ color: "#f87171" }}
                  >
                    <span className="text-base">🚪</span>ログアウト
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
