"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const LineIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
  </svg>
);

const GithubIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);

const PersonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
  </svg>
);

const inputClass =
  "neu-input w-full text-sm focus:outline-none transition-colors duration-200";
const inputStyle = {
  color: "var(--text-primary)",
};

export default function RegisterPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [municipalityName, setMunicipalityName] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback((file: File) => {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      setError("JPG・PNG・GIF・WebPのみアップロードできます");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("ファイルサイズは5MB以下にしてください");
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setAvatarPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== passwordConfirm) { setError("パスワードが一致しません"); return; }
    if (!agreed) { setError("利用規約への同意が必要です"); return; }
    setSubmitting(true);
    setError(null);

    try {
      let avatarUrl: string | null = null;

      if (avatarFile) {
        const fd = new FormData();
        fd.append("file", avatarFile);
        const uploadRes = await fetch("/api/upload/avatar", { method: "POST", body: fd });
        const uploadJson = (await uploadRes.json()) as { data: { url: string } | null; error: string | null };
        if (!uploadRes.ok) {
          setError(uploadJson.error ?? "画像のアップロードに失敗しました");
          return;
        }
        avatarUrl = uploadJson.data?.url ?? null;
      }

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ municipalityName, displayName, email, password, avatarUrl }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) { setError(json.error ?? "登録に失敗しました"); return; }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        await signIn("cognito", { callbackUrl: "/dashboard" });
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSocial = async (provider: string) => {
    setSocialLoading(provider);
    await signIn(provider, { callbackUrl: "/dashboard" });
    setSocialLoading(null);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* 背景グロー */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-3xl"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        />
      </div>

      <div className="relative w-full max-w-md">
        {/* ロゴ */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <Image src="/logo-coe.svg" alt="Coe" width={80} height={40} style={{ objectFit: "contain" }} />
          </Link>
          <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
            30日間無料でご利用いただけます
          </p>
        </div>

        <div
          className="rounded-2xl border p-8 shadow-2xl"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border, rgba(255,255,255,0.1))",
          }}
        >
          <h1 className="text-xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
            アカウントを作成
          </h1>

          {/* ソーシャル登録 */}
          <div className="flex gap-2 mb-6">
            {[
              { id: "google", label: "Googleで登録", icon: <GoogleIcon />, bg: "#ffffff", color: "#1f2937" },
              { id: "line", label: "LINEで登録", icon: <LineIcon />, bg: "#06C755", color: "#ffffff" },
              { id: "github", label: "GitHubで登録", icon: <GithubIcon />, bg: "#24292f", color: "#ffffff" },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                disabled={socialLoading !== null}
                onClick={() => handleSocial(btn.id)}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: btn.bg, color: btn.color, border: "1px solid rgba(255,255,255,0.15)" }}
              >
                {btn.icon}
                <span className="text-[10px]">{socialLoading === btn.id ? "..." : btn.label.split("で")[0]}</span>
              </button>
            ))}
          </div>

          {/* 区切り */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>または、メールアドレスで登録</span>
            <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
          </div>

          {/* エラー */}
          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm border mb-4"
              style={{ background: "#ef444410", borderColor: "#ef444440", color: "#f87171" }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* プロフィール写真 */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className="relative w-24 h-24 rounded-full overflow-hidden transition-all duration-200 hover:opacity-80"
                style={{
                  background: avatarPreview ? "transparent" : "var(--bg-input)",
                  border: `2px ${isDragging ? "solid #06b6d4" : "dashed rgba(255,255,255,0.2)"}`,
                }}
                title="クリックまたはドラッグ&ドロップで写真を選択"
              >
                {avatarPreview ? (
                  <Image src={avatarPreview} alt="プレビュー" fill style={{ objectFit: "cover" }} />
                ) : (
                  <span style={{ color: "var(--text-secondary)" }}>
                    <PersonIcon />
                  </span>
                )}
                <div
                  className="absolute inset-0 flex items-end justify-center pb-2 opacity-0 hover:opacity-100 transition-opacity duration-200"
                  style={{ background: "rgba(0,0,0,0.5)" }}
                >
                  <span className="text-white text-xs font-medium">変更</span>
                </div>
              </button>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                プロフィール写真（任意）
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              />
            </div>

            {/* 氏名 */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                氏名 <span className="text-red-400">*</span>
              </label>
              <input
                type="text" required value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: 山田 太郎" autoFocus
              />
            </div>

            {/* メール */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                メールアドレス <span className="text-red-400">*</span>
              </label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: yamada@city.example.jp"
              />
            </div>

            {/* パスワード */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                パスワード <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"} required value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass} style={{ ...inputStyle, paddingRight: "3.5rem" }}
                  placeholder="8文字以上"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs transition-colors duration-200"
                  style={{ color: "var(--text-secondary)" }}>
                  {showPassword ? "非表示" : "表示"}
                </button>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)", opacity: 0.6 }}>
                大小英字・数字・記号を含む8文字以上
              </p>
            </div>

            {/* パスワード確認 */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                パスワード（確認） <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPasswordConfirm ? "text" : "password"} required value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className={inputClass} style={{ ...inputStyle, paddingRight: "3.5rem" }}
                  placeholder="もう一度入力"
                />
                <button type="button" onClick={() => setShowPasswordConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs transition-colors duration-200"
                  style={{ color: "var(--text-secondary)" }}>
                  {showPasswordConfirm ? "非表示" : "表示"}
                </button>
              </div>
            </div>

            {/* 自治体名 */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                自治体名・組織名 <span className="text-red-400">*</span>
              </label>
              <input
                type="text" required value={municipalityName}
                onChange={(e) => setMunicipalityName(e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: ○○市、○○町"
              />
            </div>

            {/* 利用規約 */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 rounded accent-cyan-500"
              />
              <span className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                <Link href="/terms" className="text-cyan-400 hover:text-cyan-300 transition-colors duration-200">
                  利用規約
                </Link>
                {" "}および{" "}
                <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300 transition-colors duration-200">
                  プライバシーポリシー
                </Link>
                {" "}に同意する <span className="text-red-400">*</span>
              </span>
            </label>

            {/* 送信ボタン */}
            <div className="neu-button-wrap w-full mt-2">
              <button
                type="submit" disabled={submitting}
                className="w-full text-white py-3 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-cyan-500/20 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
              >
                {submitting ? "登録中..." : "登録する"}
              </button>
            </div>
          </form>

          <div className="border-t mt-6 pt-5 text-center" style={{ borderColor: "var(--border)" }}>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>すでにアカウントをお持ちの方は </span>
            <Link href="/login" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors duration-200">
              こちら
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
