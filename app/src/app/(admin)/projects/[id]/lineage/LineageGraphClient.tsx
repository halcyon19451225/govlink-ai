"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import BackButton from "@/components/BackButton";
import type { LineageNode, LineageEdge } from "@/app/api/admin/projects/[id]/lineage/route";

// ─── モジュール設定 ──────────────────────────────────────────────────────

const MODULE_CONFIG: Record<string, { label: string; color: string; x: number }> = {
  gap_analysis:       { label: "ギャップ分析",   color: "#f59e0b", x: 0    },
  issue_hypothesis:   { label: "課題仮説",       color: "#8b5cf6", x: 280  },
  logic_model:        { label: "ロジックモデル", color: "#10b981", x: 560  },
  program_evaluation: { label: "プログラム評価", color: "#3b82f6", x: 840  },
  cost_efficiency:    { label: "コスト効率",     color: "#ef4444", x: 1120 },
  service_volume:     { label: "サービス見込量", color: "#06b6d4", x: 1120 },
  self_evaluation:    { label: "自己評価",       color: "#ec4899", x: 1400 },
};

const MODULE_PATH: Record<string, string> = {
  gap_analysis:       "gap-analysis",
  issue_hypothesis:   "issue-hypothesis",
  logic_model:        "logic-model",
  program_evaluation: "evaluations",
  cost_efficiency:    "cost-efficiency",
  service_volume:     "service-volume",
  self_evaluation:    "self-evaluation",
};

// ─── カスタムノードコンポーネント ────────────────────────────────────────

function ArtifactNodeComponent({
  data,
}: {
  data: { node: LineageNode; color: string; moduleLabel: string };
}) {
  const { node, color, moduleLabel } = data;
  const borderColor = node.is_stale ? "#f59e0b" : color;
  const bgColor = node.is_stale ? "#f59e0b10" : `${color}18`;

  return (
    <div
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        color: "#fff",
        fontSize: 12,
        padding: "6px 10px",
        minWidth: 180,
        maxWidth: 220,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
      <div style={{ fontSize: 9, color: borderColor, marginBottom: 2, fontWeight: 600 }}>
        {moduleLabel}
      </div>
      <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{node.artifact_type}</div>
      {node.derivation_note && (
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, wordBreak: "break-word" }}>
          {node.derivation_note.length > 50
            ? `${node.derivation_note.slice(0, 50)}…`
            : node.derivation_note}
        </div>
      )}
      <div style={{ fontSize: 9, color: "#6b7280", marginTop: 3 }}>
        {new Date(node.updated_at).toLocaleDateString("ja-JP")}
      </div>
      {node.is_stale && (
        <div style={{ fontSize: 9, color: "#fbbf24", marginTop: 2 }}>⚠ 陳腐化</div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
    </div>
  );
}

const nodeTypes = { artifact: ArtifactNodeComponent };

// ─── メインコンポーネント ────────────────────────────────────────────────

interface Props {
  project: { id: string; title: string };
  projectId: string;
}

