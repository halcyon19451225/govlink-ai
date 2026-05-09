"use client";

import { useMemo } from "react";
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

export default function ModuleGraphClient({ projectModules, allModules, rules }: Props) {
  const enabledSet = useMemo(() => {
    const s = new Set<string>();
    for (const pm of projectModules) {
      if (pm.is_enabled) s.add(pm.module_id);
    }
    return s;
  }, [projectModules]);

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
          background: isEnabled ? "#1e2035" : "#0f1117",
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
        style={{ borderColor: "#2a2d3a", color: "#64748b" }}
      >
        モジュールが見つかりません
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ height: 480, background: "#0f1117", borderColor: "#2a2d3a" }}
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
          style={{ background: "#0f1117" }}
          nodeColor={(n) => {
            const node = n as Node;
            return enabledSet.has(node.id) ? "#6366f1" : "#1e293b";
          }}
        />
      </ReactFlow>
    </div>
  );
}
