"use client";

import { useEffect, useState } from "react";

// ロジックモデルを評価の「軸」として参照表示するパネル（設計 §2 / フェーズP3）。
// tier に応じてロジックモデルの該当要素を表示する:
//   - process    : 活動（activities）・産出（outputs）
//   - outcome    : 成果（initial_outcomes, intermediate_outcomes）
//   - efficiency : 投入（inputs）・成果（outcomes / intermediate_outcomes）

export type LogicModelTier = "process" | "outcome" | "efficiency";

interface LogicModelData {
  id: string;
  name: string | null;
  inputs: unknown;
  activities: unknown;
  outputs: unknown;
  outcomes: unknown;
  initial_outcomes: unknown;
  intermediate_outcomes: unknown;
}

interface Props {
  projectId: string;
  logicModelId: string | null;
  tier: LogicModelTier;
  /** 初期状態で開いておくか（デフォルト: 開） */
  defaultOpen?: boolean;
}

const cardStyle: React.CSSProperties = { background: "#161922", borderColor: "#2a2d3a" };

const TIER_DESC: Record<LogicModelTier, string> = {
  process: "プロセス評価は、ロジックモデルの「活動」「産出」が計画どおり実施されたかを評価します。",
  outcome: "アウトカム・インパクト評価は、ロジックモデルの「成果（初期・中間）」の達成状況を評価します。",
  efficiency: "効率性評価は、ロジックモデルの「投入」と「成果」の費用対効果を評価します。",
};

/** JSONB フィールドを string[] に正規化する（ベストエフォート） */
function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.trim() !== "");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const arr = obj["items"] ?? obj["list"] ?? obj["activities"] ?? obj["values"];
    if (Array.isArray(arr)) return arr.map((v) => String(v)).filter((s) => s.trim() !== "");
    // オブジェクトの値を平坦化
    return Object.values(obj)
      .flatMap((v) => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" ? [v] : []))
      .filter((s) => s.trim() !== "");
  }
  if (typeof value === "string") return value.trim() ? [value] : [];
  return [];
}

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-600">（未設定）</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-sm text-slate-300 flex gap-2">
              <span className="text-indigo-400/60 shrink-0">•</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LogicModelContext({ projectId, logicModelId, tier, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<LogicModelData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/admin/projects/${projectId}/logic-model`)
      .then((r) => r.json())
      .then((json: { data: LogicModelData | null; error: string | null }) => {
        if (!cancelled) setModel(json.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setModel(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 軸となるロジックモデルが未設定（警告表示）
  const noLogicModel = !logicModelId && !model;

  const sections: { label: string; items: string[] }[] = (() => {
    if (!model) return [];
    // 中間アウトカムが未設定なら旧 outcomes にフォールバック
    const intermediate = toStringList(model.intermediate_outcomes);
    const outcomeItems = intermediate.length > 0 ? intermediate : toStringList(model.outcomes);
    switch (tier) {
      case "process":
        return [
          { label: "活動（Activities）", items: toStringList(model.activities) },
          { label: "産出（Outputs）", items: toStringList(model.outputs) },
        ];
      case "outcome":
        return [
          { label: "初期アウトカム（Initial Outcomes）", items: toStringList(model.initial_outcomes) },
          { label: "中間アウトカム（Intermediate Outcomes）", items: outcomeItems },
        ];
      case "efficiency":
        return [
          { label: "投入（Inputs）", items: toStringList(model.inputs) },
          { label: "成果（Outcomes）", items: outcomeItems },
        ];
    }
  })();

  return (
    <div className="rounded-2xl border" style={cardStyle}>
      {/* バナー: 参照中のロジックモデル */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "#6366f120", color: "#818cf8", border: "1px solid #6366f140" }}
          >
            ロジックモデルより参照
          </span>
          {loading ? (
            <span className="text-xs text-slate-500">読み込み中...</span>
          ) : noLogicModel ? (
            <span className="text-xs text-amber-400 truncate">
              ⚠ このタブを評価する軸となるロジックモデルが設定されていません
            </span>
          ) : (
            <span className="text-sm text-slate-300 truncate">
              このロジックモデルを参照しています:{" "}
              <span className="text-slate-100 font-medium">{model?.name ?? "ロジックモデル"}</span>
            </span>
          )}
        </div>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4 border-t" style={{ borderColor: "#2a2d3a" }}>
          <p className="text-xs text-slate-500 pt-3">{TIER_DESC[tier]}</p>
          {noLogicModel ? (
            <div
              className="rounded-xl border border-dashed p-4 text-center"
              style={{ borderColor: "#f59e0b40" }}
            >
              <p className="text-xs text-amber-400">
                ロジックモデルを作成すると、その投入・活動・産出・成果を軸に評価できます。
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {sections.map((s) => (
                <Section key={s.label} label={s.label} items={s.items} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
