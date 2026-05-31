"use client";

import { useEffect, useState } from "react";

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

interface ArtifactLineagePanelProps {
  projectId: string;
  artifactId: string;
  moduleName: string;
  onClose: () => void;
}

function ArtifactCard({ node, direction }: { node: ArtifactNode; direction: "upstream" | "downstream" }) {
  const tag = MODULE_LABELS[node.module_id] ?? node.module_id.toUpperCase().slice(0, 2);
  const color = direction === "upstream" ? "#6366f1" : "#f59e0b";

  return (
    <div
      className="rounded-lg border p-3 space-y-1"
      style={{ borderColor: "#2a2d3a", background: "#161922" }}
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
  const [node, setNode] = useState<ArtifactNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/projects/${projectId}/lineage?artifactId=${artifactId}`)
      .then((r) => r.json() as Promise<{ data: ArtifactNode[] | null; error: string | null }>)
      .then(({ data, error: err }) => {
        if (err) { setError(err); return; }
        setNode(data?.[0] ?? null);
      })
      .catch(() => setError("データの取得に失敗しました"))
      .finally(() => setLoading(false));
  }, [projectId, artifactId]);

  const hasDownstream = (node?.downstream?.length ?? 0) > 0;

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-50 flex flex-col shadow-2xl"
      style={{ background: "#1a1d27", borderLeft: "1px solid #2a2d3a" }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "#2a2d3a" }}
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
        {!loading && !error && !node && (
          <p className="text-xs text-slate-500 text-center py-8">
            成果物が見つかりません
          </p>
        )}

        {node && (
          <>
            {/* 下流成果物がある場合の赤色警告 */}
            {hasDownstream && (
              <div
                className="rounded-lg border p-3 text-xs"
                style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
              >
                ⚠ このデータを更新すると後続の分析（{node.downstream.length}件）に影響します
              </div>
            )}

            {/* 陳腐化警告 */}
            {node.is_stale && (
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
              {node.upstream.length === 0 ? (
                <p className="text-xs text-slate-600">（上流成果物なし）</p>
              ) : (
                <div className="space-y-2">
                  {node.upstream.map((u) => (
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
                <p className="text-xs font-medium text-slate-200">{node.artifact_type}</p>
                {node.derivation_note && (
                  <p className="text-xs text-slate-400 mt-1">{node.derivation_note}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  更新: {new Date(node.updated_at).toLocaleDateString("ja-JP")}
                </p>
              </div>
            </section>

            {/* 下流成果物 */}
            <section>
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">
                ▼ この成果物を参照している後工程
              </p>
              {node.downstream.length === 0 ? (
                <p className="text-xs text-slate-600">（後続成果物なし）</p>
              ) : (
                <div className="space-y-2">
                  {node.downstream.map((d) => (
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
