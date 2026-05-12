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
  parent_id: string | null;
  path: string;
  depth: number;
  sort_order: number;
  roles: OrgRole[];
};

const ORG_TYPE_LABELS: Record<string, string> = {
  ministry: "省庁",
  prefecture: "都道府県",
  municipality: "市町村",
  bureau: "局",
  division: "部",
  department: "課",
  section: "係",
  team: "チーム",
  custom: "カスタム",
};

const ORG_TYPE_OPTIONS = Object.entries(ORG_TYPE_LABELS);

function buildTree(units: OrgUnit[]): OrgUnit[] {
  const byId: Record<string, OrgUnit & { children: OrgUnit[] }> = {};
  for (const u of units) byId[u.id] = { ...u, children: [] };
  const roots: (OrgUnit & { children: OrgUnit[] })[] = [];
  for (const u of Object.values(byId)) {
    if (u.parent_id && byId[u.parent_id]) {
      byId[u.parent_id]!.children.push(u);
    } else {
      roots.push(u);
    }
  }
  return roots;
}

function TreeNode({
  unit,
  selected,
  onSelect,
}: {
  unit: OrgUnit & { children?: OrgUnit[] };
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const children = (unit as OrgUnit & { children?: OrgUnit[] }).children ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(unit.id)}
        className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl transition-colors duration-150"
        style={{
          paddingLeft: `${12 + unit.depth * 16}px`,
          background: selected === unit.id ? "rgba(99,102,241,0.15)" : "transparent",
          color: selected === unit.id ? "var(--accent)" : "var(--text-primary)",
          borderLeft: selected === unit.id ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        {children.length > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="shrink-0 text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            {open ? "▾" : "▸"}
          </span>
        )}
        {children.length === 0 && <span className="shrink-0" style={{ width: 14 }} />}
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)", fontSize: 10 }}>
          {ORG_TYPE_LABELS[unit.org_type] ?? unit.org_type}
        </span>
        <span className="truncate text-sm">{unit.name}</span>
        <span className="ml-auto text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
          {unit.roles.length}役職
        </span>
      </button>
      {open && children.map((c) => (
        <TreeNode key={c.id} unit={c as OrgUnit & { children?: OrgUnit[] }} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

export default function OrgTreeManager() {
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // 追加フォーム
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState("department");
  const [addParent, setAddParent] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // 役職追加フォーム
  const [showAddRole, setShowAddRole] = useState(false);
  const [roleEditId, setRoleEditId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleRank, setRoleRank] = useState(10);
  const [roleCanManage, setRoleCanManage] = useState(false);
  const [roleIsDefault, setRoleIsDefault] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/org-units");
      const json = await res.json() as { data: OrgUnit[] | null; error: string | null };
      if (json.error) { setError(json.error); return; }
      setUnits(json.data ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUnits(); }, [fetchUnits]);

  const selectedUnit = units.find((u) => u.id === selected) ?? null;
  const tree = buildTree(units);

  async function handleAddUnit() {
    if (!addName.trim()) return;
    setAddSaving(true);
    try {
      const res = await fetch("/api/admin/org-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName.trim(), org_type: addType, parent_id: addParent ?? null }),
      });
      const json = await res.json() as { data: unknown; error: string | null };
      if (json.error) { setError(json.error); return; }
      setShowAddUnit(false);
      setAddName("");
      void fetchUnits();
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDeleteUnit(id: string) {
    if (!confirm("この組織を削除しますか？")) return;
    try {
      const res = await fetch(`/api/admin/org-units/${id}`, { method: "DELETE" });
      const json = await res.json() as { error: string | null };
      if (json.error) { setError(json.error); return; }
      if (selected === id) setSelected(null);
      void fetchUnits();
    } catch {
      setError("削除に失敗しました");
    }
  }

  function openAddRole() {
    setRoleEditId(null);
    setRoleName("");
    setRoleRank(10);
    setRoleCanManage(false);
    setRoleIsDefault(false);
    setShowAddRole(true);
  }

  function openEditRole(role: OrgRole) {
    setRoleEditId(role.id);
    setRoleName(role.name);
    setRoleRank(role.rank);
    setRoleCanManage(role.can_manage_below);
    setRoleIsDefault(role.is_default_role);
    setShowAddRole(true);
  }

  async function handleSaveRole() {
    if (!selected || !roleName.trim()) return;
    setRoleSaving(true);
    try {
      const res = await fetch(`/api/admin/org-units/${selected}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: {
            id: roleEditId ?? undefined,
            name: roleName.trim(),
            rank: roleRank,
            can_manage_below: roleCanManage,
            is_default_role: roleIsDefault,
          },
        }),
      });
      const json = await res.json() as { error: string | null };
      if (json.error) { setError(json.error); return; }
      setShowAddRole(false);
      void fetchUnits();
    } finally {
      setRoleSaving(false);
    }
  }

  async function handleDeleteRole(roleId: string) {
    if (!selected || !confirm("この役職を削除しますか？")) return;
    try {
      const res = await fetch(`/api/admin/org-units/${selected}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_role_id: roleId }),
      });
      const json = await res.json() as { error: string | null };
      if (json.error) { setError(json.error); return; }
      void fetchUnits();
    } catch {
      setError("削除に失敗しました");
    }
  }

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>組織管理</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            階層型組織ツリーと役職を管理します
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setAddParent(selected); setShowAddUnit(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          ＋ 組織を追加
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 左: ツリー */}
        <div className="lg:col-span-2 glass-card rounded-2xl p-4" style={{ minHeight: 400 }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>組織ツリー</h2>
          {loading ? (
            <div className="text-sm text-center py-12" style={{ color: "var(--text-secondary)" }}>読込中...</div>
          ) : units.length === 0 ? (
            <div className="text-sm text-center py-12" style={{ color: "var(--text-secondary)" }}>
              組織がありません。「組織を追加」で作成してください。
            </div>
          ) : (
            <div className="space-y-0.5">
              {tree.map((u) => (
                <TreeNode key={u.id} unit={u as OrgUnit & { children?: OrgUnit[] }} selected={selected} onSelect={setSelected} />
              ))}
            </div>
          )}
        </div>

        {/* 右: 詳細 */}
        <div className="lg:col-span-3 glass-card rounded-2xl p-4">
          {!selectedUnit ? (
            <div className="flex items-center justify-center h-full py-16 text-sm" style={{ color: "var(--text-secondary)" }}>
              左のツリーから組織を選択してください
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{selectedUnit.name}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
                    {ORG_TYPE_LABELS[selectedUnit.org_type] ?? selectedUnit.org_type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteUnit(selectedUnit.id)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                >
                  削除
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>役職一覧</h3>
                  <button
                    type="button"
                    onClick={openAddRole}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium text-white"
                    style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                  >
                    ＋ 役職追加
                  </button>
                </div>

                {selectedUnit.roles.length === 0 ? (
                  <p className="text-sm text-center py-6" style={{ color: "var(--text-secondary)" }}>役職がありません</p>
                ) : (
                  <div className="space-y-2">
                    {[...selectedUnit.roles].sort((a, b) => a.rank - b.rank).map((role) => (
                      <div
                        key={role.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                        style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
                      >
                        <span className="text-xs font-mono w-6 text-center shrink-0 rounded" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)", padding: "1px 4px" }}>
                          {role.rank}
                        </span>
                        <span className="text-sm flex-1" style={{ color: "var(--text-primary)" }}>{role.name}</span>
                        <div className="flex items-center gap-2">
                          {role.can_manage_below && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(6,182,212,0.12)", color: "#06b6d4" }}>管理権限</span>
                          )}
                          {role.is_default_role && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308" }}>デフォルト</span>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditRole(role)}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: "rgba(99,102,241,0.1)", color: "var(--accent)" }}
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteRole(role.id)}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 組織追加モーダル */}
      {showAddUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>組織を追加</h2>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>名称 *</label>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} style={inputStyle} placeholder="例: 総務課" />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>種別</label>
              <select value={addType} onChange={(e) => setAddType(e.target.value)} style={selectStyle}>
                {ORG_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>親組織</label>
              <select value={addParent ?? ""} onChange={(e) => setAddParent(e.target.value || null)} style={selectStyle}>
                <option value="">（ルート）</option>
                {units.map((u) => <option key={u.id} value={u.id}>{"　".repeat(u.depth)}{u.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddUnit(false)}
                className="flex-1 py-2 rounded-xl text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleAddUnit()}
                disabled={addSaving || !addName.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {addSaving ? "保存中..." : "追加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 役職追加/編集モーダル */}
      {showAddRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              {roleEditId ? "役職を編集" : "役職を追加"}
            </h2>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>役職名 *</label>
              <input value={roleName} onChange={(e) => setRoleName(e.target.value)} style={inputStyle} placeholder="例: 係長" />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-secondary)" }}>ランク（小さいほど上位）</label>
              <input type="number" value={roleRank} onChange={(e) => setRoleRank(parseInt(e.target.value) || 1)} min={1} style={inputStyle} />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={roleCanManage} onChange={(e) => setRoleCanManage(e.target.checked)} />
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>下位組織の管理権限</span>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={roleIsDefault} onChange={(e) => setRoleIsDefault(e.target.checked)} />
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>デフォルト役職</span>
              </label>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddRole(false)}
                className="flex-1 py-2 rounded-xl text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRole()}
                disabled={roleSaving || !roleName.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {roleSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
