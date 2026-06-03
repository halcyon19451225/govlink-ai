"use client";

import { useMemo, useState, useCallback } from "react";
import { checkModuleCompatibility } from "@/lib/modules/compatibility-checker";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";

interface PlanModule {
  id: string;
  display_name: string;
  description: string | null;
  depends_on: string[];
}

interface Props {
  projectModules: { module_id: string; is_enabled: boolean }[];
  allModules: PlanModule[];
  projectId: string;
  rules: {
    module_a: string;
    module_b: string;
    is_blocking: boolean;
    warning_message: string;
  }[];
}

const NODE_W = 140;
const NODE_H = 50;
const COL_W = 180;
const ROW_H = 80;

export default function ModuleGraphClient({ projectModules, allModules, projectId, rules }: Props) {
  // トグル状態（初期値はDBから）
  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const pm of projectModules) {
      if (pm.is_enabled) s.add(pm.module_id);
    }
    return s;
  });
  const [toggling, setToggling] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // 互換チェック（トグル状態が変わるたびに実行）
  const compatResult = useMemo(
    () => checkModuleCompatibility(Array.from(enabledIds)),
    [enabledIds],
  );

  const handleToggle = useCallback(
    async (moduleId: string) => {
      const newEnabled = !enabledIds.has(moduleId);
      // 楽観的 UI 更新
      setEnabledIds((prev) => {
        const next = new Set(prev);
        if (newEnabled) next.add(moduleId);
        else next.delete(moduleId);
        return next;
      });
      setApiError(null);
      setToggling(moduleId);
      try {
        const res = await fetch(`/api/admin/projects/${projectId}/settings/modules`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module_id: moduleId, is_enabled: newEnabled }),
        });
        const json = (await res.json()) as { data: unknown; error: string | null };
        if (!res.ok || json.error) {
          // ロールバック
          setEnabledIds((prev) => {
            const next = new Set(prev);
            if (newEnabled) next.delete(moduleId);
            else next.add(moduleId);
            return next;
          });
          setApiError(json.error ?? "更新に失敗しました");
        }
      } catch {
        setEnabledIds((prev) => {
          const next = new Set(prev);
          if (newEnabled) next.delete(moduleId);
          else next.add(moduleId);
          return next;
        });
        setApiError("通信エラーが発生しました");
      } finally {
        setToggling(null);
      }
    },
    [enabledIds, projectId],
  );

  const enabledSet = enabledIds;

  const nodes: Node[] = useMemo(() => {
    return allModules.map((m, idx) => {
      const isEnabled = enabledSet.has(m.id);
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      return {
        id: m.id,
        position: { x: col * COL_W, y: row * ROW_H },
        data: { label: m.display_name },
        style: {
          width: NODE_W,
          height: NODE_H,
          background: isEnabled ? "#1e2035" : "var(--bg-primary)",
          color: isEnabled ? "#e2e8f0" : "#475569",
          border: isEnabled ? "1px solid #6366f1" : "1px solid #1e293b",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center" as const,
          padding: "0 8px",
        },
      };
    });
  }, [allModules, enabledSet]);

  const edges: Edge[] = useMemo(() => {
    const result: Edge[] = [];

    // depends_on エッジ（実線、インジゴ）
    for (const m of allModules) {
      for (const dep of m.depends_on) {
        result.push({
          id: `dep-${dep}-${m.id}`,
          source: dep,
          target: m.id,
          style: { stroke: "#6366f1", strokeWidth: 1.5 },
          type: "default",
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }

    // incompatibility エッジ（赤破線）
    for (const rule of rules) {
      result.push({
        id: `incompat-${rule.module_a}-${rule.module_b}`,
        source: rule.module_a,
        target: rule.module_b,
        label: rule.is_blocking ? "非互換" : "警告",
        style: {
          stroke: "#ef4444",
          strokeWidth: 1.5,
          strokeDasharray: "5 5",
        },
        type: "default",
      });
    }

    return result;
  }, [allModules, rules]);

  if (allModules.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed p-8 text-center text-sm"
        style={{ borderColor: "var(--border)", color: "#64748b" }}
      >
        モジュールが見つかりません
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* API エラー */}
      {apiError && (
        <div
          className="rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
        >
          {apiError}
        </div>
      )}

      {/* 互換チェック: 依存欠落 */}
      {compatResult.missingDeps.map((dep) => (
        <div
          key={`dep-${dep.module}-${dep.requires}`}
          className="rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
        >
          ⛔ <strong>{dep.module}</strong> を有効にするには先に <strong>{dep.requires}</strong> を有効にしてください
        </div>
      ))}

      {/* 互換チェック: 非互換・中間モジュール欠落 */}
      {compatResult.incompatWarnings.map((w) => (
        <div
          key={`incompat-${w.moduleA}-${w.moduleB}`}
          className="rounded-lg border px-4 py-2 text-sm"
          style={
            w.isBlocking
              ? { borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }
              : { borderColor: "#f59e0b60", background: "#f59e0b10", color: "#fbbf24" }
          }
        >
          {w.isBlocking ? "⛔" : "⚠"} {w.warningMessage}
        </div>
      ))}

      {/* モジュールトグルカード */}
      <div className="grid gap-3 sm:grid-cols-2">
        {allModules.map((mod) => {
          const enabled = enabledSet.has(mod.id);
          const isLoading = toggling === mod.id;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => handleToggle(mod.id)}
              disabled={isLoading}
              className="rounded-xl border p-4 text-left transition-all duration-200 w-full"
              style={{
                background: enabled ? "#6366f108" : "var(--bg-secondary)",
                borderColor: enabled ? "#6366f160" : "var(--border)",
                cursor: isLoading ? "wait" : "pointer",
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-200 truncate">
                    {mod.display_name}
                  </p>
                  {mod.description && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{mod.description}</p>
                  )}
                  {mod.depends_on.length > 0 && (
                    <p className="text-xs text-slate-600 mt-1">
                      依存: {mod.depends_on.join(", ")}
                    </p>
                  )}
                </div>
                <div
                  className="flex-shrink-0 w-10 h-5 rounded-full relative transition-colors duration-200"
                  style={{ background: enabled ? "#6366f1" : "#374151" }}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200"
                    style={{ transform: enabled ? "translateX(22px)" : "translateX(2px)" }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 依存グラフ */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ height: 400, background: "var(--bg-primary)", borderColor: "var(--border)" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1e2a3a" gap={20} />
          <Controls />
          <MiniMap
            style={{ background: "var(--bg-primary)" }}
            nodeColor={(n) => {
              const node = n as Node;
              return enabledSet.has(node.id) ? "#6366f1" : "#1e293b";
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
