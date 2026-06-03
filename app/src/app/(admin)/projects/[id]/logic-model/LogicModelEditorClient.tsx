"use client";

import { useState, useCallback, useEffect } from "react";
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

interface LogicModelRow {
  id: string;
  name: string | null;
  version: number;
  status: "draft" | "confirmed";
  purpose: string | null;
  basic_goal: string | null;
  basic_ideology: string | null;
  current_status: unknown | null;
  problem: string | null;
  challenge: string | null;
  root_cause: string | null;
  major_policy: string | null;
  initial_outcomes: string[] | null;
  intermediate_outcomes: string[] | null;
  inputs: string[];
  activities: string[];
  outputs: string[];
  outcomes: unknown | null;
  ai_generated: boolean;
  issue_hypothesis_id: string | null;
  generated_at: string | null;
}

interface HypothesisRow {
  id: string;
  title: string;
  root_cause: string | null;
  proposed_measures: string[] | null;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  unit: string;
}

interface Props {
  project: { id: string; title: string; description: string | null };
  logicModels: LogicModelRow[];
  hypotheses: HypothesisRow[];
  kpis: KpiRow[];
  projectId: string;
}

// カラム設定
const COLUMNS = [
  { key: "inputs", label: "投入資源", bg: "#6366f118", border: "#6366f1" },
  { key: "activities", label: "実施活動", bg: "#8b5cf618", border: "#8b5cf6" },
  { key: "outputs", label: "産出物", bg: "#06b6d418", border: "#06b6d4" },
  { key: "initial_outcomes", label: "初期成果", bg: "#10b98118", border: "#10b981" },
  { key: "intermediate_outcomes", label: "中期成果", bg: "#0d948818", border: "#0d9488" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

// カスタムノード
function ColNode({ data }: { data: { label: string; bg: string; border: string; onEdit?: (v: string) => void; editing?: boolean } }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(data.label);

  return (
    <div
      style={{
        background: data.bg,
        border: `1px solid ${data.border}`,
        borderRadius: 6,
        padding: "4px 8px",
        minWidth: 160,
        minHeight: 36,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
      }}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle type="target" position={Position.Left} style={{ background: data.border }} />
      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            setEditing(false);
            data.onEdit?.(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              setEditing(false);
              data.onEdit?.(val);
            }
          }}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#fff",
            fontSize: 12,
            width: "100%",
          }}
        />
      ) : (
        <span style={{ fontSize: 12, color: "#fff" }}>{val}</span>
      )}
      <Handle type="source" position={Position.Right} style={{ background: data.border }} />
    </div>
  );
}

const nodeTypes = { colNode: ColNode };

