"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import PermissionGate from "@/components/PermissionGate";
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

interface IssueHypothesis {
  id: string;
  title: string;
  description: string | null;
  root_cause: string | null;
  root_cause_tree: unknown | null;
  priority_rank: number | null;
  smart_check: unknown | null;
  evidence_sources: string[] | null;
  proposed_measures: string[] | null;
  status: "draft" | "confirmed" | "rejected";
  ai_generated: boolean;
  verification_notes: string | null;
  gap_analysis_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GapRow {
  id: string;
  indicator_name: string;
  gap_value: string;
  trend: string;
  priority_score: number | null;
}

interface Props {
  project: { id: string; title: string };
  hypotheses: IssueHypothesis[];
  gaps: GapRow[];
  projectId: string;
}

const STATUS_BADGE: Record<
  IssueHypothesis["status"],
  { label: string; style: React.CSSProperties }
> = {
  draft: {
    label: "下書き",
    style: {
      background: "#64748b20",
      color: "#94a3b8",
      border: "1px solid #64748b40",
    },
  },
  confirmed: {
    label: "確定",
    style: {
      background: "#10b98120",
      color: "#10b981",
      border: "1px solid #10b98140",
    },
  },
  rejected: {
    label: "却下",
    style: {
      background: "#ef444420",
      color: "#ef4444",
      border: "1px solid #ef444440",
    },
  },
};

function starsForEvidence(count: number): string {
  const filled = Math.min(5, count);
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}

function buildFlowNodes(
  nodes: TreeNode[],
  parentId: string | null,
  level: number,
  colIndex: { val: number },
): { nodes: Node[]; edges: Edge[] } {
  const resultNodes: Node[] = [];
  const resultEdges: Edge[] = [];

  for (const node of nodes) {
    const col = colIndex.val++;
    const flowNode: Node = {
      id: node.id,
      position: { x: col * 180, y: level * 100 },
      data: { label: node.label },
      style: {
        background: "var(--bg-secondary)",
        border: "1px solid #6366f1",
        color: "#fff",
        width: 160,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        borderRadius: 6,
      },
    };
    resultNodes.push(flowNode);

    if (parentId) {
      resultEdges.push({
        id: `e-${parentId}-${node.id}`,
        source: parentId,
        target: node.id,
        type: "smoothstep",
        style: { stroke: "#6366f1" },
      });
    }

    if (node.children && node.children.length > 0) {
      const sub = buildFlowNodes(node.children, node.id, level + 1, colIndex);
      resultNodes.push(...sub.nodes);
      resultEdges.push(...sub.edges);
    }
  }

  return { nodes: resultNodes, edges: resultEdges };
}

function CustomNode({ data }: { data: { label: string } }) {
  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid #6366f1",
        color: "#fff",
        width: 160,
        minHeight: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        borderRadius: 6,
        padding: "4px 8px",
        textAlign: "center",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#6366f1" }} />
      {data.label}
      <Handle type="source" position={Position.Bottom} style={{ background: "#6366f1" }} />
    </div>
  );
}

const nodeTypes = { custom: CustomNode };

