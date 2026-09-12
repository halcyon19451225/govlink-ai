"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";

/** Ordo の組織管理者ページ。氏名・所属・利用者の追加はここが正本 */
const ORG_ADMIN_URL = process.env.NEXT_PUBLIC_ORG_ADMIN_URL ?? "https://ordo.jp/org";

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

export default function AccountSettingsPage() {
  const { data: session, update: updateSession } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    session?.user?.image ?? session?.user?.avatarUrl ?? null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

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

      {/* 台帳の情報（表示のみ）
        *
        * 氏名・所属・メールは Ordo の組織台帳が正本で、ログインのたびに同期される
        * （lib/user-provisioning.ts）。ここで編集できるようにすると、保存はできるのに
        * 次のログインで元へ戻る、という分かりにくい壊れ方をする。実際そうなっていた。
        */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          氏名・所属・メールアドレス
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          これらは所属組織の台帳で管理されています。変更は組織のご担当者にご依頼ください。
        </p>

        <dl className="space-y-3">
          {[
            { k: "氏名", v: session?.user?.name ?? "—" },
            { k: "所属", v: session?.user?.department ?? "—" },
            { k: "メールアドレス", v: session?.user?.email ?? "—" },
          ].map((row) => (
            <div key={row.k} className="flex items-baseline gap-4">
              <dt className="text-xs shrink-0" style={{ color: "var(--text-secondary)", width: "8rem" }}>{row.k}</dt>
              <dd className="text-sm" style={{ color: "var(--text-primary)" }}>{row.v}</dd>
            </div>
          ))}
        </dl>

        {(session?.user?.role === "admin" || session?.user?.isOrgAdmin) && (
          <a
            href={ORG_ADMIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-5 text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors duration-200"
          >
            組織・利用者の管理を開く ↗
          </a>
        )}
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
          <div className="neu-button-wrap">
            <button
            type="submit" disabled={passwordLoading}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
          >
            {passwordLoading ? "変更中..." : "パスワードを変更"}
          </button>
          </div>
        </form>
      </div>

      {/* アカウントの削除は Coe からは行わない
        *
        * Ordo ID は Libera・Coe・Akoya・組織管理者ページで共通のアカウント。
        * ここから Cognito のユーザーごと消すと、**他のサービスからも締め出される**し、
        * Ordo 台帳の MemberCode.ordoSub が宙に浮く。組織が契約して招待したアカウントを
        * 利用者本人が消せるのは、権限の設計としても逆。退職処理は台帳側で行う。
        */}
      <div className={sectionClass} style={sectionStyle}>
        <h2 className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          アカウントの停止
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Ordo ID は Libera・Coe・Akoya で共通のアカウントのため、Coe から削除することはできません。
          退職・異動などで利用を終える場合は、所属組織のご担当者にご依頼ください。
          台帳で退職として登録すると、各サービスの利用が停止されます。
        </p>
      </div>
    </div>
  );
}
