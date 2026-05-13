export const dynamic = "force-dynamic";

import { query } from "@/lib/db";

interface MunRow {
  id: string;
  name: string;
  prefecture: string;
  user_count: number;
  project_count: number;
  created_at: string;
}

export default async function OrdoMunicipalitiesPage() {
  const rows = await query<MunRow>(
    `SELECT
       m.id, m.name, m.prefecture,
       COUNT(DISTINCT u.id)::int AS user_count,
       COUNT(DISTINCT p.id)::int AS project_count,
       m.created_at::text
     FROM municipalities m
     LEFT JOIN user_roles u ON u.municipality_id = m.id
     LEFT JOIN projects p ON p.municipality_id = m.id
     GROUP BY m.id
     ORDER BY m.created_at DESC`,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          自治体管理
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          登録済み自治体の一覧
        </p>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["自治体名", "都道府県", "ユーザー数", "プロジェクト数", "登録日"].map((h) => (
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
                  登録された自治体はありません
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="hover:bg-white/3 transition-colors"
                  style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>
                    {m.name}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                    {m.prefecture}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                    {m.user_count}
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                    {m.project_count}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {new Date(m.created_at).toLocaleDateString("ja-JP")}
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
