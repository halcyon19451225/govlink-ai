"use client";

/**
 * ロジックモデルの要素にKPIを割り当てるパネル（L3）
 *
 * ── なぜこの画面が要るのか ──────────────────────────────
 * これまで「この成果はどの指標で測るのか」を書く場所がどこにも無かった。
 * 評価の段になって担当者が記憶と勘で対応付けていたため、
 *   - 同じ成果を年度ごとに違う指標で評価する
 *   - 中間アウトカムの未達を、どの短期アウトカムまで遡るべきか判らない
 * といったことが起きていた。ここで計画と測定を結び付ける。
 *
 * 到達度は src/lib/stats/achievement.ts の calcAchievement に一本化している。
 * 目標の向き（以上／以下）を見るので、下向き指標が164%と出ることはない。
 */

import { useMemo, useState } from "react";
import {
  LOGIC_COLUMNS,
  type LogicColumnKey,
  type LogicColumns,
  type LogicElement,
} from "@/lib/logicmodel/elements";
import { calcAchievement, conditionLabel, type AchievementCondition } from "@/lib/stats/achievement";
import { normalizeIndicatorType, isOutcomeTier, OUTCOME_TIER_META, formatValue } from "@/lib/outcome/tiers";

export interface PanelKpi {
  id: string;
  label: string;
  target: number | null;
  current: number | null;
  unit: string;
  baseline_value: number | null;
  achievement_condition: AchievementCondition | null;
  indicator_type: string | null;
  contributes_to_kpi_id: string | null;
}

interface Props {
  columns: LogicColumns;
  kpis: PanelKpi[];
  /** 選択中の要素id（キャンバスのクリックと同期する） */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggleKpi: (elementId: string, kpiId: string) => void;
  onRemoveElement?: (elementId: string) => void;
  /** 列の中での並べ替え。因果の宛先は要素IDなので線は動かない */
  onMoveElement?: (elementId: string, dir: -1 | 1) => void;
  readOnly?: boolean;
}

const COLUMN_META = new Map(LOGIC_COLUMNS.map((c) => [c.key, c]));

/** 要素に紐付いたKPIから到達度をまとめる */
export function summarizeElement(
  el: LogicElement,
  kpiById: Map<string, PanelKpi>,
): { rate: number | null; achieved: number; total: number } {
  const list = el.kpi_ids.map((id) => kpiById.get(id)).filter((k): k is PanelKpi => !!k);
  if (list.length === 0) return { rate: null, achieved: 0, total: 0 };

  const rates: number[] = [];
  let achieved = 0;
  for (const k of list) {
    const r = calcAchievement({
      current: k.current,
      target: k.target,
      baseline: k.baseline_value,
      condition: k.achievement_condition,
    });
    if (r.rate != null) rates.push(r.clamped);
    if (r.achieved) achieved++;
  }
  const rate =
    rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
  return { rate, achieved, total: list.length };
}

function tierBadge(indicatorType: string | null) {
  const t = normalizeIndicatorType(indicatorType);
  if (!isOutcomeTier(t)) {
    return { label: t === "efficiency" ? "効率性" : "プロセス", color: "#94a3b8" };
  }
  const m = OUTCOME_TIER_META[t];
  return { label: `${m.label}・${m.span}`, color: m.color };
}

