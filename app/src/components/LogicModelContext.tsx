"use client";

import { useEffect, useState } from "react";
import { normalizeColumns, type LogicColumnKey } from "@/lib/logicmodel/elements";

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
  long_outcomes?: unknown;
}

interface Props {
  projectId: string;
  logicModelId: string | null;
  tier: LogicModelTier;
  /** 初期状態で開いておくか（デフォルト: 開） */
  defaultOpen?: boolean;
}

const cardStyle: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };

const TIER_DESC: Record<LogicModelTier, string> = {
  process: "プロセス評価は、ロジックモデルの「活動」「産出」が計画どおり実施されたかを評価します。",
  outcome: "アウトカム・インパクト評価は、ロジックモデルの「成果（初期・中間）」の達成状況を評価します。",
  efficiency: "効率性評価は、ロジックモデルの「投入」と「成果」の費用対効果を評価します。",
};

// 正規化は src/lib/logicmodel/elements.ts に集約した。
// 以前はこのファイルに独自の toStringList / pickTerm があり、
// 同じ処理が画面ごとに少しずつ違う形で重複していた。
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
    // 6列すべてを一度に正規化する。
    // 三層アウトカムが空なら旧 outcomes 列から term を見て振り分けられる。
    const cols = normalizeColumns(model as unknown as Record<string, unknown>);
    const texts = (key: LogicColumnKey) => cols[key].map((e) => e.text);

    switch (tier) {
      case "process":
        return [
          { label: "活動（Activities）", items: texts("activities") },
          { label: "産出（Outputs）", items: texts("outputs") },
        ];
      case "outcome":
        return [
          { label: "短期アウトカム（概ね1年）", items: texts("initial_outcomes") },
          { label: "中間アウトカム（2〜5年）", items: texts("intermediate_outcomes") },
          { label: "長期アウトカム（計画期間超・参考）", items: texts("long_outcomes") },
        ];
      case "efficiency":
        return [
          { label: "投入（Inputs）", items: texts("inputs") },
          {
            label: "成果（Outcomes）",
            items: [...texts("intermediate_outcomes"), ...texts("initial_outcomes")],
          },
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
        <div className="px-5 pb-5 pt-1 space-y-4 border-t" style={{ borderColor: "var(--border)" }}>
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