function buildNodes(
  colData: Record<ColumnKey, string[]>,
  onEdit: (col: ColumnKey, idx: number, val: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const prevIds: string[] = [];

  COLUMNS.forEach((col, colIdx) => {
    const items = colData[col.key] ?? [];
    const currIds: string[] = [];

    items.forEach((item, rowIdx) => {
      const id = `${col.key}-${rowIdx}`;
      currIds.push(id);
      nodes.push({
        id,
        type: "colNode",
        position: { x: colIdx * 220, y: rowIdx * 80 },
        data: {
          label: item,
          bg: col.bg,
          border: col.border,
          onEdit: (v: string) => onEdit(col.key, rowIdx, v),
        },
      });
    });

    // 隣接カラム間を全接続
    if (prevIds.length > 0 && currIds.length > 0) {
      prevIds.forEach((src) => {
        currIds.forEach((tgt) => {
          edges.push({
            id: `e-${src}-${tgt}`,
            source: src,
            target: tgt,
            style: { stroke: "#4b5563" },
          });
        });
      });
    }

    prevIds.length = 0;
    currIds.forEach((id) => prevIds.push(id));
  });

  return { nodes, edges };
}

export default function LogicModelEditorClient({
  project,
  logicModels,
  hypotheses,
  kpis,
  projectId,
}: Props) {
  const router = useRouter();
  const latest = logicModels[0] ?? null;

  // フォーム state
  const [purpose, setPurpose] = useState(latest?.purpose ?? "");
  const [basicGoal, setBasicGoal] = useState(latest?.basic_goal ?? "");
  const [challenge, setChallenge] = useState(latest?.challenge ?? "");
  const [rootCause, setRootCause] = useState(latest?.root_cause ?? "");
  const [majorPolicy, setMajorPolicy] = useState(latest?.major_policy ?? "");
  const [selectedHypId, setSelectedHypId] = useState(latest?.issue_hypothesis_id ?? "");

  // ビジュアルエディタ state
  const [colData, setColData] = useState<Record<ColumnKey, string[]>>({
    inputs: latest?.inputs ?? [],
    activities: latest?.activities ?? [],
    outputs: latest?.outputs ?? [],
    initial_outcomes: latest?.initial_outcomes ?? [],
    intermediate_outcomes: latest?.intermediate_outcomes ?? [],
  });

  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [showOutcomesModal, setShowOutcomesModal] = useState(false);
  const [currentModelId, setCurrentModelId] = useState<string | null>(latest?.id ?? null);
  const [modelStatus, setModelStatus] = useState<"draft" | "confirmed">(latest?.status ?? "draft");
  const [approving, setApproving] = useState(false);

  // 課題仮説選択時に自動引き継ぎ
  useEffect(() => {
    if (!selectedHypId) return;
    const hyp = hypotheses.find((h) => h.id === selectedHypId);
    if (!hyp) return;
    if (hyp.root_cause) setChallenge(hyp.root_cause);
  }, [selectedHypId, hypotheses]);

  const handleNodeEdit = useCallback(
    (col: ColumnKey, idx: number, val: string) => {
      setColData((prev) => {
        const arr = [...(prev[col] ?? [])];
        arr[idx] = val;
        return { ...prev, [col]: arr };
      });
    },
    [],
  );

  const handleAddItem = (col: ColumnKey) => {
    setColData((prev) => ({
      ...prev,
      [col]: [...(prev[col] ?? []), "新しい項目"],
    }));
  };

  const { nodes, edges } = buildNodes(colData, handleNodeEdit);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        purpose,
        basic_goal: basicGoal,
        challenge,
        root_cause: rootCause,
        major_policy: majorPolicy,
        issue_hypothesis_id: selectedHypId || null,
        inputs: colData.inputs,
        activities: colData.activities,
        outputs: colData.outputs,
        initial_outcomes: colData.initial_outcomes,
        intermediate_outcomes: colData.intermediate_outcomes,
      };

      if (currentModelId) {
        // PATCH
        const res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: currentModelId, ...body }),
        });
        if (res.ok) router.refresh();
      } else {
        // POST
        const res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = (await res.json()) as { data: { id: string } };
          setCurrentModelId(data.data.id);
          router.refresh();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!currentModelId) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentModelId, status: "confirmed" }),
      });
      if (res.ok) setModelStatus("confirmed");
    } finally {
      setApproving(false);
    }
  };

  const handleAiGenerate = async () => {
    setAiGenerating(true);
    setAiStatus("AI生成中...");
    try {
      const res = await fetch("/api/ai/generate-logic-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: project.title,
          description: project.description ?? "",
          kpis: kpis.map((k) => ({ label: k.label, target: k.target, unit: k.unit })),
        }),
      });

      if (!res.ok || !res.body) {
        setAiStatus("生成に失敗しました");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }

      try {
        // フェンス除去
        const jsonText = text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, "$1").trim();
        const parsed = JSON.parse(jsonText) as {
          inputs?: string[];
          activities?: string[];
          outputs?: string[];
          short_outcomes?: string[];
          long_outcomes?: string[];
          initial_outcomes?: string[];
          intermediate_outcomes?: string[];
        };

        if (parsed.inputs) setColData((prev) => ({ ...prev, inputs: parsed.inputs! }));
        if (parsed.activities) setColData((prev) => ({ ...prev, activities: parsed.activities! }));
        if (parsed.outputs) setColData((prev) => ({ ...prev, outputs: parsed.outputs! }));
        if (parsed.short_outcomes)
          setColData((prev) => ({ ...prev, initial_outcomes: parsed.short_outcomes! }));
        if (parsed.long_outcomes)
          setColData((prev) => ({ ...prev, intermediate_outcomes: parsed.long_outcomes! }));
        if (parsed.initial_outcomes)
          setColData((prev) => ({ ...prev, initial_outcomes: parsed.initial_outcomes! }));
        if (parsed.intermediate_outcomes)
          setColData((prev) => ({ ...prev, intermediate_outcomes: parsed.intermediate_outcomes! }));

        setAiStatus("生成完了");
      } catch {
        setAiStatus("JSONのパースに失敗しました");
      }
    } catch {
      setAiStatus("通信エラーが発生しました");
    } finally {
      setAiGenerating(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    borderColor: "var(--border)",
  };

  const allOutcomes = [
    ...colData.initial_outcomes.map((o) => ({ type: "初期成果", label: o })),
    ...colData.intermediate_outcomes.map((o) => ({ type: "中期成果", label: o })),
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-full mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-slate-500">{project.title}</p>
              <h1 className="text-xl font-bold text-slate-100">ロジックモデル</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 課題仮説選択 */}
            <select
              value={selectedHypId}
              onChange={(e) => setSelectedHypId(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              style={inputStyle}
            >
              <option value="">課題仮説を選択...</option>
              {hypotheses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                </option>
              ))}
            </select>

            <PermissionGate module="logic_model" level="edit" projectId={projectId}>
              <div className="neu-button-wrap">
                <button
                  onClick={handleAiGenerate}
                  disabled={aiGenerating}
                  className="neu-button-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ background: "#6366f1" }}
                >
                  {aiGenerating ? "生成中..." : "AIで生成"}
                </button>
              </div>
            </PermissionGate>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ background: "#10b981" }}
            >
              {saving ? "保存中..." : "保存"}
            </button>

            {currentModelId && modelStatus !== "confirmed" && (
              <PermissionGate module="logic_model" level="approve" projectId={projectId}>
                <button
                  onClick={() => void handleApprove()}
                  disabled={approving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ background: "#f59e0b" }}
                >
                  {approving ? "処理中..." : "承認済みにする"}
                </button>
              </PermissionGate>
            )}
          </div>
        </div>

        {aiStatus && (
          <div
            className="mb-4 text-xs px-3 py-2 rounded-lg"
            style={{ background: "#6366f118", color: "#818cf8", border: "1px solid #6366f140" }}
          >
            {aiStatus}
          </div>
        )}

        {/* メインレイアウト: 左カラム（基本情報）+ 右カラム（ビジュアル） */}
        <div className="flex gap-6">
          {/* エリアA: 基本情報フォーム */}
          <div
            className="rounded-xl border p-5 space-y-4"
            style={{
              background: "var(--bg-secondary)",
              borderColor: "var(--border)",
              width: 320,
              flexShrink: 0,
            }}
          >
            <h2 className="text-sm font-semibold text-slate-300">基本情報</h2>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">目的</label>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="この政策の目的"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">基本目標</label>
              <textarea
                value={basicGoal}
                onChange={(e) => setBasicGoal(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="達成すべき基本目標"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">課題</label>
              <textarea
                value={challenge}
                onChange={(e) => setChallenge(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="解決すべき課題（課題仮説から自動引き継ぎ可）"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">真因</label>
              <textarea
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="課題の根本原因"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">主要施策</label>
              <textarea
                value={majorPolicy}
                onChange={(e) => setMajorPolicy(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="主要な施策・アプローチ"
                rows={2}
              />
            </div>

            {/* 成果モーダル呼び出しボタン */}
            {allOutcomes.length > 0 && (
              <button
                onClick={() => setShowOutcomesModal(true)}
                className="w-full text-xs px-3 py-2 rounded-lg font-medium transition-colors"
                style={{
                  background: "#06b6d418",
                  color: "#06b6d4",
                  border: "1px solid #06b6d440",
                }}
              >
                ロジックモデルから数値を取り込む
              </button>
            )}
          </div>

          {/* エリアB: reactflow ビジュアルエディタ */}
          <div className="flex-1 flex flex-col gap-3">
            {/* カラムヘッダー */}
            <div className="flex gap-2">
              {COLUMNS.map((col) => (
                <div key={col.key} style={{ width: 200, flexShrink: 0 }}>
                  <div
                    className="text-xs font-medium text-center py-1 rounded-t-md"
                    style={{ color: col.border, borderBottom: `1px solid ${col.border}40` }}
                  >
                    {col.label}
                  </div>
                </div>
              ))}
            </div>

            {/* reactflow キャンバス */}
            <div
              className="rounded-xl border overflow-hidden"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                height: 420,
              }}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                style={{ background: "var(--bg-primary)" }}
              >
                <Background color="#cbd5e1" gap={16} />
                <Controls />
              </ReactFlow>
            </div>

            {/* アイテム追加ボタン */}
            <div className="flex gap-2">
              {COLUMNS.map((col) => (
                <div key={col.key} style={{ width: 200, flexShrink: 0 }}>
                  <button
                    onClick={() => handleAddItem(col.key)}
                    className="w-full text-xs py-1 rounded-md transition-colors"
                    style={{ color: col.border, border: `1px dashed ${col.border}60` }}
                  >
                    + 追加
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 成果取り込みモーダル */}
      {showOutcomesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "#00000080" }}
        >
          <div
            className="rounded-xl border w-full max-w-md mx-4 p-6 neu-card"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <h2 className="text-base font-semibold text-slate-100 mb-4">
              ロジックモデルの成果項目
            </h2>

            <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
              {allOutcomes.map((o, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
                >
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      background:
                        o.type === "初期成果" ? "#10b98118" : "#0d948818",
                      color: o.type === "初期成果" ? "#10b981" : "#0d9488",
                      border: `1px solid ${o.type === "初期成果" ? "#10b98140" : "#0d948840"}`,
                    }}
                  >
                    {o.type}
                  </span>
                  <span className="text-xs text-slate-300 flex-1">{o.label}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-500 mb-4">
              これらの成果項目をコスト評価に反映できます。
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowOutcomesModal(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                閉じる
              </button>
              <a
                href={`/projects/${projectId}/evaluations`}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: "#6366f1" }}
                onClick={() => setShowOutcomesModal(false)}
              >
                コスト評価に反映
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
