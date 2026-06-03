"use client";

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react";
import BackButton from "@/components/BackButton";
import UpgradeModal from "@/components/UpgradeModal";

interface UserRole {
  id: string;
  cognito_user_id: string;
  email: string;
  display_name: string;
  role: string;
  department: string | null;
  created_at: string;
}

const ROLE_OPTIONS = [
  { value: "admin",   label: "管理者",  color: "#f59e0b", bg: "#f59e0b15", border: "#f59e0b30" },
  { value: "manager", label: "主任担当", color: "#6366f1", bg: "#6366f115", border: "#6366f130" },
  { value: "member",  label: "担当者",  color: "#06b6d4", bg: "#06b6d415", border: "#06b6d430" },
  { value: "viewer",  label: "閲覧者",  color: "#64748b", bg: "#64748b15", border: "#64748b30" },
] as const;

const ROLE_MAP = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r]));

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

export default function UsersPage() {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserRole | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [cognitoId, setCognitoId] = useState("");
  const [role, setRole] = useState("member");
  const [department, setDepartment] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const json = (await res.json()) as { data: UserRole[] | null; error: string | null };
      if (json.data) setUsers(json.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchUsers(); }, []);

  const openCreate = () => {
    setEditUser(null);
    setEmail(""); setDisplayName(""); setCognitoId(""); setRole("member"); setDepartment("");
    setError(null);
    setShowForm(true);
  };

  const openEdit = (u: UserRole) => {
    setEditUser(u);
    setEmail(u.email);
    setDisplayName(u.display_name);
    setCognitoId(u.cognito_user_id);
    setRole(u.role);
    setDepartment(u.department ?? "");
    setError(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let res: Response;
      if (editUser) {
        res = await fetch(`/api/admin/users/${editUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, display_name: displayName, department: department || null }),
        });
      } else {
        res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email, display_name: displayName, cognito_user_id: cognitoId,
            role, department: department || null,
          }),
        });
      }
      const json = (await res.json()) as { data: unknown; error: string | null; upgrade_url?: string };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "プランの上限に達しました");
        } else {
          setError(json.error ?? "保存に失敗しました");
        }
        return;
      }
      setShowForm(false);
      await fetchUsers();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このユーザーを削除しますか？")) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
  };

  return (
    <div className="max-w-4xl space-y-8">
      {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
      {/* Form Modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border shadow-2xl neu-card"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-base font-bold text-slate-100">
                {editUser ? "ユーザー情報を編集" : "ユーザーを追加"}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-slate-300 text-xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              {error && (
                <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
                  style={{ background: "#ef444410", borderColor: "#ef444430" }}>
                  {error}
                </div>
              )}
              {!editUser && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Cognito ユーザーID <span className="text-red-400">*</span>
                    </label>
                    <input type="text" value={cognitoId}
                      onChange={(e) => setCognitoId(e.target.value)}
                      className={inputClass} style={inputStyle}
                      placeholder="Cognitoのsub値（UUID形式）" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      メールアドレス <span className="text-red-400">*</span>
                    </label>
                    <input type="email" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass} style={inputStyle}
                      placeholder="user@example.com" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  表示名 <span className="text-red-400">*</span>
                </label>
                <input type="text" value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputClass} style={inputStyle}
                  placeholder="例: 山田 太郎" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">担当課</label>
                <input type="text" value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className={inputClass} style={inputStyle}
                  placeholder="例: 高齢福祉課" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">ロール</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map((r) => (
                    <button key={r.value} type="button"
                      onClick={() => setRole(r.value)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all duration-200"
                      style={{
                        background: role === r.value ? r.bg : "transparent",
                        borderColor: role === r.value ? r.border : "var(--border)",
                        color: role === r.value ? r.color : "#64748b",
                      }}>
                      <div className="w-2 h-2 rounded-full"
                        style={{ background: role === r.value ? r.color : "#374151" }} />
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" onClick={handleSubmit} disabled={submitting || !displayName.trim()}
                className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
                {submitting ? "保存中..." : editUser ? "更新する" : "追加する"}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 transition-colors duration-200">
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4">
        <BackButton />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-2xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            ユーザー管理
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            自治体内のユーザーとロールを管理します。
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          ＋ ユーザーを追加
        </button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-3">
        {ROLE_OPTIONS.map((r) => (
          <div key={r.value}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border"
            style={{ background: r.bg, borderColor: r.border, color: r.color }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
            <span className="font-semibold">{r.label}</span>
          </div>
        ))}
      </div>

      {/* Users table */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">読み込み中...</div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm text-slate-500 mb-4">ユーザーがまだ登録されていません</p>
          <button onClick={openCreate}
            className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors duration-200">
            最初のユーザーを追加する →
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: "var(--bg-input)", borderColor: "var(--border)" }}>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  ユーザー
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">
                  担当課
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  ロール
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {users.map((u) => {
                const roleInfo = ROLE_MAP[u.role] ?? ROLE_MAP["viewer"]!;
                return (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors duration-200">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-200">{u.display_name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-400 hidden sm:table-cell">
                      {u.department ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => void handleRoleChange(u.id, e.target.value)}
                        className="text-xs px-2 py-1 rounded-lg border font-semibold focus:outline-none cursor-pointer"
                        style={{
                          background: roleInfo.bg,
                          borderColor: roleInfo.border,
                          color: roleInfo.color,
                        }}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value} style={{ background: "var(--bg-secondary)", color: "#e2e8f0" }}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(u)}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors duration-200">
                          編集
                        </button>
                        <button onClick={() => void handleDelete(u.id)}
                          className="text-xs text-red-600 hover:text-red-400 transition-colors duration-200">
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