export default function LineageGraphClient({ project, projectId }: Props) {
  const router = useRouter();
  const [lineageNodes, setLineageNodes] = useState<LineageNode[]>([]);
  const [lineageEdges, setLineageEdges] = useState<LineageEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/projects/${projectId}/lineage`)
      .then(
        (r) =>
          r.json() as Promise<{
            data: { nodes: LineageNode[]; edges: LineageEdge[] } | null;
            error: string | null;
          }>,
      )
      .then(({ data, error: err }) => {
        if (err) {
          setError(err);
          return;
        }
        setLineageNodes(data?.nodes ?? []);
        setLineageEdges(data?.edges ?? []);
      })
      .catch(() => setError("データの取得に失敗しました"))
      .finally(() => setLoading(false));
  }, [projectId]);

  // react-flow ノード/エッジを構築
  const { nodes, edges } = (() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    // モジュールごとのY位置カウンター
    const yCounters: Record<string, number> = {};

    // nodeId → LineageNode のマップ
    const nodeMap = new Map(lineageNodes.map((n) => [n.id, n]));

    for (const n of lineageNodes) {
      const cfg = MODULE_CONFIG[n.module_id] ?? {
        label: n.module_id,
        color: "#6b7280",
        x: 1680,
      };
      const yIdx = yCounters[n.module_id] ?? 0;
      yCounters[n.module_id] = yIdx + 1;

      rfNodes.push({
        id: n.id,
        type: "artifact",
        position: { x: cfg.x, y: yIdx * 130 },
        data: { node: n, color: cfg.color, moduleLabel: cfg.label },
      });
    }

    for (const e of lineageEdges) {
      const srcNode = nodeMap.get(e.source);
      const srcColor =
        srcNode ? (MODULE_CONFIG[srcNode.module_id]?.color ?? "#6b7280") : "#6b7280";
      const tgtNode = nodeMap.get(e.target);
      rfEdges.push({
        id: `e-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        animated: tgtNode?.is_stale ?? false,
        label: tgtNode?.is_stale ? "⚠陳腐化" : undefined,
        style: { stroke: srcColor, strokeWidth: 1.5 },
        labelStyle: { fill: "#fbbf24", fontSize: 10 },
      });
    }

    return { nodes: rfNodes, edges: rfEdges };
  })();

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const n = lineageNodes.find((a) => a.id === node.id);
      if (!n) return;
      const path = MODULE_PATH[n.module_id];
      if (path) router.push(`/projects/${projectId}/${path}`);
    },
    [lineageNodes, projectId, router],
  );

  const staleCount = lineageNodes.filter((n) => n.is_stale).length;

  return (
    <div className="min-h-screen" style={{ background: "#0f1117" }}>
      <div className="max-w-full mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-4">
          <BackButton />
          <div>
            <p className="text-xs text-slate-500">{project.title}</p>
            <h1 className="text-xl font-bold text-slate-100">成果物リネージグラフ</h1>
          </div>
        </div>

        {/* 陳腐化サマリー */}
        {staleCount > 0 && (
          <div
            className="mb-4 rounded-lg border px-4 py-2 text-sm"
            style={{ borderColor: "#f59e0b60", background: "#f59e0b10", color: "#fbbf24" }}
          >
            ⚠ {staleCount}件の成果物で参照元データが更新されています。再分析を検討してください。
          </div>
        )}

        {/* 凡例 */}
        <div className="flex gap-4 mb-4 flex-wrap">
          {Object.entries(MODULE_CONFIG).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ background: `${val.color}18`, border: `1px solid ${val.color}` }}
              />
              <span className="text-xs text-slate-400">{val.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ background: "#f59e0b10", border: "1px solid #f59e0b" }}
            />
            <span className="text-xs text-slate-400">陳腐化</span>
          </div>
        </div>

        {/* グラフ本体 */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: "#0f1117", borderColor: "#2a2d3a", height: 600 }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              読み込み中...
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">
              {error}
            </div>
          )}
          {!loading && !error && lineageNodes.length === 0 && (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              成果物がまだ登録されていません。各モジュールで分析を実行してください。
            </div>
          )}
          {!loading && !error && lineageNodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={handleNodeClick}
              style={{ background: "#0f1117" }}
            >
              <Background color="#2a2d3a" gap={16} />
              <Controls />
            </ReactFlow>
          )}
        </div>

        {/* 統計 */}
        {!loading && lineageNodes.length > 0 && (
          <div className="mt-4 flex gap-6 text-xs text-slate-500">
            <span>成果物: {lineageNodes.length}件</span>
            <span>
              エッジ: {lineageEdges.length}件
            </span>
            <span>
              モジュール: {new Set(lineageNodes.map((n) => n.module_id)).size}種
            </span>
            {staleCount > 0 && (
              <span className="text-yellow-500">陳腐化: {staleCount}件</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