export default function KpiAssignPanel({
  columns,
  kpis,
  selectedId,
  onSelect,
  onToggleKpi,
  onRemoveElement,
  onMoveElement,
  readOnly = false,
}: Props) {
  const [filter, setFilter] = useState("");

  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const c of LOGIC_COLUMNS) {
      const list = columns[c.key] ?? [];
      const index = list.findIndex((e) => e.id === selectedId);
      if (index >= 0) {
        return {
          el: list[index] as LogicElement,
          column: c.key as LogicColumnKey,
          index,
          count: list.length,
        };
      }
    }
    return null;
  }, [selectedId, columns]);

  const visibleKpis = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return kpis;
    return kpis.filter((k) => k.label.toLowerCase().includes(q));
  }, [kpis, filter]);

  const cardStyle: React.CSSProperties = {
    background: "var(--bg-secondary)",
    borderColor: "var(--border)",
  };

  if (!selected) {
    return (
      <div className="rounded-2xl border p-5" style={cardStyle}>
        <h3 className="text-sm font-semibold text-slate-200 mb-2">KPIの割当</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          図の中の要素をクリックすると、その成果を測るKPIをここで割り当てられます。
          <br />
          割り当てたKPIは評価工程でそのまま達成状況の判定に使われます。
        </p>
        <div className="mt-4 space-y-3">
          {LOGIC_COLUMNS.map((c) => {
            const items = columns[c.key] ?? [];
            if (items.length === 0) return null;
            return (
              <div key={c.key}>
                <p className="text-[11px] font-semibold mb-1" style={{ color: c.color }}>
                  {c.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((el) => {
                    const s = summarizeElement(el, kpiById);
                    return (
                      <button
                        key={el.id}
                        onClick={() => onSelect(el.id)}
                        className="text-xs px-2 py-1 rounded-md border transition-colors text-left"
                        style={{
                          borderColor: s.total === 0 ? "#f59e0b60" : c.color + "50",
                          background: c.color + "12",
                          color: "var(--text-primary)",
                        }}
                        title={s.total === 0 ? "KPIが未割当です" : `KPI ${s.total}件`}
                      >
                        {el.text.length > 20 ? `${el.text.slice(0, 20)}…` : el.text}
                        <span
                          className="ml-1.5"
                          style={{ color: s.total === 0 ? "#f59e0b" : c.color }}
                        >
                          {s.total === 0 ? "⚠ 未割当" : `KPI${s.total}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const col = COLUMN_META.get(selected.column);
  const summary = summarizeElement(selected.el, kpiById);

  return (
    <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold" style={{ color: col?.color }}>
            {col?.label}
          </p>
          <p className="text-sm font-medium text-slate-100 mt-0.5 break-words">
            {selected.el.text}
          </p>
        </div>
        <button
          onClick={() => onSelect(null)}
          className="text-xs text-slate-500 hover:text-slate-300 shrink-0"
        >
          閉じる
        </button>
      </div>

      {/* 到達状況 */}
      <div
        className="rounded-lg px-3 py-2"
        style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
      >
        {summary.total === 0 ? (
          <p className="text-xs" style={{ color: "#f59e0b" }}>
            ⚠ 指標が未割当です。この成果は評価の段で測れません。
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--bg-secondary)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${summary.rate ?? 0}%`,
                    background: col?.color ?? "#10b981",
                  }}
                />
              </div>
            </div>
            <span className="text-xs text-slate-300 shrink-0">
              到達度 {summary.rate == null ? "—" : `${summary.rate}%`} ／ 目標達成{" "}
              {summary.achieved}/{summary.total}
            </span>
          </div>
        )}
      </div>

      {/* KPI割当 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-slate-300">この成果を測るKPI</h4>
          {kpis.length > 6 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="指標を絞り込む"
              className="text-xs px-2 py-1 rounded-md outline-none"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
                width: 140,
              }}
            />
          )}
        </div>

        {visibleKpis.length === 0 ? (
          <p className="text-xs text-slate-500">
            {kpis.length === 0
              ? "このプロジェクトにKPIが登録されていません。先にKPIを作成してください。"
              : "該当する指標がありません。"}
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {visibleKpis.map((k) => {
              const attached = selected.el.kpi_ids.includes(k.id);
              const badge = tierBadge(k.indicator_type);
              const r = calcAchievement({
                current: k.current,
                target: k.target,
                baseline: k.baseline_value,
                condition: k.achievement_condition,
              });
              return (
                <label
                  key={k.id}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                  style={{
                    background: attached ? (col?.color ?? "#6366f1") + "18" : "transparent",
                    border: `1px solid ${attached ? (col?.color ?? "#6366f1") + "40" : "transparent"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={attached}
                    disabled={readOnly}
                    onChange={() => onToggleKpi(selected.el.id, k.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-xs text-slate-200 break-words">{k.label}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="text-[10px]" style={{ color: badge.color }}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        目標 {formatValue(k.target, k.unit)}
                        {conditionLabel(k.achievement_condition)} ／ 現在{" "}
                        {formatValue(k.current, k.unit)}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{ color: r.achieved ? "#10b981" : "#94a3b8" }}
                      >
                        {r.rate == null ? "到達度—" : `到達度 ${r.rate}%`}
                        {r.achieved ? " ✓達成" : ""}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {!readOnly && (onMoveElement || onRemoveElement) && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {onMoveElement && (
            <>
              <span className="text-[11px] text-slate-500">
                並び順 {selected.index + 1}/{selected.count}
              </span>
              <button
                onClick={() => onMoveElement(selected.el.id, -1)}
                disabled={selected.index === 0}
                className="text-xs px-2 py-1 rounded-md transition-colors disabled:opacity-30"
                style={{ color: "#94a3b8", border: "1px solid var(--border)" }}
                title="1つ上へ"
              >
                ↑ 上へ
              </button>
              <button
                onClick={() => onMoveElement(selected.el.id, 1)}
                disabled={selected.index >= selected.count - 1}
                className="text-xs px-2 py-1 rounded-md transition-colors disabled:opacity-30"
                style={{ color: "#94a3b8", border: "1px solid var(--border)" }}
                title="1つ下へ"
              >
                ↓ 下へ
              </button>
            </>
          )}
          {onRemoveElement && (
            <button
              onClick={() => {
                onRemoveElement(selected.el.id);
                onSelect(null);
              }}
              className="text-xs px-2 py-1 rounded-md transition-colors ml-auto"
              style={{ color: "#f87171", border: "1px solid #ef444440" }}
            >
              この要素を削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}
