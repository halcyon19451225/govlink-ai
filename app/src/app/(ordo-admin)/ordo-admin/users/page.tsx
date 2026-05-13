export const dynamic = "force-dynamic";

import { query } from "@/lib/db";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  municipality_name: string | null;
  created_at: string;
}

export default async function OrdoUsersPage() {
  const rows = await query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.role,
            m.name AS municipality_name, u.created_at::text
     FROM user_roles u
     LEFT JOIN municipalities m ON m.id = u.municipality_id
     ORDER BY u.created_at DESC`,
  );

  const roleLabel: Record<string, string> = {
    admin: "管理者",
    user: "一般",
    viewer: "閲覧者",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          ユーザー管理
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          全自治体の登録ユーザー一覧（{rows.length}件）
        </p>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["表示名", "メールアドレス", "ロール", "自治体", "登録日"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold"
                  style={{ color: "var(--text-secondary)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center"
                  style={{ color: "var(--text-secondary)" }}>
                  ユーザーが登録されていません
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className="hover:bg-white/3 transition-colors"
                  style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>
                    {u.display_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: u.role === "admin" ? "rgba(239,68,68,0.12)" : "rgba(99,102,241,0.12)",
                        color: u.role === "admin" ? "#ef4444" : "var(--accent)",
                      }}>
                      {roleLabel[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {u.municipality_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {new Date(u.created_at).toLocaleDateString("ja-JP")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
