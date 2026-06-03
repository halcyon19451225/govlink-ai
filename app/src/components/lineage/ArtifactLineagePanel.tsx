"use client";

import { useEffect, useState } from "react";
import type { LineageNode, LineageEdge } from "@/app/api/admin/projects/[id]/lineage/route";

const MODULE_LABELS: Record<string, string> = {
  dataset_manager: "DS",
  gap_analysis: "GA",
  issue_hypothesis: "IH",
  logic_model: "LM",
  program_evaluation: "PE",
  cost_efficiency: "CE",
  service_volume: "SV",
  self_evaluation: "SE",
};

interface ArtifactLineagePanelProps {
  projectId: string;
  artifactId: string;
  moduleName: string;
  onClose: () => void;
}

function ArtifactCard({
  node,
  direction,
}: {
  node: LineageNode;
  direction: "upstream" | "downstream";
}) {
  const tag =
    MODULE_LABELS[node.module_id] ?? node.module_id.toUpperCase().slice(0, 2);
  const color = direction === "upstream" ? "#6366f1" : "#f59e0b";

  return (
    <div
      className="rounded-lg border p-3 space-y-1"
      style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
        >
          [{tag}]
        </span>
        <span className="text-xs font-medium text-slate-200 truncate">
          {node.artifact_type}
        </span>
      </div>
      {node.derivation_note && (
        <p className="text-xs text-slate-400 line-clamp-2">{node.derivation_note}</p>
      )}
      <p className="text-xs text-slate-600">
        {new Date(node.updated_at).toLocaleDateString("ja-JP")}
      </p>
    </div>
  );
}

export default function ArtifactLineagePanel({
  projectId,
  artifactId,
  moduleName,
  onClose,
}: ArtifactLineagePanelProps) {
  const [loading, setLoading] = useState(true);
  const [currentNode, setCurrentNode] = useState<LineageNode | null>(null);
  const [upstreamNodes, setUpstreamNodes] = useState<LineageNode[]>([]);
  const [downstreamNodes, setDownstreamNodes] = useState<LineageNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(
      `/api/admin/projects/${projectId}/lineage?artifactId=${artifactId}`,
    )
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
        if (!data) return;

        const { nodes, edges } = data;
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const target = nodeMap.get(artifactId) ?? null;
        setCurrentNode(target);

        // エッジから上流・下流を解決
        const up = edges
          .filter((e) => e.target === artifactId)
          .map((e) => nodeMap.get(e.source))
          .filter((n): n is LineageNode => !!n);

        const down = edges
          .filter((e) => e.source === artifactId)
          .map((e) => nodeMap.get(e.target))
          .filter((n): n is LineageNode => !!n);

        setUpstreamNodes(up);
        setDownstreamNodes(down);
      })
      .catch(() => setError("データの取得に失敗しました"))
      .finally(() => setLoading(false));
  }, [projectId, artifactId]);

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-50 flex flex-col shadow-2xl"
      style={{ background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)" }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <p className="text-xs text-slate-500">データ系譜</p>
          <h3 className="text-sm font-semibold text-slate-100">{moduleName}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 transition-colors duration-200 text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <p className="text-xs text-slate-500 text-center py-8">読み込み中...</p>
        )}
        {error && (
          <p className="text-xs text-red-400 text-center py-4">{error}</p>
        )}
        {!loading && !error && !currentNode && (
          <p className="text-xs text-slate-500 text-center py-8">
            成果物が見つかりません
          </p>
        )}

        {currentNode && (
          <>
            {/* 下流影響警告 */}
            {downstreamNodes.length > 0 && (
              <div
                className="rounded-lg border p-3 text-xs"
                style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
              >
                ⚠ このデータを更新すると後続の分析（{downstreamNodes.length}件）に影響します
              </div>
            )}

            {/* 陳腐化警告 */}
            {currentNode.is_stale && (
              <div
                className="rounded-lg border p-3 text-xs"
                style={{ borderColor: "#f59e0b60", background: "#f59e0b10", color: "#fbbf24" }}
              >
                ⚠ 参照元データが更新されています → 再分析を推奨します
              </div>
            )}

            {/* 上流成果物 */}
            <section>
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
                ▲ 入力に使われた上流成果物
              </p>
              {upstreamNodes.length === 0 ? (
                <p className="text-xs text-slate-600">（上流成果物なし）</p>
              ) : (
                <div className="space-y-2">
                  {upstreamNodes.map((u) => (
                    <ArtifactCard key={u.id} node={u} direction="upstream" />
                  ))}
                </div>
              )}
            </section>

            {/* 現在の成果物 */}
            <section>
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
                ● 現在の成果物
              </p>
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: "#6366f180", background: "#6366f110" }}
              >
                <p className="text-xs font-medium text-slate-200">
                  {currentNode.artifact_type}
                </p>
                {currentNode.derivation_note && (
                  <p className="text-xs text-slate-400 mt-1">
                    {currentNode.derivation_note}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  更新: {new Date(currentNode.updated_at).toLocaleDateString("ja-JP")}
                </p>
              </div>
            </section>

            {/* 下流成果物 */}
            <section>
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
                ▼ この成果物を参照している後工程
              </p>
              {downstreamNodes.length === 0 ? (
                <p className="text-xs text-slate-600">（後続成果物なし）</p>
              ) : (
                <div className="space-y-2">
                  {downstreamNodes.map((d) => (
                    <ArtifactCard key={d.id} node={d} direction="downstream" />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
