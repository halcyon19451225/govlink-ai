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
import type { LineageNode, LineageEdge } from "@/app/api/admin/projects/[id]/lineage/route";

// ─── モジュール設定（色・ラベルのみ。X座標は自動計算） ───────────────────

const MODULE_CONFIG: Record<string, { label: string; color: string }> = {
  gap_analysis:       { label: "ギャップ分析",   color: "#f59e0b" },
  issue_hypothesis:   { label: "課題仮説",       color: "#8b5cf6" },
  measure_design:     { label: "施策構築(EBPM)", color: "#6366f1" },
  logic_model:        { label: "ロジックモデル", color: "#10b981" },
  program_evaluation: { label: "プログラム評価", color: "#3b82f6" },
  cost_efficiency:    { label: "コスト効率",     color: "#ef4444" },
  service_volume:     { label: "サービス見込量", color: "#06b6d4" },
  self_evaluation:    { label: "自己評価",       color: "#ec4899" },
};

// ─── トポロジカルレイアウト計算 ──────────────────────────────────────────

const NODE_H = 90;
const COL_GAP = 260; // X 方向の列間隔
const ROW_GAP = 150; // Y 方向の行間隔

/**
 * DAG 全体のノード位置をトポロジカルソート + BFS で計算する。
 * 1. 各ノードの「深さ（列インデックス）」を BFS で決定
 * 2. 同じ深さのノードを Y 方向に均等配置
 */
function computeLayout(
  nodes: LineageNode[],
  edges: LineageEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  const idSet = new Set(nodes.map((n) => n.id));

  // 隣接リスト（children: source → targets）
  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) { children.set(n.id, []); inDegree.set(n.id, 0); }
  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      children.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  // BFS でノードの「深さ（列）」を計算（最大深さ優先: 複数の親がいる場合は最大値）
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) { depth.set(n.id, 0); queue.push(n.id); }
  }
  // 孤立ノード（入次数 0 でない & キューに入っていない）は深さ 0 に
  for (const n of nodes) { if (!depth.has(n.id)) depth.set(n.id, 0); }

  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++]!;
    const d = depth.get(cur) ?? 0;
    for (const child of children.get(cur) ?? []) {
      const prev = depth.get(child) ?? 0;
      depth.set(child, Math.max(prev, d + 1));
      // 既にキューにある場合でも更新（トポロジカル順は後で整合される）
      if (!queue.includes(child)) queue.push(child);
    }
  }

  // 深さごとにノードをグループ化
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of Array.from(depth.entries())) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  // Y オフセット計算: 各深さで均等配置
  const positions = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of Array.from(byDepth.entries())) {
    const totalH = ids.length * NODE_H + (ids.length - 1) * (ROW_GAP - NODE_H);
    const startY = -totalH / 2;
    ids.forEach((id: string, i: number) => {
      positions.set(id, {
        x: d * COL_GAP,
        y: startY + i * ROW_GAP,
      });
    });
  }

  return positions;
}

const MODULE_PATH: Record<string, string> = {
  gap_analysis:       "gap-analysis",
  issue_hypothesis:   "issue-hypothesis",
  measure_design:     "measure-design",
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

  // react-flow ノード/エッジを構築（トポロジカルレイアウト）
  const { nodes, edges } = (() => {
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];

    const nodeMap = new Map(lineageNodes.map((n) => [n.id, n]));

    // トポロジカルレイアウト計算
    const positions = computeLayout(lineageNodes, lineageEdges);

    for (const n of lineageNodes) {
      const cfg = MODULE_CONFIG[n.module_id] ?? { label: n.module_id, color: "#6b7280" };
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };

      rfNodes.push({
        id: n.id,
        type: "artifact",
        position: pos,
        data: { node: n, color: cfg.color, moduleLabel: cfg.label },
      });
    }

    for (const e of lineageEdges) {
      const srcNode = nodeMap.get(e.source);
      const srcColor = MODULE_CONFIG[srcNode?.module_id ?? ""]?.color ?? "#6b7280";
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
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-full mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-4">
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
          style={{ background: "var(--bg-primary)", borderColor: "var(--border)", height: 600 }}
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
              style={{ background: "var(--bg-primary)" }}
            >
              <Background color="#cbd5e1" gap={16} />
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
