"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import PermissionGate from "@/components/PermissionGate";
import {
  LOGIC_COLUMNS,
  type LogicColumnKey,
  type LogicElement,
  newElementId,
  normalizeColumns,
} from "@/lib/logicmodel/elements";
import { checkConsistency } from "@/lib/logicmodel/consistency";
import { normalizeEdges, suggestAdjacentEdges, type LogicEdge } from "@/lib/logicmodel/elements";
import { diffModel } from "@/lib/logicmodel/diff";
import VersionDiffPanel from "@/components/logicmodel/VersionDiffPanel";
import KpiAssignPanel, {
  summarizeElement,
  type PanelKpi,
} from "@/components/logicmodel/KpiAssignPanel";
import ConsistencyPanel from "@/components/logicmodel/ConsistencyPanel";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Connection,
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
  // 要素列は JSONB。文字列配列・{term,text}・{id,text,kpi_ids} が混在しうるため
  // 型を決め打ちせず、normalizeColumns を通して読む（src/lib/logicmodel/elements.ts）。
  initial_outcomes: unknown;
  intermediate_outcomes: unknown;
  long_outcomes: unknown;
  inputs: unknown;
  activities: unknown;
  outputs: unknown;
  outcomes: unknown | null;
  edges: unknown;
  is_current: boolean;
  revision_reason: string | null;
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

// 到達度の算定と整合検査に必要な列を揃える。
// 以前は label/target/unit しか持っておらず、
// 目標の向き（以上／以下）も基準値も見ずに達成率を出していた。
type KpiRow = PanelKpi;

interface Props {
  project: { id: string; title: string; description: string | null };
  logicModels: LogicModelRow[];
  hypotheses: HypothesisRow[];
  kpis: KpiRow[];
  projectId: string;
}

// カラム設定は src/lib/logicmodel/elements.ts の LOGIC_COLUMNS が正本。
// 以前は画面ごとに列の定義とラベルが重複しており、
// 「初期成果」「短期成果」「短期アウトカム」が混在していた。
const COLUMNS = LOGIC_COLUMNS.map((c) => ({
  key: c.key,
  label: c.label,
  bg: c.color + "18",
  border: c.color,
}));

type ColumnKey = LogicColumnKey;