export default function IssueHypothesisClient({
  project,
  hypotheses: initialHypotheses,
  gaps,
  projectId,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"list" | "tree">("list");
  const [hypotheses, setHypotheses] = useState(initialHypotheses);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedHypId, setSelectedHypId] = useState<string>(
    initialHypotheses[0]?.id ?? "",
  );

  // フォーム state
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formRootCause, setFormRootCause] = useState("");
  const [formPriorityRank, setFormPriorityRank] = useState("");
  const [formStatus, setFormStatus] = useState<"draft" | "confirmed" | "rejected">("draft");
  const [formEvidence, setFormEvidence] = useState("");
  const [formMeasures, setFormMeasures] = useState("");
  const [formGapId, setFormGapId] = useState("");

  // AI生成 state
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showAiGapSelect, setShowAiGapSelect] = useState(false);
  const [aiSelectGapId, setAiSelectGapId] = useState(gaps[0]?.id ?? "");

  // ロジックツリー用 state
  const selectedHyp = hypotheses.find((h) => h.id === selectedHypId);
  const [treeData, setTreeData] = useState<TreeNode[]>(
    (selectedHyp?.root_cause_tree as TreeNode[] | null) ?? [],
  );
  const [savingTree, setSavingTree] = useState(false);

  // ギャップ分析の優先度表示（priority_score降順、最大5件）
  const topGaps = [...gaps]
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .slice(0, 5);
  const maxScore = Math.max(...topGaps.map((g) => g.priority_score ?? 0), 1);

  const handleAddHyp = async () => {
    if (!formTitle.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/issue-hypothesis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formTitle,
          description: formDesc || null,
          root_cause: formRootCause || null,
          priority_rank: formPriorityRank ? parseInt(formPriorityRank, 10) : null,
          status: formStatus,
          evidence_sources: formEvidence
            ? formEvidence.split(",").map((s) => s.trim()).filter(Boolean)
            : null,
          proposed_measures: formMeasures
            ? formMeasures.split(",").map((s) => s.trim()).filter(Boolean)
            : null,
          gap_analysis_id: formGapId || null,
        }),
      });
      if (res.ok) {
        setShowModal(false);
        setFormTitle("");
        setFormDesc("");
        setFormRootCause("");
        setFormPriorityRank("");
        setFormStatus("draft");
        setFormEvidence("");
        setFormMeasures("");
        setFormGapId("");
        router.refresh();
        // 楽観的更新
        const data = (await res.json()) as { data: { id: string } };
        setHypotheses((prev) => [
          ...prev,
          {
            id: data.data.id,
            title: formTitle,
            description: formDesc || null,
            root_cause: formRootCause || null,
            root_cause_tree: null,
            priority_rank: formPriorityRank ? parseInt(formPriorityRank, 10) : null,
            smart_check: null,
            evidence_sources: formEvidence
              ? formEvidence.split(",").map((s) => s.trim()).filter(Boolean)
              : null,
            proposed_measures: formMeasures
              ? formMeasures.split(",").map((s) => s.trim()).filter(Boolean)
              : null,
            status: formStatus,
            ai_generated: false,
            verification_notes: null,
            gap_analysis_id: formGapId || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (hypId: string) => {
    if (!confirm("この課題仮説を削除しますか？")) return;
    const res = await fetch(
      `/api/admin/projects/${projectId}/issue-hypothesis/${hypId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setHypotheses((prev) => prev.filter((h) => h.id !== hypId));
    }
  };

  const handleAdopt = async (hypId: string) => {
    const res = await fetch(`/api/admin/projects/${projectId}/issue-hypothesis/${hypId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    if (res.ok) {
      setHypotheses((prev) => prev.map((h) => h.id === hypId ? { ...h, status: "confirmed" } : h));
    }
  };

  const handleInheritToLogicModel = async (hyp: IssueHypothesis) => {
    const res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: hyp.title,
        challenge: hyp.root_cause ?? hyp.description ?? "",
        issue_hypothesis_id: hyp.id,
      }),
    });
    if (res.ok) {
      router.push(`/projects/${projectId}/logic-model`);
    }
  };

  const handleSaveTree = useCallback(async () => {
    if (!selectedHypId) return;
    setSavingTree(true);
    try {
      await fetch(
        `/api/admin/projects/${projectId}/issue-hypothesis/${selectedHypId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root_cause_tree: treeData }),
        },
      );
      setHypotheses((prev) =>
        prev.map((h) =>
          h.id === selectedHypId ? { ...h, root_cause_tree: treeData } : h,
        ),
      );
    } finally {
      setSavingTree(false);
    }
  }, [selectedHypId, treeData, projectId]);

  // AI提案を呼び出してフォームをプリフィル
  const handleAiSuggest = async (gapId: string) => {
    setShowAiGapSelect(false);
    setAiGenerating(true);
    setAiError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/issue-hypothesis/ai-suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gap_analysis_id: gapId }),
        },
      );
      const json = (await res.json()) as {
        data: {
          gap_analysis_id: string;
          suggestion: {
            title: string;
            description: string;
            root_cause: string;
            proposed_measures: string[];
          };
        } | null;
        error: string | null;
      };
      if (!res.ok || json.error || !json.data) {
        setAiError(json.error ?? "AI提案の取得に失敗しました");
        return;
      }
      const s = json.data.suggestion;
      // フォームをプリフィルしてモーダルを開く
      setFormTitle(s.title);
      setFormDesc(s.description ?? "");
      setFormRootCause(s.root_cause ?? "");
      setFormMeasures((s.proposed_measures ?? []).join(", "));
      setFormGapId(gapId);
      setFormEvidence("");
      setFormPriorityRank("");
      setFormStatus("draft");
      setShowModal(true);
    } catch {
      setAiError("通信エラーが発生しました");
    } finally {
      setAiGenerating(false);
    }
  };

  // AIで生成ボタンクリック
  const handleAiButtonClick = () => {
    setAiError(null);
    if (gaps.length === 0) return;
    if (gaps.length === 1) {
      void handleAiSuggest(gaps[0]!.id);
    } else {
      setAiSelectGapId(gaps[0]!.id);
      setShowAiGapSelect(true);
    }
  };

  const handleAddNode = () => {
    const newId = `node-${Date.now()}`;
    setTreeData((prev) => [...prev, { id: newId, label: "新しいノード", children: [] }]);
  };

  const handleSelectHyp = (id: string) => {
    setSelectedHypId(id);
    const hyp = hypotheses.find((h) => h.id === id);
    setTreeData((hyp?.root_cause_tree as TreeNode[] | null) ?? []);
  };

  // reactflow ノード/エッジ生成
  const colIndex = { val: 0 };
  const rootNode: Node = {
    id: "root",
    position: { x: 0, y: 0 },
    data: { label: selectedHyp?.title ?? "仮説" },
    style: {
      background: "#6366f120",
      border: "1px solid #6366f1",
      color: "#fff",
      width: 160,
      height: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      borderRadius: 6,
    },
  };

  const { nodes: childNodes, edges: childEdges } = buildFlowNodes(
    treeData,
    "root",
    1,
    colIndex,
  );
  const flowNodes: Node[] = [rootNode, ...childNodes];
  const flowEdges: Edge[] = childEdges;

  const inputClass =
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    borderColor: "var(--border)",
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <BackButton />
          <div>
            <p className="text-xs text-slate-500">{project.title}</p>
            <h1 className="text-xl font-bold text-slate-100">課題仮説設定</h1>
          </div>
        </div>

        {/* タブ */}
        <div
          className="flex gap-1 mb-6 rounded-lg p-1"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", width: "fit-content" }}
        >
          {(["list", "tree"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={
                tab === t
                  ? { background: "#6366f1", color: "#fff" }
                  : { color: "#94a3b8" }
              }
            >
              {t === "list" ? "仮説一覧" : "ロジックツリー"}
            </button>
          ))}
        </div>

        {/* タブ1: 仮説一覧 */}
        {tab === "list" && (
          <div>
            {/* ギャップ分析サマリー */}
            {topGaps.length > 0 && (
              <div
                className="rounded-xl border p-5 mb-6"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <h2 className="text-sm font-semibold text-slate-300 mb-3">
                  ギャップ分析 — 優先度上位
                </h2>
                <div className="space-y-2">
                  {topGaps.map((g) => (
                    <div key={g.id} className="flex items-center gap-3">
                      <span
                        className="text-xs text-slate-400 truncate"
                        style={{ width: 200 }}
                      >
                        {g.indicator_name}
                      </span>
                      <div
                        className="flex-1 rounded-full overflow-hidden"
                        style={{ background: "var(--border)", height: 8 }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${((g.priority_score ?? 0) / maxScore) * 100}%`,
                            background: "#6366f1",
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 w-12 text-right">
                        {g.priority_score ?? "-"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AIエラー */}
            {aiError && (
              <div
                className="rounded-lg border px-4 py-2 text-sm mb-4"
                style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
              >
                {aiError}
                <button
                  onClick={() => setAiError(null)}
                  className="ml-3 text-xs opacity-60 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}

            {/* アクションボタン */}
            <div className="flex items-center justify-end gap-3 mb-4">
              {gaps.length > 0 && (
                <PermissionGate module="issue_hypothesis" level="edit" projectId={projectId}>
                  <div className="neu-button-wrap">
                    <button
                      onClick={handleAiButtonClick}
                      disabled={aiGenerating}
                      className="neu-button-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      style={{
                        background: "#8b5cf618",
                        color: "#a78bfa",
                        border: "1px solid #8b5cf640",
                      }}
                    >
                      {aiGenerating ? (
                        <>
                          <span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          生成中...
                        </>
                      ) : (
                        "✨ AIで生成"
                      )}
                    </button>
                  </div>
                </PermissionGate>
              )}
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: "#6366f1" }}
              >
                + 課題仮説を追加
              </button>
            </div>

            {/* 仮説カード一覧 */}
            {hypotheses.length === 0 ? (
              <div
                className="rounded-xl border p-12 text-center"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <p className="text-slate-500 text-sm">課題仮説がありません</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {hypotheses.map((hyp) => (
                  <div
                    key={hyp.id}
                    className="rounded-xl border p-5"
                    style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-100">
                          {hyp.title}
                        </h3>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={STATUS_BADGE[hyp.status].style}
                        >
                          {STATUS_BADGE[hyp.status].label}
                        </span>
                        {hyp.priority_rank != null && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-mono"
                            style={{
                              background: "#f59e0b18",
                              color: "#f59e0b",
                              border: "1px solid #f59e0b40",
                            }}
                          >
                            #{hyp.priority_rank}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {hyp.status !== "confirmed" && (
                          <PermissionGate module="issue_hypothesis" level="approve" projectId={projectId}>
                            <button
                              onClick={() => void handleAdopt(hyp.id)}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                              style={{
                                background: "#f59e0b18",
                                color: "#f59e0b",
                                border: "1px solid #f59e0b40",
                              }}
                            >
                              採用
                            </button>
                          </PermissionGate>
                        )}
                        <button
                          onClick={() => handleInheritToLogicModel(hyp)}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                          style={{
                            background: "#10b98118",
                            color: "#10b981",
                            border: "1px solid #10b98140",
                          }}
                        >
                          ロジックモデルに引き継ぐ
                        </button>
                        <button
                          onClick={() => handleDelete(hyp.id)}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                          style={{
                            background: "#ef444418",
                            color: "#ef4444",
                            border: "1px solid #ef444440",
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    {hyp.description && (
                      <p
                        className="text-xs text-slate-400 mb-2"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {hyp.description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span title="エビデンス強度">
                        {starsForEvidence(hyp.evidence_sources?.length ?? 0)}
                      </span>
                      {hyp.proposed_measures && hyp.proposed_measures.length > 0 && (
                        <span>
                          対策: {hyp.proposed_measures.slice(0, 3).join(" / ")}
                          {hyp.proposed_measures.length > 3 && " ..."}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* タブ2: ロジックツリー */}
        {tab === "tree" && (
          <div className="flex gap-4">
            {/* 左: 仮説選択 */}
            <div
              className="rounded-xl border p-4"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", width: 260, flexShrink: 0 }}
            >
              <h2 className="text-sm font-semibold text-slate-300 mb-3">仮説を選択</h2>
              <select
                value={selectedHypId}
                onChange={(e) => handleSelectHyp(e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                {hypotheses.length === 0 && (
                  <option value="">仮説がありません</option>
                )}
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}
                  </option>
                ))}
              </select>

              <div className="mt-4 space-y-2">
                <button
                  onClick={handleAddNode}
                  disabled={!selectedHypId}
                  className="w-full text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-40"
                  style={{ background: "#6366f118", color: "#818cf8", border: "1px solid #6366f140" }}
                >
                  + ノードを追加
                </button>
                <button
                  onClick={handleSaveTree}
                  disabled={!selectedHypId || savingTree}
                  className="w-full text-xs px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-40"
                  style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
                >
                  {savingTree ? "保存中..." : "ツリーを保存"}
                </button>
              </div>
            </div>

            {/* 右: reactflow */}
            <div
              className="rounded-xl border flex-1 overflow-hidden"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", height: 500 }}
            >
              {!selectedHyp ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                  仮説を選択してください
                </div>
              ) : flowNodes.length <= 1 && treeData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                  ロジックツリー未設定
                </div>
              ) : (
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  fitView
                  style={{ background: "var(--bg-primary)" }}
                >
                  <Background color="#cbd5e1" gap={16} />
                  <Controls />
                </ReactFlow>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ギャップ選択モーダル（複数ギャップがある場合） */}
      {showAiGapSelect && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "#00000080" }}
        >
          <div
            className="rounded-xl border w-full max-w-sm mx-4 p-6 neu-card"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <h2 className="text-base font-semibold text-slate-100 mb-1">
              ✨ AIで課題仮説を生成
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              分析に使用するギャップを選択してください
            </p>
            <select
              value={aiSelectGapId}
              onChange={(e) => setAiSelectGapId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors"
              style={{ background: "var(--bg-input)", borderColor: "var(--border)" }}
            >
              {gaps.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.indicator_name}（ギャップ: {g.gap_value}）
                </option>
              ))}
            </select>
            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setShowAiGapSelect(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => void handleAiSuggest(aiSelectGapId)}
                disabled={!aiSelectGapId}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: "#8b5cf6" }}
              >
                生成する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 追加モーダル */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "#00000080" }}
        >
          <div
            className="rounded-xl border w-full max-w-lg mx-4 p-6 neu-card"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <h2 className="text-base font-semibold text-slate-100 mb-1">
              課題仮説を追加
            </h2>
            {formTitle && formRootCause && (
              <p className="text-xs text-purple-400 mb-3">
                ✨ AIの提案内容が入力されています。内容を確認して保存してください。
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">タイトル *</label>
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="課題仮説のタイトル"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">説明</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="詳細な説明"
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">真因</label>
                <input
                  value={formRootCause}
                  onChange={(e) => setFormRootCause(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="根本原因"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">優先度ランク</label>
                  <input
                    type="number"
                    value={formPriorityRank}
                    onChange={(e) => setFormPriorityRank(e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="1, 2, 3..."
                    min={1}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">ステータス</label>
                  <select
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as IssueHypothesis["status"])
                    }
                    className={inputClass}
                    style={inputStyle}
                  >
                    <option value="draft">下書き</option>
                    <option value="confirmed">確定</option>
                    <option value="rejected">却下</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  エビデンス（カンマ区切り）
                </label>
                <input
                  value={formEvidence}
                  onChange={(e) => setFormEvidence(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="文献A, 調査B, ..."
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  提案対策（カンマ区切り）
                </label>
                <input
                  value={formMeasures}
                  onChange={(e) => setFormMeasures(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="対策A, 対策B, ..."
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  紐付けるギャップ分析
                </label>
                <select
                  value={formGapId}
                  onChange={(e) => setFormGapId(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="">未選択</option>
                  {gaps.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.indicator_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <PermissionGate module="issue_hypothesis" level="edit" projectId={projectId}>
                <button
                  onClick={handleAddHyp}
                  disabled={!formTitle.trim() || submitting}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ background: "#6366f1" }}
                >
                  {submitting ? "追加中..." : "追加"}
                </button>
              </PermissionGate>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
