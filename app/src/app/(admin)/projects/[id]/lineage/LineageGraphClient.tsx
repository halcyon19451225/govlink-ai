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

// ─── 型定義 ─────────────────────────────────────────────────────────────

interface ArtifactNode {
  id: string;
  module_id: string;
  artifact_type: string;
  derivation_note: string | null;
  created_at: string;
  updated_at: string;
  is_stale: boolean;
  stale_datasets: string[];
  upstream: ArtifactNode[];
  downstream: ArtifactNode[];
}

// ─── モジュール設定 ──────────────────────────────────────────────────────

const MODULE_CONFIG: Record<
  string,
  { label: string; color: string; x: number }
> = {
  gap_analysis:       { label: "ギャップ分析",     color: "#f59e0b", x: 0   },
  issue_hypothesis:   { label: "課題仮説",         color: "#8b5cf6", x: 280 },
  logic_model:        { label: "ロジックモデル",   color: "#10b981", x: 560 },
  program_evaluation: { label: "プログラム評価",   color: "#3b82f6", x: 840 },
  cost_efficiency:    { label: "コスト効率",       color: "#ef4444", x: 1120 },
  service_volume:     { label: "サービス見込量",   color: "#06b6d4", x: 1120 },
  self_evaluation:    { label: "自己評価",         color: "#ec4899", x: 1400 },
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

function ArtifactNodeComponent({ data }: {
  data: {
    artifact: ArtifactNode;
    color: string;
    moduleLabel: string;
  };
}) {
  const { artifact, color, moduleLabel } = data;
  const borderColor = artifact.is_stale ? "#f59e0b" : color;
  const bgColor = artifact.is_stale ? "#f59e0b10" : `${color}18`;

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
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
      <div style={{ fontSize: 9, color: borderColor, marginBottom: 2, fontWeight: 600 }}>
        {moduleLabel}
      </div>
      <div style={{ fontWeight: 500, wordBreak: "break-word" }}>
        {artifact.artifact_type}
      </div>
      {artifact.derivation_note && (
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3, wordBreak: "break-word" }}>
          {artifact.derivation_note.length > 50
            ? `${artifact.derivation_note.slice(0, 50)}…`
            : artifact.derivation_note}
        </div>
      )}
      <div style={{ fontSize: 9, color: "#6b7280", marginTop: 3 }}>
        {new Date(artifact.updated_at).toLocaleDateString("ja-JP")}
      </div>
      {artifact.is_stale && (
        <div style={{ fontSize: 9, color: "#fbbf24", marginTop: 2 }}>⚠ 陳腐化</div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
    </div>
  );
}

const nodeTypes = { artifact: ArtifactNodeComponent };

// ─── フラット化ユーティリティ ────────────────────────────────────────────

function flattenTree(roots: ArtifactNode[]): Map<string, ArtifactNode> {
  const map = new Map<string, ArtifactNode>();
  const visit = (node: ArtifactNode) => {
    if (map.has(node.id)) return;
    map.set(node.id, node);
    for (const child of node.downstream) visit(child);
    for (const parent of node.upstream) visit(parent);
  };
  for (const root of roots) visit(root);
  return map;
}

// ─── メインコンポーネント ────────────────────────────────────────────────

interface Props {
  project: { id: string; title: string };
  projectId: string;
}

export default function LineageGraphClient({ project, projectId }: Props) {
  const router = useRouter();
  const [artifacts, setArtifacts] = useState<Map<string, ArtifactNode>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/projects/${projectId}/lineage`)
      .then((r) => r.json() as Promise<{ data: ArtifactNode[] | null; error: string | null }>)
      .then(({ data, error: err }) => {
        if (err) { setError(err); return; }
        setArtifacts(flattenTree(data ?? []));
      })
      .catch(() => setError("データの取得に失敗しました"))
      .finally(() => setLoading(false));
  }, [projectId]);

  // react-flow ノード/エッジを構築
  const { nodes, edges } = (() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // モジュールごとの Y オフセット
    const yCounters: Record<string, number> = {};

    for (const artifact of Array.from(artifacts.values())) {
      const cfg = MODULE_CONFIG[artifact.module_id] ?? {
        label: artifact.module_id,
        color: "#6b7280",
        x: 1680,
      };
      const yIdx = yCounters[artifact.module_id] ?? 0;
      yCounters[artifact.module_id] = yIdx + 1;

      nodes.push({
        id: artifact.id,
        type: "artifact",
        position: { x: cfg.x, y: yIdx * 130 },
        data: {
          artifact,
          color: cfg.color,
          moduleLabel: cfg.label,
        },
      });

      // エッジ: source_artifact_ids → このノード
      for (const srcId of artifact.upstream.map((u: ArtifactNode) => u.id)) {
        if (artifacts.has(srcId)) {
          const srcCfg = MODULE_CONFIG[artifacts.get(srcId)!.module_id] ?? { color: "#6b7280" };
          edges.push({
            id: `e-${srcId}-${artifact.id}`,
            source: srcId,
            target: artifact.id,
            animated: artifact.is_stale,
            label: artifact.is_stale ? "⚠陳腐化" : undefined,
            style: { stroke: srcCfg.color, strokeWidth: 1.5 },
            labelStyle: { fill: "#fbbf24", fontSize: 10 },
          });
        }
      }
    }

    return { nodes, edges };
  })();

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const artifact = artifacts.get(node.id);
      if (!artifact) return;
      const path = MODULE_PATH[artifact.module_id];
      if (path) router.push(`/projects/${projectId}/${path}`);
    },
    [artifacts, projectId, router],
  );

  const staleCount = Array.from(artifacts.values()).filter((a) => a.is_stale).length;

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
            <div className="w-3 h-3 rounded-sm" style={{ background: "#f59e0b10", border: "1px solid #f59e0b" }} />
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
          {!loading && !error && artifacts.size === 0 && (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              成果物がまだ登録されていません。各モジュールで分析を実行してください。
            </div>
          )}
          {!loading && !error && artifacts.size > 0 && (
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
        {!loading && artifacts.size > 0 && (
          <div className="mt-4 flex gap-6 text-xs text-slate-500">
            <span>成果物: {artifacts.size}件</span>
            <span>モジュール: {new Set(Array.from(artifacts.values()).map((a) => a.module_id)).size}種</span>
            {staleCount > 0 && <span className="text-yellow-500">陳腐化: {staleCount}件</span>}
          </div>
        )}
      </div>
    </div>
  );
}
