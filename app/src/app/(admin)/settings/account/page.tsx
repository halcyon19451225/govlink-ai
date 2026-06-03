"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";

const sectionClass =
  "rounded-2xl border p-6 mb-6";
const sectionStyle = {
  background: "var(--bg-secondary)",
  borderColor: "var(--border)",
};

const inputClass =
  "w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors duration-200";
const inputStyle = {
  background: "var(--bg-input)",
  borderColor: "var(--border)",
  color: "var(--text-primary)",
};

const PersonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
  </svg>
);

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={connected
        ? { background: "#10b98120", color: "#10b981" }
        : { background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }
      }
    >
      {connected ? "連携済み" : "未連携"}
    </span>
  );
}

export default function AccountSettingsPage() {
  const { data: session, update: updateSession } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    session?.user?.image ?? session?.user?.avatarUrl ?? null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const [displayName, setDisplayName] = useState(session?.user?.name ?? "");
  const [nameLoading, setNameLoading] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      setError("JPG・PNG・GIF・WebPのみアップロードできます");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("ファイルサイズは5MB以下にしてください");
      return;
    }
    setError(null);

    // プレビュー
    const reader = new FileReader();
    reader.onload = (e) => setAvatarPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    // アップロード
    setAvatarLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/avatar", { method: "POST", body: fd });
      const json = (await res.json()) as { data: { url: string } | null; error: string | null };
      if (!res.ok) { setError(json.error ?? "アップロードに失敗しました"); return; }
      if (json.data?.url) {
        setAvatarPreview(json.data.url);
        await updateSession();
      }
    } catch {
      setError("アップロードに失敗しました");
    } finally {
      setAvatarLoading(false);
    }
  }, [updateSession]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleNameSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setNameLoading(true);
    try {
      const res = await fetch("/api/admin/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (res.ok) {
        setNameSaved(true);
        await updateSession();
        setTimeout(() => setNameSaved(false), 2000);
      }
    } finally {
      setNameLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== newPasswordConfirm) {
      setPasswordMessage({ type: "error", text: "新しいパスワードが一致しません" });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMessage({ type: "error", text: "パスワードは8文字以上にしてください" });
      return;
    }
    setPasswordLoading(true);
    setPasswordMessage(null);
    try {
      const res = await fetch("/api/admin/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = (await res.json()) as { error: string | null };
      if (res.ok) {
        setPasswordMessage({ type: "ok", text: "パスワードを変更しました" });
        setCurrentPassword(""); setNewPassword(""); setNewPasswordConfirm("");
      } else {
        setPasswordMessage({ type: "error", text: json.error ?? "パスワード変更に失敗しました" });
      }
    } catch {
      setPasswordMessage({ type: "error", text: "通信エラーが発生しました" });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") return;
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/admin/profile/delete", { method: "DELETE" });
      if (res.ok) {
        await signOut({ callbackUrl: "/" });
      } else {
        setError("アカウントの削除に失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setDeleteLoading(false);
    }
  };

  const socialProviders = [
    { id: "google", label: "Google", icon: "G", color: "#4285F4" },
    { id: "apple", label: "Apple", icon: "", color: "#ffffff" },
    { id: "azure-ad", label: "Microsoft", icon: "M", color: "#2563eb" },
  ];

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-8" style={{ color: "var(--text-primary)" }}>
        アカウントを管理
      </h1>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm border mb-6"
          style={{ background: "#ef444410", borderColor: "#ef444440", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {/* プロフィール写真 */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          プロフィール写真
        </h2>
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            disabled={avatarLoading}
            className="relative w-24 h-24 rounded-full overflow-hidden transition-all duration-200 hover:opacity-80 disabled:opacity-50"
            style={{
              background: avatarPreview ? "transparent" : "var(--bg-input)",
              border: `2px ${isDragging ? "solid #06b6d4" : "dashed rgba(255,255,255,0.2)"}`,
            }}
          >
            {avatarPreview ? (
              <Image src={avatarPreview} alt="avatar" fill style={{ objectFit: "cover" }} />
            ) : (
              <span style={{ color: "var(--text-secondary)" }}><PersonIcon /></span>
            )}
            {avatarLoading && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
                <span className="text-white text-xs">...</span>
              </div>
            )}
          </button>
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors duration-200"
            >
              写真を変更
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              JPG・PNG・GIF・WebP、5MB以下
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)", opacity: 0.6 }}>
              クリックまたはドラッグ&ドロップ
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
          />
        </div>
      </div>

      {/* 氏名変更 */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          氏名
        </h2>
        <form onSubmit={handleNameSave} className="flex gap-3">
          <input
            type="text" required value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={`${inputClass} flex-1`} style={inputStyle}
            placeholder="氏名を入力"
          />
          <button
            type="submit" disabled={nameLoading}
            className="px-5 py-3 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40 shrink-0 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
          >
            {nameSaved ? "保存済み ✓" : nameLoading ? "保存中..." : "保存"}
          </button>
        </form>
      </div>

      {/* メールアドレス */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          メールアドレス
        </h2>
        <div className={inputClass} style={{ ...inputStyle, opacity: 0.7, cursor: "not-allowed" }}>
          {session?.user?.email ?? "—"}
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-secondary)", opacity: 0.6 }}>
          メールアドレスの変更はサポートまでお問い合わせください。
        </p>
      </div>

      {/* パスワード変更 */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          パスワードの変更
        </h2>

        {passwordMessage && (
          <div
            className="rounded-xl px-4 py-3 text-sm border mb-4"
            style={passwordMessage.type === "ok"
              ? { background: "#10b98110", borderColor: "#10b98130", color: "#10b981" }
              : { background: "#ef444410", borderColor: "#ef444440", color: "#f87171" }
            }
          >
            {passwordMessage.text}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-3">
          <input
            type="password" required value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass} style={inputStyle}
            placeholder="現在のパスワード"
          />
          <input
            type="password" required value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass} style={inputStyle}
            placeholder="新しいパスワード（8文字以上）"
          />
          <input
            type="password" required value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
            className={inputClass} style={inputStyle}
            placeholder="新しいパスワード（確認）"
          />
          <button
            type="submit" disabled={passwordLoading}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
          >
            {passwordLoading ? "変更中..." : "パスワードを変更"}
          </button>
        </form>
      </div>

      {/* ソーシャルアカウント連携 */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          ソーシャルアカウントの連携
        </h2>
        <div className="space-y-3">
          {socialProviders.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between px-4 py-3 rounded-xl border"
              style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: p.color }}
                >
                  {p.icon}
                </span>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{p.label}</span>
              </div>
              <StatusBadge connected={false} />
            </div>
          ))}
        </div>
      </div>

      {/* アカウント削除 */}
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: "#ef444430", background: "#ef444408" }}
      >
        <h2 className="text-base font-semibold mb-2" style={{ color: "#f87171" }}>
          アカウントの削除
        </h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          アカウントを削除すると、すべてのデータが完全に失われます。この操作は取り消せません。
        </p>
        <div className="space-y-3">
          <input
            type="text" value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className={inputClass}
            style={{ ...inputStyle, borderColor: "#ef444440" }}
            placeholder='確認のため「DELETE」と入力してください'
          />
          <button
            type="button"
            disabled={deleteConfirm !== "DELETE" || deleteLoading}
            onClick={handleDeleteAccount}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "#ef4444" }}
          >
            {deleteLoading ? "削除中..." : "アカウントを削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}
