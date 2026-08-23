"use client";

/**
 * 版の差分表示（L4）
 *
 * 034 で改訂を「新しい版の追加」に変えた。版が積まれる以上、
 * 「前の版から何が変わったのか」を示せなければ版を残す意味が薄い。
 *
 * 特に、過去の評価は自分が使った版を指したままになる
 * （program_evaluations.logic_model_id）。その版と現行版の違いを見られないと、
 * 「あの評価は今の計画とは別のものを前提にしていた」という説明ができない。
 */

import { useState } from "react";
import { DIFF_STYLE, type ModelDiff } from "@/lib/logicmodel/diff";

interface Props {
  diff: ModelDiff;
  /** 比較元の見出し（例: 第2版） */
  beforeLabel: string;
  afterLabel: string;
}

export default function VersionDiffPanel({ diff, beforeLabel, afterLabel }: Props) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  return (
    <div
      className="rounded-2xl border"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "#38bdf820", color: "#38bdf8", border: "1px solid #38bdf840" }}
          >
            版の差分
          </span>
          <span className="text-sm text-slate-300 truncate">
            {beforeLabel} → {afterLabel}
          </span>
        </span>
        <span
          className="text-xs shrink-0"
          style={{ color: diff.hasChanges ? "#fbbf24" : "#10b981" }}
        >
          {diff.summary}
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        {!diff.hasChanges ? (
          <p className="text-xs text-slate-500">
            要素・KPI割当・因果のいずれにも違いはありません。
          </p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={showUnchanged}
                onChange={(e) => setShowUnchanged(e.target.checked)}
              />
              変更のない要素も表示する
            </label>

            {diff.columns.map((col) => {
              const rows = col.elements.filter(
                (e) => showUnchanged || e.status !== "unchanged",
              );
              if (rows.length === 0) return null;
              return (
                <div key={col.key}>
                  <p className="text-[11px] font-semibold mb-1.5" style={{ color: col.color }}>
                    {col.label}
                  </p>
                  <div className="space-y-1">
                    {rows.map((e, i) => {
                      const st = DIFF_STYLE[e.status];
                      return (
                        <div
                          key={`${e.after?.id ?? e.before?.id ?? i}`}
                          className="flex items-start gap-2 text-xs px-2 py-1.5 rounded-md"
                          style={{
                            background:
                              e.status === "unchanged" ? "transparent" : st.color + "12",
                            border: `1px solid ${e.status === "unchanged" ? "transparent" : st.color + "30"}`,
                          }}
                        >
                          <span
                            className="font-mono shrink-0 w-4 text-center"
                            style={{ color: st.color }}
                          >
                            {st.mark}
                          </span>
                          <span className="min-w-0 flex-1">
                            {e.status === "changed" && e.textChanged ? (
                              <>
                                <span className="text-slate-500 line-through break-words">
                                  {e.before?.text}
                                </span>
                                <span className="text-slate-500 mx-1">→</span>
                                <span className="text-slate-200 break-words">{e.after?.text}</span>
                              </>
                            ) : (
                              <span
                                className="break-words"
                                style={{
                                  color: e.status === "removed" ? "#94a3b8" : "var(--text-primary)",
                                  textDecoration:
                                    e.status === "removed" ? "line-through" : undefined,
                                }}
                              >
                                {e.text}
                              </span>
                            )}
                            {e.kpiChanged && (
                              <span className="text-[10px] ml-1.5" style={{ color: "#f59e0b" }}>
                                （KPI割当が変わりました:{" "}
                                {e.before?.kpi_ids.length ?? 0}件 → {e.after?.kpi_ids.length ?? 0}件）
                              </span>
                            )}
                            {e.status === "moved" && (
                              <span className="text-[10px] ml-1.5" style={{ color: "#38bdf8" }}>
                                （{(e.fromIndex ?? 0) + 1}番目 → {(e.toIndex ?? 0) + 1}番目）
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {(diff.edges.added.length > 0 || diff.edges.removed.length > 0) && (
              <div>
                <p className="text-[11px] font-semibold mb-1.5 text-slate-400">因果（線）</p>
                <p className="text-xs text-slate-500">
                  追加 {diff.edges.added.length} 本 ／ 削除 {diff.edges.removed.length} 本
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
