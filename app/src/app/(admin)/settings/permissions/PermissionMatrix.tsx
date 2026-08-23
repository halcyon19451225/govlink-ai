"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { PERMISSION_ORDER, type PermissionLevel, type ModuleId } from "@/lib/permission-types";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

type OrgUnit = {
  id: string;
  name: string;
  depth: number;
  roles: { id: string; name: string; rank: number }[];
};

type ProjectRow = { id: string; title: string };

type PermRow = {
  project_id: string | null;
  project_access: PermissionLevel;
  module_permissions: Record<string, PermissionLevel>;
};

type MatrixRow = {
  project_id: string | null;
  project_title: string;
  project_access: PermissionLevel;
  module_permissions: Record<string, PermissionLevel>;
};

type AuditEntry = {
  id: string;
  action: string;
  actor_name: string | null;
  actor_email: string | null;
  project_id: string | null;
  project_title: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
};

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const MODULES: { id: ModuleId; label: string }[] = [
  { id: "dataset_manager", label: "データ管理" },
  { id: "gap_analysis", label: "ギャップ分析" },
  { id: "issue_hypothesis", label: "課題仮説" },
  { id: "measure_design", label: "施策構築" },
  { id: "logic_model", label: "ロジックモデル" },
  { id: "program_evaluation", label: "事業評価" },
  { id: "cost_efficiency", label: "費用対効果" },
  { id: "service_volume", label: "サービス量" },
  { id: "self_evaluation", label: "自己評価" },
];

const LEVELS: PermissionLevel[] = ["none", "view", "edit", "approve"];

const LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: "なし",
  view: "閲覧",
  edit: "編集",
  approve: "承認",
  admin: "管理",
};

const LEVEL_COLORS: Record<PermissionLevel, React.CSSProperties> = {
  none: { background: "rgba(100,116,139,0.1)", color: "var(--text-secondary)" },
  view: { background: "rgba(34,197,94,0.1)", color: "#22c55e" },
  edit: { background: "rgba(99,102,241,0.12)", color: "var(--accent)" },
  approve: { background: "rgba(234,179,8,0.12)", color: "#eab308" },
  admin: { background: "rgba(239,68,68,0.1)", color: "#ef4444" },
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function buildMatrix(projects: ProjectRow[], perms: PermRow[]): MatrixRow[] {
  const permByProject = new Map<string | null, PermRow>();
  for (const p of perms) permByProject.set(p.project_id, p);

  const rows: MatrixRow[] = [
    {
      project_id: null,
      project_title: "【デフォルト】全プロジェクト共通",
      project_access: permByProject.get(null)?.project_access ?? "none",
      module_permissions: permByProject.get(null)?.module_permissions ?? {},
    },
    ...projects.map((p) => ({
      project_id: p.id,
      project_title: p.title,
      project_access: permByProject.get(p.id)?.project_access ?? "none",
      module_permissions: permByProject.get(p.id)?.module_permissions ?? {},
    })),
  ];
  return rows;
}

// ----------------------------------------------------------------
// Sub-component: permission select cell
// ----------------------------------------------------------------

function PermCell({
  value,
  changed,
  maxLevel,
  onChange,
}: {
  value: PermissionLevel;
  changed: boolean;
  maxLevel: PermissionLevel;
  onChange: (v: PermissionLevel) => void;
}) {
  return (
    <td
      className="px-2 py-2 text-center"
      style={changed ? { background: "rgba(234,179,8,0.08)" } : undefined}
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PermissionLevel)}
        className="text-xs rounded-lg px-2 py-1 border-0 outline-none cursor-pointer"
        style={{
          ...LEVEL_COLORS[value],
          border: changed ? "1px solid rgba(234,179,8,0.4)" : "1px solid transparent",
          minWidth: 70,
        }}
      >
        {LEVELS.map((l) => (
          <option
            key={l}
            value={l}
            disabled={PERMISSION_ORDER[l] > PERMISSION_ORDER[maxLevel]}
            style={{ background: "#1a2035", color: PERMISSION_ORDER[l] > PERMISSION_ORDER[maxLevel] ? "#64748b" : "inherit" }}
          >
            {LEVEL_LABELS[l]}
          </option>
        ))}
      </select>
    </td>
  );
}

// ----------------------------------------------------------------
// Main component
// ----------------------------------------------------------------

