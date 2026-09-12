"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

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
            ご利用には有料プランの契約、または組織から発行された許諾コードが必要です
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
