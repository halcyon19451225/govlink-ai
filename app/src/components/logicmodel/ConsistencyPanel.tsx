"use client";

/**
 * ロジックモデルとKPIの整合検査を表示するパネル（L3）
 *
 * 保存はブロックしない。担当者の判断が正しいことは十分にあるため、
 * ここに出るのは「誤り」ではなく「説明が必要な箇所」である。
 * 評価の妥当性を外部に問われたとき、この一覧が空であることが
 * 「計画と測定が同じことを言っている」ことの根拠になる。
 */

import { useState } from "react";
import type { ConsistencyFinding, FindingSeverity } from "@/lib/logicmodel/consistency";
import { summarizeFindings } from "@/lib/logicmodel/consistency";

const SEVERITY_STYLE: Record<FindingSeverity, { label: string; color: string; mark: string }> = {
  error: { label: "要修正", color: "#ef4444", mark: "✗" },
  warning: { label: "要確認", color: "#f59e0b", mark: "⚠" },
  info: { label: "参考", color: "#38bdf8", mark: "i" },
};

interface Props {
  findings: ConsistencyFinding[];
  /** 該当要素を図で選択させる */
  onFocusElement?: (elementId: string) => void;
}

export default function ConsistencyPanel({ findings, onFocusElement }: Props) {
  const [open, setOpen] = useState(true);
  const s = summarizeFindings(findings);

  const headline =
    s.error > 0 ? SEVERITY_STYLE.error.color : s.warning > 0 ? SEVERITY_STYLE.warning.color : "#10b981";

  return (
    <div
      className="rounded-2xl border"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full shrink-0"
            style={{ background: headline + "20", color: headline, border: `1px solid ${headline}40` }}
          >
            計画とKPIの整合
          </span>
          <span className="text-sm truncate" style={{ color: headline }}>
            {findings.length === 0 ? "食い違いは見つかりませんでした" : s.label}
          </span>
        </span>
        <span className="text-slate-500 text-xs shrink-0">{open ? "▲ 閉じる" : "▼ 開く"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
          {findings.length === 0 ? (
            <p className="text-xs text-slate-500 pt-3 leading-relaxed">
              成果と指標の層、指標どうしの寄与関係、いずれもロジックモデルと矛盾していません。
              評価の妥当性を問われた際は、この状態を根拠として示せます。
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 pt-3 leading-relaxed">
                保存は妨げません。担当者の判断が正しいこともあります。
                意図した組み合わせであれば、その理由を評価コメントに残してください。
              </p>
              {findings.map((f) => {
                const st = SEVERITY_STYLE[f.severity];
                return (
                  <div
                    key={f.key}
                    className="rounded-lg px-3 py-2"
                    style={{ background: "var(--bg-primary)", border: `1px solid ${st.color}30` }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                        style={{ background: st.color + "20", color: st.color }}
                      >
                        {st.mark} {st.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-200 leading-relaxed break-words">
                          {f.title}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed break-words">
                          {f.hint}
                        </p>
                        {onFocusElement && f.elementIds.length > 0 && (
                          <button
                            onClick={() => onFocusElement(f.elementIds[0] as string)}
                            className="text-[11px] mt-1.5 transition-opacity hover:opacity-70"
                            style={{ color: "#06b6d4" }}
                          >
                            → 該当の要素を開く
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
