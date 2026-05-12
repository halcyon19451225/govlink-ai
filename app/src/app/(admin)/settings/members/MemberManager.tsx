"use client";

import { useState, useEffect, useCallback } from "react";

type OrgRole = {
  id: string;
  org_unit_id: string;
  name: string;
  rank: number;
  can_manage_below: boolean;
  is_default_role: boolean;
};

type OrgUnit = {
  id: string;
  name: string;
  org_type: string;
  depth: number;
  roles: OrgRole[];
};

type Membership = {
  user_id: string;
  membership_id: string;
  org_role_id: string;
  role_name: string;
  rank: number;
  org_unit_id: string;
  org_unit_name: string;
  granted_at: string;
  expires_at: string | null;
};

type Member = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  department: string | null;
  avatar_url: string | null;
  created_at: string;
  memberships: Membership[];
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function MemberManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // 招待モーダル
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // 役職変更モーダル
  const [roleTarget, setRoleTarget] = useState<Member | null>(null);
  const [roleNewId, setRoleNewId] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, uRes] = await Promise.all([
        fetch("/api/admin/members"),
        fetch("/api/admin/org-units"),
      ]);
      const mJson = await mRes.json() as { data: Member[] | null; error: string | null };
      const uJson = await uRes.json() as { data: OrgUnit[] | null; error: string | null };
      if (mJson.error) { setError(mJson.error); return; }
      if (uJson.error) { setError(uJson.error); return; }
      setMembers(mJson.data ?? []);
      setUnits(uJson.data ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const allRoles = units.flatMap((u) => u.roles.map((r) => ({ ...r, unit_name: u.name })));

  async function handleInvite() {
    if (!inviteEmail.trim() || !inviteRoleId) return;
    setInviteSaving(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const res = await fetch("/api/admin/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), org_role_id: inviteRoleId }),
      });
      const json = await res.json() as { data: { display_name: string } | null; error: string | null };
      if (json.error) { setInviteError(json.error); return; }
      setInviteSuccess(`${json.data?.display_name ?? inviteEmail} をメンバーに追加しました`);
      setInviteEmail("");
      setInviteRoleId("");
      void fetchData();
    } finally {
      setInviteSaving(false);
    }
  }

  async function handleRoleChange() {
    if (!roleTarget || !roleNewId) return;
    setRoleSaving(true);
    try {
      const res = await fetch(`/api/admin/members/${roleTarget.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_role_id: roleNewId }),
      });
      const json = await res.json() as { error: string | null };
      if (json.error) { setError(json.error); return; }
      setRoleTarget(null);
      void fetchData();
    } finally {
      setRoleSaving(false);
    }
  }

  async function handleRemoveMember(id: string, name: string) {
    if (!confirm(`${name} のメンバーシップを全て無効化しますか？`)) return;
    try {
      const res = await fetch(`/api/admin/members/${id}/role`, { method: "DELETE" });
      const json = await res.json() as { error: string | null };
      if (json.error) { setError(json.error); return; }
      void fetchData();
    } catch {
      setError("処理に失敗しました");
    }
  }

  const filtered = members.filter((m) =>
    m.display_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase()) ||
    (m.department ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text-primary)",
    padding: "8px 12px",
    width: "100%",
    fontSize: 14,
  };

  const selectStyle: React.CSSProperties = { ...inputStyle };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>メンバー管理</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            組織メンバーの役職割り当てを管理します
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowInvite(true); setInviteError(null); setInviteSuccess(null); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          ＋ 役職を割り当て
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {/* 検索 */}
      <div style={{ maxWidth: 360 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inputStyle}
          placeholder="名前・メール・部署で検索..."
        />
      </div>

      {/* テーブル */}
      <div className="glass-card rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-sm text-center py-16" style={{ color: "var(--text-secondary)" }}>読込中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-center py-16" style={{ color: "var(--text-secondary)" }}>メンバーが見つかりません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["ユーザー", "システム権限", "所属・役職", "登録日", "操作"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium whitespace-nowrap"
                      style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={m.id}
                    style={{ borderBottom: "1px solid var(--border)" }}
                    className="transition-colors hover:bg-white/5"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-full overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-white"
                          style={{
                            width: 36, height: 36,
                            background: m.avatar_url ? undefined : "linear-gradient(135deg, #06b6d4, #6366f1)",
                          }}>
                          {m.avatar_url
                            ? <img src={m.avatar_url} alt={m.display_name} style={{ width: 36, height: 36, objectFit: "cover" }} />
                            : getInitials(m.display_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate" style={{ color: "var(--text-primary)" }}>{m.display_name}</p>
                          <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={m.role === "admin"
                          ? { background: "rgba(99,102,241,0.15)", color: "var(--accent)" }
                          : { background: "rgba(100,116,139,0.12)", color: "var(--text-secondary)" }
                        }
                      >
                        {m.role === "admin" ? "管理者" : "一般"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.memberships.length === 0 ? (
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>未割り当て</span>
                      ) : (
                        <div className="space-y-1">
                          {m.memberships.map((ms) => (
                            <div key={ms.membership_id} className="flex items-center gap-1 flex-wrap">
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}>
                                {ms.org_unit_name}
                              </span>
                              <span className="text-xs" style={{ color: "var(--text-primary)" }}>
                                {ms.role_name}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "var(--text-secondary)" }}>
                      {m.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setRoleTarget(m); setRoleNewId(m.memberships[0]?.org_role_id ?? ""); }}
                          className="text-xs px-2.5 py-1 rounded-lg"
                          style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent)" }}
                        >
                          役職変更
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveMember(m.id, m.display_name)}
                          className="text-xs px-2.5 py-1 rounded-lg"
                          style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 招待（役職割り当て）モーダル */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>役職を割り当て</h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              登録済みユーザーのメールアドレスを入力して役職を割り当てます。
            </p>
            {inviteError && (
              <div className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                {inviteError}
              </div>
            )}
            {inviteSuccess && (
              <div className="px-3 py-2 rounded-lg text-sm" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                {inviteSuccess}
              </div>
            )}
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>メールアドレス *</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                style={inputStyle}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>役職 *</label>
              <select value={inviteRoleId} onChange={(e) => setInviteRoleId(e.target.value)} style={selectStyle}>
                <option value="">選択してください</option>
                {units.map((u) => (
                  u.roles.length > 0 && (
                    <optgroup key={u.id} label={u.name}>
                      {[...u.roles].sort((a, b) => a.rank - b.rank).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}（ランク{r.rank}）</option>
                      ))}
                    </optgroup>
                  )
                ))}
              </select>
              {allRoles.length === 0 && (
                <p className="text-xs mt-1" style={{ color: "#f59e0b" }}>
                  先に組織管理で役職を作成してください
                </p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="flex-1 py-2 rounded-xl text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={() => void handleInvite()}
                disabled={inviteSaving || !inviteEmail.trim() || !inviteRoleId}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {inviteSaving ? "処理中..." : "割り当て"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 役職変更モーダル */}
      {roleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>役職を変更</h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {roleTarget.display_name} の役職を追加/変更します
            </p>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>新しい役職 *</label>
              <select value={roleNewId} onChange={(e) => setRoleNewId(e.target.value)} style={selectStyle}>
                <option value="">選択してください</option>
                {units.map((u) => (
                  u.roles.length > 0 && (
                    <optgroup key={u.id} label={u.name}>
                      {[...u.roles].sort((a, b) => a.rank - b.rank).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}（ランク{r.rank}）</option>
                      ))}
                    </optgroup>
                  )
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRoleTarget(null)}
                className="flex-1 py-2 rounded-xl text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleRoleChange()}
                disabled={roleSaving || !roleNewId}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {roleSaving ? "保存中..." : "変更"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
