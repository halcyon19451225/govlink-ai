"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

interface ProvidersAvailable {
  google: boolean;
  line: boolean;
  github: boolean;
}

interface Props {
  providers: ProvidersAvailable;
}

// ────────────────────────────────────────────────
// アイコン
// ────────────────────────────────────────────────
const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const LineIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="white">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
  </svg>
);

const GithubIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="white">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);

const BackIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
  </svg>
);

const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#10b981" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l3 3 5-5"/>
  </svg>
);

// ────────────────────────────────────────────────
// 共通スタイル
// ────────────────────────────────────────────────
const inputBase =
  "neu-input w-full text-sm focus:outline-none transition-all duration-200";
const inputStyle = {
  color: "var(--text-primary)",
};

// ステップ定義
type Step = "login" | "forgot_email" | "forgot_verify" | "forgot_success";

// ────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────
export default function LoginForm({ providers }: Props) {
  const router = useRouter();

  // ログインフォーム
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);

  // パスワード再設定フロー
  const [step, setStep] = useState<Step>("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  // ──────────── ログイン ────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    clearError();
    try {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("メールアドレスまたはパスワードが正しくありません");
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("ログインに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (provider: "google" | "line" | "github") => {
    setSocialLoading(provider);
    await signIn(provider, { callbackUrl: "/dashboard" });
    setSocialLoading(null);
  };

  // ──────────── パスワードリセット ────────────
  const handleForgotSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    clearError();
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "送信に失敗しました");
        return;
      }
      setStep("forgot_verify");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setResetLoading(false);
    }
  };

  const handleForgotConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== newPasswordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    setResetLoading(true);
    clearError();
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "再設定に失敗しました");
        return;
      }
      setStep("forgot_success");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setResetLoading(false);
    }
  };

  const goBackToLogin = () => {
    setStep("login");
    setResetEmail("");
    setResetCode("");
    setNewPassword("");
    setNewPasswordConfirm("");
    clearError();
  };

  // ──────────── ソーシャルボタン定義 ────────────
  const socialButtons = [
    {
      id: "google" as const,
      label: providers.google ? "Google" : "設定中",
      icon: <GoogleIcon />,
      bg: providers.google ? "#ffffff" : undefined,
      color: providers.google ? "#1f2937" : undefined,
      disabled: !providers.google,
    },
    {
      id: "line" as const,
      label: providers.line ? "LINE" : "設定中",
      icon: <LineIcon />,
      bg: providers.line ? "#06C755" : undefined,
      color: providers.line ? "#ffffff" : undefined,
      disabled: !providers.line,
    },
    {
      id: "github" as const,
      label: providers.github ? "GitHub" : "設定中",
      icon: <GithubIcon />,
      bg: providers.github ? "#24292f" : undefined,
      color: providers.github ? "#ffffff" : undefined,
      disabled: !providers.github,
    },
  ];

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* 背景グロー */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-3xl"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        />
      </div>

      <div
        className="neu-card relative w-full max-w-[400px] p-8 flex flex-col gap-6"
        style={{}}
      >
        {/* ────── STEP: ログイン ────── */}
        {step === "login" && (
          <>
            {/* ロゴ */}
            <div className="flex flex-col items-center gap-1 pt-1">
              <Image src="/logo-coe.svg" alt="Coe" width={80} height={40} style={{ objectFit: "contain" }} priority />
              <h1 className="text-lg font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                Coeにログイン
              </h1>
            </div>

            {/* エラー */}
            {error && (
              <div
                className="rounded-xl px-4 py-3 text-sm border"
                style={{ background: "#ef444410", borderColor: "#ef444440", color: "#f87171" }}
              >
                {error}
              </div>
            )}

            {/* ログインフォーム */}
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  メールアドレス
                </label>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className={inputBase} style={inputStyle}
                  placeholder="mail@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    パスワード
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(email);
                      setStep("forgot_email");
                      clearError();
                    }}
                    className="text-xs transition-colors duration-200 hover:text-cyan-300"
                    style={{ color: "#06b6d4" }}
                  >
                    パスワードをお忘れの方
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"} required autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    className={inputBase} style={{ ...inputStyle, paddingRight: "3.5rem" }}
                    placeholder="パスワードを入力"
                  />
                  <button
                    type="button" onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs transition-colors duration-200"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {showPassword ? "非表示" : "表示"}
                  </button>
                </div>
              </div>

              <div className="neu-button-wrap w-full">
                <button
                  type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20 neu-button-primary"
                  style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
                >
                  {loading ? "ログイン中..." : "ログイン"}
                </button>
              </div>
            </form>

            {/* 区切り線 */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>または</span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
            </div>

            {/* ソーシャルログイン */}
            <div className="flex gap-2">
              {socialButtons.map((btn) => (
                <button
                  key={btn.id} type="button"
                  disabled={btn.disabled || socialLoading !== null}
                  onClick={() => !btn.disabled && handleSocial(btn.id as "google" | "line" | "github")}
                  className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium transition-all duration-200 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: btn.disabled ? "rgba(255,255,255,0.05)" : (btn.bg ?? "rgba(255,255,255,0.08)"),
                    color: btn.disabled ? "var(--text-secondary)" : (btn.color ?? "var(--text-primary)"),
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                  title={btn.disabled ? "現在設定中です" : undefined}
                >
                  <span className={btn.disabled ? "opacity-40" : ""}>{btn.icon}</span>
                  <span>{socialLoading === btn.id ? "..." : btn.label}</span>
                </button>
              ))}
            </div>

            {/* 登録リンク */}
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              アカウントをお持ちでない方は{" "}
              <Link href="/register" className="text-cyan-400 hover:text-cyan-300 transition-colors duration-200">
                こちら
              </Link>
            </p>
          </>
        )}

        {/* ────── STEP: メール入力（コード送信） ────── */}
        {step === "forgot_email" && (
          <>
            <div className="flex flex-col items-center gap-1 pt-1">
              <Image src="/logo-coe.svg" alt="Coe" width={80} height={40} style={{ objectFit: "contain" }} priority />
              <h1 className="text-lg font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                パスワードを再設定
              </h1>
              <p className="text-xs text-center mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                登録済みのメールアドレスを入力してください。<br />
                確認コードをお送りします。
              </p>
            </div>

            {error && (
              <div
                className="rounded-xl px-4 py-3 text-sm border"
                style={{ background: "#ef444410", borderColor: "#ef444440", color: "#f87171" }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleForgotSendCode} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  メールアドレス
                </label>
                <input
                  type="email" required autoFocus autoComplete="email"
                  value={resetEmail} onChange={(e) => setResetEmail(e.target.value)}
                  className={inputBase} style={inputStyle}
                  placeholder="mail@example.com"
                />
              </div>

              <div className="neu-button-wrap w-full">
                <button
                type="submit" disabled={resetLoading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
              >
                {resetLoading ? "送信中..." : "確認コードを送信"}
              </button>
              </div>
            </form>

            <button
              type="button" onClick={goBackToLogin}
              className="flex items-center justify-center gap-1.5 text-xs transition-colors duration-200 hover:text-cyan-300 mx-auto"
              style={{ color: "var(--text-secondary)" }}
            >
              <BackIcon />
              ログインに戻る
            </button>
          </>
        )}

        {/* ────── STEP: コード＋新パスワード入力 ────── */}
        {step === "forgot_verify" && (
          <>
            <div className="flex flex-col items-center gap-1 pt-1">
              <Image src="/logo-coe.svg" alt="Coe" width={80} height={40} style={{ objectFit: "contain" }} priority />
              <h1 className="text-lg font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                新しいパスワードを設定
              </h1>
              <p className="text-xs text-center mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>{resetEmail}</span><br />
                に送信した確認コードを入力してください。
              </p>
            </div>

            {error && (
              <div
                className="rounded-xl px-4 py-3 text-sm border"
                style={{ background: "#ef444410", borderColor: "#ef444440", color: "#f87171" }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleForgotConfirm} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  確認コード
                </label>
                <input
                  type="text" required autoFocus autoComplete="one-time-code"
                  value={resetCode} onChange={(e) => setResetCode(e.target.value.trim())}
                  className={inputBase}
                  style={{
                    ...inputStyle,
                    letterSpacing: "0.2em",
                    textAlign: "center",
                    fontSize: "1.1rem",
                  }}
                  placeholder="000000"
                  maxLength={8}
                  inputMode="numeric"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  新しいパスワード
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"} required
                    value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                    className={inputBase} style={{ ...inputStyle, paddingRight: "3.5rem" }}
                    placeholder="8文字以上"
                    autoComplete="new-password"
                  />
                  <button
                    type="button" onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs transition-colors duration-200"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {showNewPassword ? "非表示" : "表示"}
                  </button>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-secondary)", opacity: 0.6 }}>
                  大小英字・数字・記号を含む8文字以上
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  新しいパスワード（確認）
                </label>
                <input
                  type="password" required
                  value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  className={inputBase} style={inputStyle}
                  placeholder="もう一度入力"
                  autoComplete="new-password"
                />
              </div>

              <div className="neu-button-wrap w-full">
                <button
                type="submit" disabled={resetLoading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
              >
                {resetLoading ? "変更中..." : "パスワードを変更する"}
              </button>
              </div>
            </form>

            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => { setStep("forgot_email"); clearError(); }}
                className="text-xs transition-colors duration-200 hover:text-cyan-300"
                style={{ color: "var(--text-secondary)" }}
              >
                確認コードを再送信する
              </button>
              <button
                type="button" onClick={goBackToLogin}
                className="flex items-center gap-1.5 text-xs transition-colors duration-200 hover:text-cyan-300"
                style={{ color: "var(--text-secondary)" }}
              >
                <BackIcon />
                ログインに戻る
              </button>
            </div>
          </>
        )}

        {/* ────── STEP: 完了 ────── */}
        {step === "forgot_success" && (
          <div className="flex flex-col items-center gap-5 py-4">
            <Image src="/logo-coe.svg" alt="Coe" width={80} height={40} style={{ objectFit: "contain" }} priority />
            <CheckCircleIcon />
            <div className="text-center">
              <h1 className="text-lg font-bold mb-2" style={{ color: "var(--text-primary)" }}>
                パスワードを変更しました
              </h1>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                新しいパスワードでログインしてください。
              </p>
            </div>
            <div className="neu-button-wrap w-full">
              <button
              type="button" onClick={goBackToLogin}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 shadow-lg shadow-cyan-500/20 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
            >
              ログインへ戻る
            </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
