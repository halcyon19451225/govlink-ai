"use client";

/**
 * 評価予定パネル（CA2-4）— 「いつ評価を回すか」を指標の評価時点から出す。
 *
 * 取組評価・主要施策評価の各メニュー冒頭に置く。期日が来ていて未評価のものを
 * 先頭に出し、そこから評価を起動できるようにする。
 * 「2、3年目」を自前で決めず、measure_indicator_checkpoints を正本にする（設計 §4）。
 */

import { fiscalYearLabel, EVALUATION_KIND_LABEL, INDICATOR_BY_NO } from "@/lib/measure/indicators";
import { dueSummary, type DueItem } from "@/lib/evaluation/duecheck";

const STATE_META: Record<DueItem["state"], { label: string; color: string }> = {
  due: { label: "期日到来・未評価", color: "#fbbf24" },
  upcoming: { label: "予定", color: "#64748b" },
  done: { label: "評価済み", color: "#34d399" },
};

export default function DueSchedulePanel({
  items,
  level,
  onStart,
}: {
  items: DueItem[];
  /** work: 取組評価の画面 / measure: 主要施策評価の画面 */
  level: "work" | "measure";
  /** 評価を起動する（対象と年度を渡す） */
  onStart?: (item: DueItem) => void;
}) {
  const filtered = items.filter((i) =>
    level === "work" ? i.measure_work_id != null : i.measure_work_id == null,
  );
  const sum = dueSummary(filtered);

  if (filtered.length === 0) {
    return (
      <div
        className="rounded-xl border px-4 py-3"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <p className="text-xs font-semibold text-slate-300">評価予定</p>
        <p className="text-[11px] text-slate-500 mt-1">
          評価時点がまだ設定されていません。施策構築（EBPM）の指標に「評価時点」を置くと、
          期日が来たものがここに並びます（計画の年次を決め打ちしません）。
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--bg-secondary)", borderColor: sum.due > 0 ? "#f59e0b50" : "var(--border)" }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-slate-300">評価予定</p>
        <p className="text-[11px] text-slate-500">
          {sum.due > 0 && (
            <span className="font-semibold" style={{ color: "#fbbf24" }}>期日到来 {sum.due}件 ／ </span>
          )}
          予定 {sum.upcoming}件 ／ 評価済み {sum.done}件
        </p>
      </div>
      <div className="mt-2 space-y-1">
        {filtered.slice(0, 12).map((i) => {
          const meta = STATE_META[i.state];
          return (
            <div
              key={i.checkpoint_id}
              className="flex items-center gap-2 text-[11px] flex-wrap rounded-lg border px-2.5 py-1.5"
              style={{ borderColor: "var(--border)" }}
            >
              <span
                className="px-1.5 rounded-full font-semibold shrink-0"
                style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}40` }}
              >
                {meta.label}
              </span>
              <span className="text-slate-300 shrink-0">{i.label}</span>
              <span className="text-slate-500 shrink-0">
                {i.due_date ?? "期日未定"}
                {i.fiscal_year != null && `（${fiscalYearLabel(i.fiscal_year)}）`}
              </span>
              <span className="text-slate-500 truncate flex-1">
                No.{i.category_no} {INDICATOR_BY_NO[i.category_no]?.name} — {i.indicator_label}
              </span>
              {i.evaluation_type && (
                <span className="text-slate-600 shrink-0">
                  {EVALUATION_KIND_LABEL[i.evaluation_type as keyof typeof EVALUATION_KIND_LABEL] ?? i.evaluation_type}
                </span>
              )}
              {i.state !== "done" && onStart && (
                <button
                  type="button"
                  onClick={() => onStart(i)}
                  className="text-indigo-400 shrink-0"
                >
                  評価する →
                </button>
              )}
            </div>
          );
        })}
        {filtered.length > 12 && (
          <p className="text-[10px] text-slate-500">ほか {filtered.length - 12} 件</p>
        )}
      </div>
    </div>
  );
}