export default function PermissionMatrix() {
  const { data: session } = useSession();

  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [original, setOriginal] = useState<MatrixRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [tab, setTab] = useState<"matrix" | "audit">("matrix");
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Operator's max grantable level
  const operatorMaxLevel: PermissionLevel = session?.user?.role === "admin" ? "admin" : "edit";

  // Fetch org units
  useEffect(() => {
    fetch("/api/admin/org-units")
      .then((r) => r.json())
      .then((d: { data: OrgUnit[] | null }) => setUnits(d.data ?? []))
      .catch(() => setError("組織情報の取得に失敗しました"));
  }, []);

  // Selected unit's roles
  const selectedUnit = units.find((u) => u.id === selectedUnitId);
  const roles = selectedUnit?.roles ?? [];

  // Auto-select first role when unit changes
  useEffect(() => {
    const firstRole = roles[0];
    setSelectedRoleId(firstRole?.id ?? "");
  }, [selectedUnitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch permissions when role selected
  const fetchPerms = useCallback(async (roleId: string) => {
    if (!roleId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/permissions/${roleId}`);
      const json = await res.json() as {
        data: {
          defaultPermission: PermRow | null;
          projectPermissions: PermRow[];
          projects: ProjectRow[];
        } | null;
        error: string | null;
      };
      if (json.error || !json.data) { setError(json.error ?? "取得失敗"); return; }
      const { defaultPermission, projectPermissions, projects: projs } = json.data;
      const allPerms = [
        ...(defaultPermission ? [defaultPermission] : []),
        ...projectPermissions,
      ];
      const rows = buildMatrix(projs, allPerms);
      setMatrix(rows);
      setOriginal(JSON.parse(JSON.stringify(rows)) as MatrixRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRoleId) void fetchPerms(selectedRoleId);
  }, [selectedRoleId, fetchPerms]);

  // Fetch audit log
  useEffect(() => {
    if (tab !== "audit" || !selectedRoleId) return;
    setAuditLoading(true);
    fetch(`/api/admin/permissions/${selectedRoleId}/audit`)
      .then((r) => r.json())
      .then((d: { data: AuditEntry[] | null }) => setAuditLogs(d.data ?? []))
      .catch(() => setAuditLogs([]))
      .finally(() => setAuditLoading(false));
  }, [tab, selectedRoleId]);

  function updateRow(
    idx: number,
    field: "project_access" | ModuleId,
    value: PermissionLevel,
  ) {
    setMatrix((prev) => {
      const next = [...prev];
      const row = { ...next[idx]! };
      if (field === "project_access") {
        row.project_access = value;
      } else {
        row.module_permissions = { ...row.module_permissions, [field]: value };
      }
      next[idx] = row;
      return next;
    });
  }

  function isChanged(idx: number, field: "project_access" | ModuleId): boolean {
    const orig = original[idx];
    const curr = matrix[idx];
    if (!orig || !curr) return false;
    if (field === "project_access") return orig.project_access !== curr.project_access;
    return (orig.module_permissions[field] ?? "none") !== (curr.module_permissions[field] ?? "none");
  }

  const hasChanges = matrix.some((row, i) => {
    const orig = original[i];
    if (!orig) return true;
    if (row.project_access !== orig.project_access) return true;
    return MODULES.some((m) =>
      (row.module_permissions[m.id] ?? "none") !== (orig.module_permissions[m.id] ?? "none")
    );
  });

  async function handleSave() {
    if (!selectedRoleId) return;
    setSaving(true);
    setError(null);
    try {
      const rows = matrix.map((r) => ({
        project_id: r.project_id,
        project_access: r.project_access,
        module_permissions: r.module_permissions,
      }));
      const res = await fetch(`/api/admin/permissions/${selectedRoleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json() as { error: string | null };
      if (json.error) { setError(json.error); return; }
      setOriginal(JSON.parse(JSON.stringify(matrix)) as MatrixRow[]);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text-primary)",
    padding: "7px 12px",
    fontSize: 14,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>権限設定</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          役職ごとのプロジェクト・モジュール権限を設定します
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {/* 組織ユニット・役職セレクター */}
      <div className="glass-card rounded-2xl p-5 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-48">
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-secondary)" }}>組織ユニット</label>
          <select value={selectedUnitId} onChange={(e) => setSelectedUnitId(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
            <option value="">選択してください</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {"　".repeat(u.depth)}{u.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-48">
          <label className="text-xs mb-1.5 block" style={{ color: "var(--text-secondary)" }}>役職</label>
          <select
            value={selectedRoleId}
            onChange={(e) => setSelectedRoleId(e.target.value)}
            disabled={!selectedUnitId || roles.length === 0}
            style={{ ...inputStyle, width: "100%", opacity: !selectedUnitId ? 0.5 : 1 }}
          >
            <option value="">選択してください</option>
            {[...roles].sort((a, b) => a.rank - b.rank).map((r) => (
              <option key={r.id} value={r.id}>{r.name}（ランク{r.rank}）</option>
            ))}
          </select>
        </div>
      </div>

      {selectedRoleId && (
        <>
          {/* タブ */}
          <div className="flex gap-1">
            {(["matrix", "audit"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="px-4 py-2 text-sm rounded-xl transition-colors"
                style={tab === t
                  ? { background: "rgba(99,102,241,0.15)", color: "var(--accent)", fontWeight: 600 }
                  : { background: "transparent", color: "var(--text-secondary)" }
                }
              >
                {t === "matrix" ? "権限マトリクス" : "変更履歴"}
              </button>
            ))}
          </div>

          {/* マトリクスタブ */}
          {tab === "matrix" && (
            <div className="space-y-4">
              {loading ? (
                <div className="text-sm text-center py-16" style={{ color: "var(--text-secondary)" }}>読込中...</div>
              ) : (
                <div className="glass-card rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          <th
                            className="px-4 py-3 text-left text-xs font-medium whitespace-nowrap sticky left-0 z-10"
                            style={{ color: "var(--text-secondary)", background: "var(--bg-secondary)", minWidth: 200 }}
                          >
                            プロジェクト
                          </th>
                          <th className="px-2 py-3 text-center text-xs font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)", minWidth: 90 }}>
                            全体アクセス
                          </th>
                          {MODULES.map((m) => (
                            <th key={m.id} className="px-2 py-3 text-center text-xs font-medium" style={{ color: "var(--text-secondary)", minWidth: 90 }}>
                              {m.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.map((row, idx) => (
                          <tr
                            key={row.project_id ?? "default"}
                            style={{
                              borderBottom: "1px solid var(--border)",
                              background: row.project_id === null ? "rgba(99,102,241,0.04)" : "transparent",
                            }}
                            className="hover:bg-white/5 transition-colors"
                          >
                            <td
                              className="px-4 py-2 sticky left-0 z-10"
                              style={{ background: row.project_id === null ? "rgba(99,102,241,0.04)" : "var(--bg-secondary)" }}
                            >
                              <span className="text-xs" style={{ color: row.project_id === null ? "var(--accent)" : "var(--text-primary)", fontWeight: row.project_id === null ? 600 : 400 }}>
                                {row.project_title}
                              </span>
                            </td>
                            <PermCell
                              value={row.project_access}
                              changed={isChanged(idx, "project_access")}
                              maxLevel={operatorMaxLevel}
                              onChange={(v) => updateRow(idx, "project_access", v)}
                            />
                            {MODULES.map((m) => (
                              <PermCell
                                key={m.id}
                                value={(row.module_permissions[m.id] as PermissionLevel | undefined) ?? "none"}
                                changed={isChanged(idx, m.id)}
                                maxLevel={operatorMaxLevel}
                                onChange={(v) => updateRow(idx, m.id, v)}
                              />
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Save button */}
              <div className="flex items-center justify-between">
                <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {hasChanges ? (
                    <span style={{ color: "#eab308" }}>⚠ 未保存の変更があります</span>
                  ) : saveSuccess ? (
                    <span style={{ color: "#22c55e" }}>✓ 保存しました</span>
                  ) : null}
                </div>
                <div className="neu-button-wrap">
                  <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !hasChanges}
                  className="px-5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-90 neu-button-primary"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                </div>
              </div>
            </div>
          )}

          {/* 変更履歴タブ */}
          {tab === "audit" && (
            <div className="glass-card rounded-2xl overflow-hidden">
              {auditLoading ? (
                <div className="text-sm text-center py-12" style={{ color: "var(--text-secondary)" }}>読込中...</div>
              ) : auditLogs.length === 0 ? (
                <div className="text-sm text-center py-12" style={{ color: "var(--text-secondary)" }}>変更履歴がありません</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["日時", "操作者", "対象", "変更前", "変更後"].map((h) => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }} className="hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {log.created_at.slice(0, 16).replace("T", " ")}
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-primary)" }}>
                            <div>{log.actor_name ?? "不明"}</div>
                            <div style={{ color: "var(--text-secondary)" }}>{log.actor_email}</div>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-primary)" }}>
                            {log.project_title ?? "デフォルト"}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--text-secondary)", maxWidth: 200 }}>
                            <pre className="truncate">{JSON.stringify(log.old_value)}</pre>
                          </td>
                          <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--text-primary)", maxWidth: 200 }}>
                            <pre className="truncate">{JSON.stringify(log.new_value)}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!selectedRoleId && (
        <div className="glass-card rounded-2xl flex items-center justify-center py-20 text-sm" style={{ color: "var(--text-secondary)" }}>
          組織ユニットと役職を選択して権限を設定してください
        </div>
      )}
    </div>
  );
}
