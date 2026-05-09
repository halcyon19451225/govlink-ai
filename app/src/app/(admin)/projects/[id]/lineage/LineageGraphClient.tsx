"use client";

import { useRouter } from "next/navigation";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import BackButton from "@/components/BackButton";

interface DatasetRow {
  id: string;
  file_name: string;
  dataset_def_id: string;
  display_name: string;
}

interface GapRow {
  id: string;
  indicator_name: string;
}

interface HypothesisRow {
  id: string;
  title: string;
  gap_analysis_id: string | null;
}

interface ModelRow {
  id: string;
  name: string | null;
  issue_hypothesis_id: string | null;
}

interface Props {
  project: { id: string; title: string };
  datasets: DatasetRow[];
  gaps: GapRow[];
  hypotheses: HypothesisRow[];
  models: ModelRow[];
  projectId: string;
}

const NODE_TYPES = {
  dataset: { bg: "#06b6d418", border: "#06b6d4", typeLabel: "データセット" },
  gap_analysis: { bg: "#f59e0b18", border: "#f59e0b", typeLabel: "ギャップ分析" },
  issue_hypothesis: { bg: "#8b5cf618", border: "#8b5cf6", typeLabel: "課題仮説" },
  logic_model: { bg: "#10b98118", border: "#10b981", typeLabel: "ロジックモデル" },
} as const;

type NodeType = keyof typeof NODE_TYPES;

function makeNodeStyle(type: NodeType): React.CSSProperties {
  const { bg, border } = NODE_TYPES[type];
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    color: "#fff",
    fontSize: 12,
    padding: "4px 10px",
    minWidth: 160,
    cursor: "pointer",
  };
}

export default function LineageGraphClient({
  project,
  datasets,
  gaps,
  hypotheses,
  models,
  projectId,
}: Props) {
  const router = useRouter();

  // ノード構築
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // データセットノード (x=0)
  datasets.forEach((ds, i) => {
    nodes.push({
      id: `ds-${ds.id}`,
      position: { x: 0, y: i * 100 },
      data: {
        label: (
          <div>
            <div style={{ fontSize: 9, color: NODE_TYPES.dataset.border, marginBottom: 2 }}>
              {NODE_TYPES.dataset.typeLabel}
            </div>
            <div style={{ fontSize: 12 }}>{ds.display_name || ds.file_name}</div>
          </div>
        ),
      },
      style: makeNodeStyle("dataset"),
    });
  });

  // ギャップ分析ノード (x=280)
  gaps.forEach((g, i) => {
    nodes.push({
      id: `gap-${g.id}`,
      position: { x: 280, y: i * 100 },
      data: {
        label: (
          <div>
            <div style={{ fontSize: 9, color: NODE_TYPES.gap_analysis.border, marginBottom: 2 }}>
              {NODE_TYPES.gap_analysis.typeLabel}
            </div>
            <div style={{ fontSize: 12 }}>{g.indicator_name}</div>
          </div>
        ),
      },
      style: makeNodeStyle("gap_analysis"),
    });

    // データセット → ギャップ分析: 常に全接続
    datasets.forEach((ds) => {
      edges.push({
        id: `e-ds-${ds.id}-gap-${g.id}`,
        source: `ds-${ds.id}`,
        target: `gap-${g.id}`,
        style: { stroke: "#4b5563" },
      });
    });
  });

  // 課題仮説ノード (x=560)
  hypotheses.forEach((h, i) => {
    nodes.push({
      id: `hyp-${h.id}`,
      position: { x: 560, y: i * 100 },
      data: {
        label: (
          <div>
            <div style={{ fontSize: 9, color: NODE_TYPES.issue_hypothesis.border, marginBottom: 2 }}>
              {NODE_TYPES.issue_hypothesis.typeLabel}
            </div>
            <div style={{ fontSize: 12 }}>{h.title}</div>
          </div>
        ),
      },
      style: makeNodeStyle("issue_hypothesis"),
    });

    // gap_analysis → issue_hypothesis: gap_analysis_id が一致する場合
    if (h.gap_analysis_id) {
      const matchedGap = gaps.find((g) => g.id === h.gap_analysis_id);
      if (matchedGap) {
        edges.push({
          id: `e-gap-${matchedGap.id}-hyp-${h.id}`,
          source: `gap-${matchedGap.id}`,
          target: `hyp-${h.id}`,
          style: { stroke: "#8b5cf6" },
        });
      }
    }
  });

  // ロジックモデルノード (x=840)
  models.forEach((m, i) => {
    nodes.push({
      id: `model-${m.id}`,
      position: { x: 840, y: i * 100 },
      data: {
        label: (
          <div>
            <div style={{ fontSize: 9, color: NODE_TYPES.logic_model.border, marginBottom: 2 }}>
              {NODE_TYPES.logic_model.typeLabel}
            </div>
            <div style={{ fontSize: 12 }}>{m.name ?? "ロジックモデル"}</div>
          </div>
        ),
      },
      style: makeNodeStyle("logic_model"),
    });

    // issue_hypothesis → logic_model: issue_hypothesis_id が一致する場合
    if (m.issue_hypothesis_id) {
      const matchedHyp = hypotheses.find((h) => h.id === m.issue_hypothesis_id);
      if (matchedHyp) {
        edges.push({
          id: `e-hyp-${matchedHyp.id}-model-${m.id}`,
          source: `hyp-${matchedHyp.id}`,
          target: `model-${m.id}`,
          style: { stroke: "#10b981" },
        });
      }
    }
  });

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    const id = node.id as string;
    if (id.startsWith("ds-")) {
      router.push(`/projects/${projectId}/datasets`);
    } else if (id.startsWith("gap-")) {
      router.push(`/projects/${projectId}/gap-analysis`);
    } else if (id.startsWith("hyp-")) {
      router.push(`/projects/${projectId}/issue-hypothesis`);
    } else if (id.startsWith("model-")) {
      router.push(`/projects/${projectId}/logic-model`);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#0f1117" }}>
      <div className="max-w-full mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <BackButton />
          <div>
            <p className="text-xs text-slate-500">{project.title}</p>
            <h1 className="text-xl font-bold text-slate-100">データリネージグラフ</h1>
          </div>
        </div>

        {/* 凡例 */}
        <div className="flex gap-4 mb-4 flex-wrap">
          {(Object.entries(NODE_TYPES) as [NodeType, (typeof NODE_TYPES)[NodeType]][]).map(
            ([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ background: val.bg, border: `1px solid ${val.border}` }}
                />
                <span className="text-xs text-slate-400">{val.typeLabel}</span>
              </div>
            ),
          )}
        </div>

        {/* reactflow */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            background: "#0f1117",
            borderColor: "#2a2d3a",
            height: 600,
          }}
        >
          {nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              データがありません
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              onNodeClick={handleNodeClick}
              style={{ background: "#0f1117" }}
            >
              <Background color="#2a2d3a" gap={16} />
              <Controls />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}