// カスタムノード
function ColNode({
  data,
}: {
  data: {
    label: string;
    bg: string;
    border: string;
    kpiCount?: number;
    /** 紐付いたKPIの到達度(0-100)。KPI未割当なら null */
    rate?: number | null;
    achieved?: number;
    selected?: boolean;
    onEdit?: (v: string) => void;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(data.label);

  // 親の state が更新されたら（AI生成など）表示も追随させる
  useEffect(() => {
    if (!editing) setVal(data.label);
  }, [data.label, editing]);

  return (
    <div
      style={{
        background: data.bg,
        border: `1px solid ${data.selected ? "#fff" : data.border}`,
        boxShadow: data.selected ? `0 0 0 2px ${data.border}` : undefined,
        borderRadius: 6,
        padding: "4px 8px",
        minWidth: 160,
        minHeight: 36,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 2,
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
      {/* 紐付いたKPIと到達度。
          アウトカムに指標が無いことは評価の段まで気付けなかったので、図の上で判るようにする。 */}
      {data.kpiCount === 0 ? (
        <span style={{ fontSize: 9, color: "#fbbf24", lineHeight: 1.3 }}>⚠ KPI未割当</span>
      ) : data.kpiCount != null ? (
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: "#ffffff22",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                width: `${data.rate ?? 0}%`,
                background: data.border,
              }}
            />
          </span>
          <span style={{ fontSize: 9, color: data.border, lineHeight: 1.3, whiteSpace: "nowrap" }}>
            {data.rate == null ? "—" : `${data.rate}%`} ({data.achieved ?? 0}/{data.kpiCount})
          </span>
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} style={{ background: data.border }} />
    </div>
  );
}

const nodeTypes = { colNode: ColNode };

function buildNodes(
  colData: Record<ColumnKey, LogicElement[]>,
  onEdit: (col: ColumnKey, id: string, val: string) => void,
  kpiById: Map<string, PanelKpi>,
  selectedId: string | null,
  /** 保存済みの因果。空なら隣接列の総当たりを「提案」として破線で出す */
  savedEdges: LogicEdge[],
  selectedEdgeId: string | null,
): { nodes: Node[]; flowEdges: Edge[]; isSuggestion: boolean } {
  const nodes: Node[] = [];

  COLUMNS.forEach((col, colIdx) => {
    const items = colData[col.key] ?? [];

    items.forEach((item, rowIdx) => {
      // ノードIDは要素IDそのもの。
      // 以前は `${列}-${行番号}` だったため、並べ替えや1件削除で
      // 線の宛先が別の要素にすり替わっていた。
      const id = item.id;
      const summary = summarizeElement(item, kpiById);
      nodes.push({
        id,
        type: "colNode",
        position: { x: colIdx * 220, y: rowIdx * 80 },
        data: {
          label: item.text,
          bg: col.bg,
          border: col.border,
          kpiCount: summary.total,
          rate: summary.rate,
          achieved: summary.achieved,
          selected: id === selectedId,
          onEdit: (v: string) => onEdit(col.key, id, v),
        },
      });
    });
  });

  // 因果の線。
  //   savedEdges がある  → それだけを実線で描く（担当者が描いた因果）
  //   savedEdges が空    → 隣接列の総当たりを破線で「提案」として出す
  // 提案は保存された因果ではないので、整合検査でも因果として扱わない。
  const isSuggestion = savedEdges.length === 0;
  const source = isSuggestion ? suggestAdjacentEdges(colData) : savedEdges;

  const flowEdges: Edge[] = source.map((e) => {
    const id = `${e.from}->${e.to}`;
    const selected = id === selectedEdgeId;
    const stroke = selected ? "#f472b6" : isSuggestion ? "#4b5563" : "#818cf8";
    return {
      id,
      source: e.from,
      target: e.to,
      selected,
      style: {
        stroke,
        strokeWidth: selected ? 2.5 : isSuggestion ? 1 : 1.6,
        ...(isSuggestion ? { strokeDasharray: "4 3" } : {}),
      },
      ...(e.note ? { label: e.note } : {}),
      // 提案（破線）には矢印を付けない。保存された因果と見分けが付くようにするため
      ...(isSuggestion
        ? {}
        : { markerEnd: { type: MarkerType.ArrowClosed, color: stroke } }),
    };
  });

  return { nodes, flowEdges, isSuggestion };
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

  // ビジュアルエディタ state。
  // 要素は {id, text, kpi_ids}。DBに文字列配列が残っていても
  // normalizeColumns が id を割り当てて読み込む（035 前後どちらでも動く）。
  const [colData, setColData] = useState<Record<ColumnKey, LogicElement[]>>(() =>
    normalizeColumns(latest as unknown as Record<string, unknown> | null),
  );

  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [showOutcomesModal, setShowOutcomesModal] = useState(false);
  const [currentModelId, setCurrentModelId] = useState<string | null>(latest?.id ?? null);
  const [modelStatus, setModelStatus] = useState<"draft" | "confirmed">(latest?.status ?? "draft");
  const [approving, setApproving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // 図でクリックされた要素。KPI割当パネルと同期する
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // 因果エッジ（034 の edges 列）。
  // 空のあいだは隣接列の総当たりを「提案」として破線で出す。
  const [edgeData, setEdgeData] = useState<LogicEdge[]>(() => normalizeEdges(latest?.edges));

  // 閲覧中の版。null なら現行版（編集可）
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const viewing = viewVersionId
    ? (logicModels.find((m) => m.id === viewVersionId) ?? null)
    : null;
  const readOnly = viewing !== null;

  // 課題仮説選択時に自動引き継ぎ
  useEffect(() => {
    if (!selectedHypId) return;
    const hyp = hypotheses.find((h) => h.id === selectedHypId);
    if (!hyp) return;
    if (hyp.root_cause) setChallenge(hyp.root_cause);
  }, [selectedHypId, hypotheses]);

  // 文言の編集では id を保持する。
  // id が変わると、その要素に紐付けたKPIと因果エッジの宛先が失われる。
  const handleNodeEdit = useCallback((col: ColumnKey, id: string, val: string) => {
    setColData((prev) => ({
      ...prev,
      [col]: (prev[col] ?? []).map((el) => (el.id === id ? { ...el, text: val } : el)),
    }));
  }, []);

  const handleAddItem = (col: ColumnKey) => {
    const el = { id: newElementId(), text: "新しい項目", kpi_ids: [] as string[] };
    setColData((prev) => ({ ...prev, [col]: [...(prev[col] ?? []), el] }));
    setSelectedElementId(el.id);
  };

  // 要素へのKPI割当。ここが計画（成果）と測定（指標）を結ぶ唯一の場所。
  const handleToggleKpi = (elementId: string, kpiId: string) => {
    setColData((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as ColumnKey[]) {
        next[key] = (next[key] ?? []).map((el) =>
          el.id === elementId
            ? {
                ...el,
                kpi_ids: el.kpi_ids.includes(kpiId)
                  ? el.kpi_ids.filter((k) => k !== kpiId)
                  : [...el.kpi_ids, kpiId],
              }
            : el,
        );
      }
      return next;
    });
  };

  const handleRemoveElement = (elementId: string) => {
    setColData((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as ColumnKey[]) {
        next[key] = (next[key] ?? []).filter((el) => el.id !== elementId);
      }
      return next;
    });
    // 消えた要素につながっていた因果も落とす（宙に浮いた線を残さない）
    setEdgeData((prev) => prev.filter((e) => e.from !== elementId && e.to !== elementId));
  };

  /** 列の中で要素を上下に動かす。因果の宛先は要素IDなので線は動かない */
  const handleMoveElement = (elementId: string, dir: -1 | 1) => {
    setColData((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as ColumnKey[]) {
        const arr = [...(next[key] ?? [])];
        const i = arr.findIndex((el) => el.id === elementId);
        if (i < 0) continue;
        const j = i + dir;
        if (j < 0 || j >= arr.length) return prev;
        const a = arr[i];
        const b = arr[j];
        if (!a || !b) return prev;
        arr[i] = b;
        arr[j] = a;
        next[key] = arr;
        return next;
      }
      return prev;
    });
  };

  // ── 因果エッジの編集 ────────────────────────────────
  const handleConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setEdgeData((prev) => {
      if (prev.some((e) => e.from === c.source && e.to === c.target)) return prev;
      // 提案（破線）の状態から1本引いた時点で、提案は消えて実線だけになる。
      // 引いた線だけが「担当者が描いた因果」であることを明確にするため。
      return [...prev, { from: c.source as string, to: c.target as string }];
    });
  };

  const handleDeleteEdge = (edgeId: string) => {
    const [from, to] = edgeId.split("->");
    setEdgeData((prev) => prev.filter((e) => !(e.from === from && e.to === to)));
    setSelectedEdgeId(null);
  };

  /** 隣接列の総当たり（提案）をそのまま因果として取り込む */
  const handleAdoptSuggestions = () => {
    setEdgeData(suggestAdjacentEdges(colData));
  };

  // ── 施策構築（EBPM）からの取り込み — E4 ─────────────────
  //
  // 確定済みの施策データセットを、ロジックモデルの要素として展開する:
  //   施策            → 実施活動（1施策1要素）
  //   プロセス指標    → 産出物
  //   短期KPI         → 短期アウトカム要素（kpi_ids 付き = L3の割当が済んだ状態）
  //   中間KPI         → 中間アウトカム要素（同上）
  // 要素idは施策id・KPIidから決定的に作るので、再取り込みしても重複しない
  // （文言の更新は同じ要素の上書きになり、因果の線とKPI割当が生き残る）。
  // 施策内の因果（活動→産出→短期→中間）も実線として張る。
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const handleImportMeasures = async () => {
    setImporting(true);
    setImportNote(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-design`);
      const json = (await res.json()) as {
        data:
          | {
              id: string;
              title: string;
              approach: string | null;
              status: string;
              process_indicators: { id: string; text: string }[];
              kpi_ids_initial: string[];
              kpi_ids_intermediate: string[];
            }[]
          | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setImportNote(json.error ?? "施策の取得に失敗しました");
        return;
      }
      const confirmed = json.data.filter((m) => m.status === "confirmed");
      if (confirmed.length === 0) {
        setImportNote(
          "確定済みの施策がありません。施策構築（EBPM）で施策を確定してから取り込んでください。",
        );
        return;
      }

      const upsert = (list: LogicElement[], el: LogicElement): LogicElement[] => {
        const i = list.findIndex((x) => x.id === el.id);
        if (i < 0) return [...list, el];
        // 既存要素は文言とKPIを更新（担当者が足したKPIは残す）
        const merged: LogicElement = {
          ...list[i]!,
          text: el.text,
          kpi_ids: Array.from(new Set([...(list[i]!.kpi_ids ?? []), ...el.kpi_ids])),
        };
        return list.map((x, j) => (j === i ? merged : x));
      };

      let added = 0;
      setColData((prev) => {
        const next = { ...prev };
        const newEdges: LogicEdge[] = [];
        for (const m of confirmed) {
          const actId = `md-act-${m.id}`;
          next.activities = upsert(next.activities, {
            id: actId,
            text: m.title,
            kpi_ids: [],
          });
          added++;

          const outIds: string[] = [];
          m.process_indicators.forEach((pi) => {
            const outId = `md-out-${m.id}-${pi.id}`;
            next.outputs = upsert(next.outputs, { id: outId, text: pi.text, kpi_ids: [] });
            outIds.push(outId);
          });

          const oc1Ids: string[] = [];
          for (const kid of m.kpi_ids_initial) {
            const k = kpiById.get(kid);
            const elId = `md-oc1-${kid}`;
            next.initial_outcomes = upsert(next.initial_outcomes, {
              id: elId,
              text: k ? `${k.label}の改善` : "短期アウトカム",
              kpi_ids: [kid],
            });
            oc1Ids.push(elId);
          }
          const oc2Ids: string[] = [];
          for (const kid of m.kpi_ids_intermediate) {
            const k = kpiById.get(kid);
            const elId = `md-oc2-${kid}`;
            next.intermediate_outcomes = upsert(next.intermediate_outcomes, {
              id: elId,
              text: k ? `${k.label}の改善` : "中間アウトカム",
              kpi_ids: [kid],
            });
            oc2Ids.push(elId);
          }

          // 施策内の因果: 活動 → 産出 → 短期 → 中間
          const chain = (from: string[], to: string[]) => {
            for (const f of from) for (const t of to) newEdges.push({ from: f, to: t });
          };
          if (outIds.length > 0) {
            chain([actId], outIds);
            chain(outIds, oc1Ids);
          } else {
            chain([actId], oc1Ids);
          }
          chain(oc1Ids, oc2Ids);
        }

        // エッジは既存と重複しないよう追記
        setEdgeData((prevEdges) => {
          const seen = new Set(prevEdges.map((e) => `${e.from}->${e.to}`));
          const fresh = newEdges.filter((e) => !seen.has(`${e.from}->${e.to}`));
          return [...prevEdges, ...fresh];
        });
        return next;
      });

      setImportNote(
        `確定済みの施策 ${confirmed.length} 件を取り込みました（活動${added}件）。内容を確認して「保存」を押してください。`,
      );
    } catch {
      setImportNote("通信エラーが発生しました");
    } finally {
      setImporting(false);
    }
  };

  // AI生成の結果（文字列配列）を要素に変換する。生成のたびに新しい id を振る
  const toElements = (texts: string[]): LogicElement[] =>
    texts
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t !== "")
      .map((text) => ({ id: newElementId(), text, kpi_ids: [] as string[] }));

  const kpiById = new Map(kpis.map((k) => [k.id, k]));

  // 過去の版を閲覧中はその版の中身を出す（編集はできない）
  const viewCols = viewing
    ? normalizeColumns(viewing as unknown as Record<string, unknown>)
    : colData;
  const viewEdges = viewing ? normalizeEdges(viewing.edges) : edgeData;

  const { nodes, flowEdges, isSuggestion } = buildNodes(
    viewCols,
    handleNodeEdit,
    kpiById,
    selectedElementId,
    viewEdges,
    selectedEdgeId,
  );

  // 計画（ロジックモデル）と測定（KPI）の食い違いを機械的に突き合わせる。
  // 因果が描かれていれば到達可能性で、まだなら列の順序で「筋道」を判定する。
  const findings = checkConsistency(
    viewCols,
    viewEdges,
    kpis.map((k) => ({
      id: k.id,
      label: k.label,
      indicator_type: k.indicator_type,
      contributes_to_kpi_id: k.contributes_to_kpi_id,
    })),
  );

  // 閲覧中の版と現行版の差分
  const versionDiff = viewing
    ? diffModel(
        normalizeColumns(viewing as unknown as Record<string, unknown>),
        colData,
        normalizeEdges(viewing.edges),
        edgeData,
      )
    : null;

  // 現行版をサーバから引き直す。
  // AI生成は新しい版を作るため、生成直後の currentModelId は古い版を指す。
  // そのまま保存すると PATCH が別の版（または削除済みの行）に当たっていた。
  const refetchCurrentModel = async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/logic-model`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data: { id: string; status?: "draft" | "confirmed" } | null;
      };
      const found = json.data;
      if (!found) return null;
      setCurrentModelId(found.id);
      if (found.status === "draft" || found.status === "confirmed") setModelStatus(found.status);
      return found.id;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        purpose,
        basic_goal: basicGoal,
        challenge,
        root_cause: rootCause,
        major_policy: majorPolicy,
        issue_hypothesis_id: selectedHypId || null,
        // 要素をそのまま送る。id と kpi_ids がサーバまで残る
        inputs: colData.inputs,
        activities: colData.activities,
        outputs: colData.outputs,
        initial_outcomes: colData.initial_outcomes,
        intermediate_outcomes: colData.intermediate_outcomes,
        long_outcomes: colData.long_outcomes,
        edges: edgeData,
      };

      // 対象の版を確定させてから保存する
      let targetId = currentModelId;
      if (targetId) {
        // PATCH
        let res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: targetId, ...body }),
        });

        // 手元のIDが古い（AI生成で版が進んだ等）場合は引き直して一度だけ再試行
        if (res.status === 404) {
          const fresh = await refetchCurrentModel();
          if (fresh && fresh !== targetId) {
            targetId = fresh;
            res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: targetId, ...body }),
            });
          }
        }

        if (res.ok) {
          setSavedAt(new Date().toLocaleTimeString("ja-JP"));
          router.refresh();
        } else {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          setSaveError(json?.error ?? `保存に失敗しました（HTTP ${res.status}）`);
        }
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
          setSavedAt(new Date().toLocaleTimeString("ja-JP"));
          router.refresh();
        } else {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          setSaveError(json?.error ?? `保存に失敗しました（HTTP ${res.status}）`);
        }
      }
    } catch {
      setSaveError("通信エラーが発生しました。保存されていません。");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!currentModelId) return;
    setApproving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: currentModelId, status: "confirmed" }),
      });
      if (res.ok) {
        setModelStatus("confirmed");
      } else {
        // ここは長く無音で失敗していた（DBのCHECKが 'confirmed' を許さなかった）。
        // 034 で語彙をそろえたが、失敗した場合は必ず画面に出す。
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(json?.error ?? `承認に失敗しました（HTTP ${res.status}）`);
      }
    } catch {
      setSaveError("通信エラーが発生しました。承認されていません。");
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
          kpis: kpis.map((k) => ({ label: k.label, target: k.target ?? 0, unit: k.unit })),
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

        // 層の対応をそろえる。
        // 以前は long_outcomes を中間アウトカムの欄に入れていたため、
        // 「計画期間を超えて目指す状態」が2〜5年の中間として評価されていた。
        const assign = (key: ColumnKey, texts: string[] | undefined) => {
          if (!Array.isArray(texts)) return;
          setColData((prev) => ({ ...prev, [key]: toElements(texts) }));
        };

        assign("inputs", parsed.inputs);
        assign("activities", parsed.activities);
        assign("outputs", parsed.outputs);
        assign("initial_outcomes", parsed.short_outcomes ?? parsed.initial_outcomes);
        assign("intermediate_outcomes", parsed.intermediate_outcomes);
        assign("long_outcomes", parsed.long_outcomes);

        // サーバ側は新しい版を作っている。手元のIDを追随させないと
        // 直後の保存が古い版に当たる（または 404 になる）。
        await refetchCurrentModel();
        router.refresh();

        setAiStatus("生成完了（新しい版として保存しました）");
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
    ...colData.initial_outcomes.map((o) => ({ type: "短期アウトカム（概ね1年）", label: o.text })),
    ...colData.intermediate_outcomes.map((o) => ({ type: "中間アウトカム（2〜5年）", label: o.text })),
    ...colData.long_outcomes.map((o) => ({ type: "長期アウトカム（計画期間超）", label: o.text })),
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

            <PermissionGate module="logic_model" level="edit" projectId={projectId}>
              <button
                onClick={() => void handleImportMeasures()}
                disabled={importing || readOnly}
                title="施策構築（EBPM）で確定した施策を、活動・産出・アウトカム（KPI割当済み）として展開します"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                style={{ color: "#818cf8", border: "1px solid #6366f140", background: "#6366f112" }}
              >
                {importing ? "取り込み中..." : "🔬 施策構築から取り込む"}
              </button>
            </PermissionGate>

            <button
              onClick={handleSave}
              disabled={saving || readOnly}
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

        {importNote && (
          <div
            className="mb-4 text-xs px-3 py-2 rounded-lg"
            style={{ background: "#6366f118", color: "#a5b4fc", border: "1px solid #6366f140" }}
          >
            {importNote}
          </div>
        )}

        {/* 保存の結果は必ず画面に出す。
            これまで if (res.ok) だけで else が無く、失敗が無音だった。 */}
        {saveError && (
          <div
            role="alert"
            className="mb-4 text-sm px-3 py-2 rounded-lg"
            style={{ background: "#ef444418", color: "#fca5a5", border: "1px solid #ef444440" }}
          >
            ⚠ {saveError}
          </div>
        )}
        {!saveError && savedAt && (
          <div
            className="mb-4 text-xs px-3 py-2 rounded-lg"
            style={{ background: "#10b98118", color: "#6ee7b7", border: "1px solid #10b98140" }}
          >
            ✓ {savedAt} に保存しました
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
            {/* 版の切替（034 で版を積むようにした） */}
            {logicModels.length > 1 && (
              <div
                className="rounded-xl border px-4 py-2.5 flex items-center gap-3 flex-wrap"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <span className="text-xs text-slate-400 shrink-0">表示する版</span>
                <select
                  value={viewVersionId ?? ""}
                  onChange={(e) => {
                    setViewVersionId(e.target.value || null);
                    setSelectedElementId(null);
                    setSelectedEdgeId(null);
                  }}
                  className="text-xs px-2 py-1 rounded-md outline-none"
                  style={{
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">現行版（編集中）</option>
                  {logicModels
                    .filter((m) => m.id !== currentModelId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        第{m.version}版
                        {m.generated_at
                          ? `（${new Date(m.generated_at).toLocaleDateString("ja-JP")}）`
                          : ""}
                        {m.revision_reason ? ` ${m.revision_reason}` : ""}
                      </option>
                    ))}
                </select>
                {readOnly && (
                  <>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: "#f59e0b20",
                        color: "#fbbf24",
                        border: "1px solid #f59e0b40",
                      }}
                    >
                      過去の版を閲覧中 — 編集できません
                    </span>
                    <button
                      onClick={() => setViewVersionId(null)}
                      className="text-xs transition-opacity hover:opacity-70"
                      style={{ color: "#06b6d4" }}
                    >
                      現行版に戻る
                    </button>
                  </>
                )}
              </div>
            )}

            {/* 因果エッジの状態 */}
            {!readOnly && (
              <div
                className="rounded-xl border px-4 py-2.5 flex items-center gap-3 flex-wrap"
                style={{
                  background: "var(--bg-secondary)",
                  borderColor: isSuggestion ? "#f59e0b40" : "var(--border)",
                }}
              >
                {isSuggestion ? (
                  <>
                    <span className="text-xs" style={{ color: "#fbbf24" }}>
                      ⚠ 因果はまだ描かれていません（隣接する列の総当たりを破線で仮表示中）
                    </span>
                    <span className="text-xs text-slate-500">
                      ノード右端の点から次の要素へドラッグすると線を引けます
                    </span>
                    <button
                      onClick={handleAdoptSuggestions}
                      className="text-xs px-2 py-1 rounded-md transition-opacity hover:opacity-80"
                      style={{ color: "#fbbf24", border: "1px solid #f59e0b40" }}
                    >
                      仮表示をそのまま取り込む
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-400">
                      因果 {edgeData.length} 本
                    </span>
                    {selectedEdgeId ? (
                      <>
                        <span className="text-xs" style={{ color: "#f472b6" }}>
                          線を選択中
                        </span>
                        <button
                          onClick={() => handleDeleteEdge(selectedEdgeId)}
                          className="text-xs px-2 py-1 rounded-md transition-opacity hover:opacity-80"
                          style={{ color: "#f87171", border: "1px solid #ef444440" }}
                        >
                          この線を削除
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">
                        線をクリックすると削除できます／ノード右端からドラッグで追加
                      </span>
                    )}
                    <button
                      onClick={() => setEdgeData([])}
                      className="text-xs transition-opacity hover:opacity-70 ml-auto"
                      style={{ color: "#94a3b8" }}
                    >
                      すべて消して仮表示に戻す
                    </button>
                  </>
                )}
              </div>
            )}

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
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                onNodeClick={(_e, node) => {
                  setSelectedElementId(node.id);
                  setSelectedEdgeId(null);
                }}
                onEdgeClick={(_e, edge) => {
                  if (readOnly || isSuggestion) return;
                  setSelectedEdgeId(edge.id);
                  setSelectedElementId(null);
                }}
                onConnect={readOnly ? undefined : handleConnect}
                onPaneClick={() => {
                  setSelectedElementId(null);
                  setSelectedEdgeId(null);
                }}
                nodesConnectable={!readOnly}
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
                    disabled={readOnly}
                    className="w-full text-xs py-1 rounded-md transition-colors disabled:opacity-40"
                    style={{ color: col.border, border: `1px dashed ${col.border}60` }}
                  >
                    + 追加
                  </button>
                </div>
              ))}
            </div>

            {/* KPI割当（L3）: どの成果をどの指標で測るのかを結び付ける */}
            <KpiAssignPanel
              columns={viewCols}
              kpis={kpis}
              selectedId={selectedElementId}
              onSelect={setSelectedElementId}
              onToggleKpi={handleToggleKpi}
              {...(readOnly
                ? {}
                : { onRemoveElement: handleRemoveElement, onMoveElement: handleMoveElement })}
              readOnly={readOnly}
            />

            {/* 版の差分（L4）。過去の版を選んでいるときだけ出す */}
            {versionDiff && viewing && (
              <VersionDiffPanel
                diff={versionDiff}
                beforeLabel={`第${viewing.version}版`}
                afterLabel="現行版（編集中）"
              />
            )}

            {/* 計画とKPIの整合検査（L3） */}
            <ConsistencyPanel findings={findings} onFocusElement={setSelectedElementId} />

            <p className="text-xs text-slate-600 leading-relaxed">
              {readOnly
                ? "過去の版を閲覧しています。編集するには「現行版に戻る」を押してください。"
                : "要素・KPIの割当・因果の線を変更したら「保存」を押してください。押すまでDBには反映されません。"}
            </p>
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
