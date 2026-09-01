"use client";

/**
 * 施策データセットの拡張部（migration 057）の編集画面。
 *
 * 主要施策 → 取組 → アクティビティ の二層と、
 * 別紙「プログラム評価指標一覧」17カテゴリの指標を、担当者が後から編集できる形で出す。
 *
 * 方針:
 *   - 前工程から補完できるものは Coe が入れ、「自動」の印を付ける。手で直すと印が外れる
 *   - 必須（評価フローが止まるもの）だけを赤で出し、推奨・任意は未設定でも次へ進める
 *   - 評価タイミングは計画の年次に依存しない形（頻度＋相対年次／絶対日付）で持つ
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  EVALUATION_KIND_LABEL,
  FREQUENCY_LABEL,
  FUNDING_SOURCES,
  INDICATOR_BY_NO,
  INDICATOR_CATEGORIES,
  REQUIREMENT_LABEL,
  RELATIVE_PERIOD_LABEL,
  fiscalYearLabel,
  fundingTotal,
  type FundingKey,
  type IndicatorFrequency,
  type IndicatorRequirement,
} from "@/lib/measure/indicators";
import {
  RECURRENCE_LABEL,
  type ActivityRecurrence,
  type MeasureActivity,
  type MeasureCostItem,
  type MeasureCostYear,
  type MeasureIndicatorRow,
  type MeasureWork,
} from "@/lib/measure/dataset";

interface Gaps {
  indicators: { work_id: string | null; work_label: string; missing: { no: number; name: string; reason: string }[] }[];
  activitiesWithoutDue: { id: string; title: string }[];
  fundingMismatch: number[];
  noWorks: boolean;
}

interface Dataset {
  works: MeasureWork[];
  activities: MeasureActivity[];
  indicators: MeasureIndicatorRow[];
  costYears: MeasureCostYear[];
  costItems: MeasureCostItem[];
  gaps: Gaps;
  ready: boolean;
}

const card = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputCls =
  "w-full text-xs rounded-md px-2 py-1 border bg-transparent text-slate-100 focus:outline-none";
const inputSty = { borderColor: "var(--border)", background: "var(--bg-primary)" };

function Chip({ kind, children }: { kind: IndicatorRequirement | "auto"; children: React.ReactNode }) {
  const c =
    kind === "required" ? "#fb7185" : kind === "recommended" ? "#fbbf24" : kind === "auto" ? "#22d3ee" : "#94a3b8";
  return (
    <span
      className="text-[10px] font-semibold px-1.5 rounded-full whitespace-nowrap"
      style={{ background: `${c}18`, color: c, border: `1px solid ${c}40` }}
    >
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-slate-500 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

export default function MeasureDatasetPanel({
  projectId,
  measureId,
  canEdit,
}: {
  projectId: string;
  measureId: string;
  canEdit: boolean;
}) {
  const base = `/api/admin/projects/${projectId}/measure-design/${measureId}/dataset`;
  const [ds, setDs] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const json = (await res.json()) as { data: Dataset | null; error: string | null };
      if (json.data) setDs(json.data);
      else setError(json.error ?? "読み込みに失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 変更をまとめて保存する（区画ごとの丸ごと差し替え） */
  const save = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: Dataset | null; error: string | null };
      if (json.data) {
        setDs(json.data);
        setNotice("保存しました");
      } else setError(json.error ?? "保存に失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      const json = (await res.json()) as { data: Dataset | null; error: string | null };
      if (json.data) {
        setDs(json.data);
        setNotice("前の工程から下書きを起こしました。目標値など、現場でしか決まらない項目を埋めてください");
      } else setError(json.error ?? "下書きの生成に失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const reflect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/schedule`, { method: "POST" });
      const json = (await res.json()) as {
        data: { created: number; kept: number; skipped: { title: string }[] } | null;
        error: string | null;
      };
      if (json.data) {
        const skipped = json.data.skipped.length
          ? `／期限未設定で反映しなかった項目: ${json.data.skipped.map((s) => s.title).join("、")}`
          : "";
        setNotice(
          `スケジュールに ${json.data.created} 件のタスクを反映しました` +
            (json.data.kept > 0 ? `（完了済み ${json.data.kept} 件はそのまま残しました）` : "") +
            skipped,
        );
        await load();
      } else setError(json.error ?? "反映に失敗しました");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-xs text-slate-500 px-1 py-3">読み込んでいます…</p>;
  if (!ds) return <p className="text-xs text-slate-500 px-1 py-3">{error ?? "読み込めませんでした"}</p>;

  const alive = ds.works.filter((w) => !w.retired);
  const workIndicators = (wid: string) => ds.indicators.filter((i) => i.measure_work_id === wid);
  const measureIndicators = ds.indicators.filter((i) => !i.measure_work_id);

  // 指標1件の書き換え（他はそのまま送り返す）
  const patchIndicator = (id: string, over: Partial<MeasureIndicatorRow>) => {
    const next = ds.indicators.map((i) => (i.id === id ? { ...i, ...over } : i));
    setDs({ ...ds, indicators: next });
  };
  const saveIndicators = (rows = ds.indicators) =>
    save({
      indicators: rows.map((i) => ({
        // 追加したばかりの行は id を送らない（採番はサーバー側）
        ...(i.id.startsWith("new-") ? {} : { id: i.id }),
        measure_work_id: i.measure_work_id,
        category_no: i.category_no,
        label: i.label,
        definition: i.definition,
        unit: i.unit,
        baseline_value: i.baseline_value,
        target_value: i.target_value,
        achievement_condition: i.achievement_condition,
        data_source: i.data_source,
        frequency: i.frequency,
        base_day: i.base_day,
        requirement: i.requirement,
        sort_order: i.sort_order,
        checkpoints: i.checkpoints.map((c) => ({
          label: c.label,
          relative_year: c.relative_year,
          relative_period: c.relative_period,
          absolute_date: c.absolute_date,
          evaluation_type: c.evaluation_type,
          owner_department: c.owner_department,
        })),
      })),
    });

  const addIndicator = (no: number, workId: string | null) => {
    const cat = INDICATOR_BY_NO[no]!;
    const row: MeasureIndicatorRow = {
      id: `new-${no}-${workId ?? "m"}-${Date.now()}`,
      measure_design_id: measureId,
      measure_work_id: workId,
      category_no: no,
      label: "",
      definition: cat.definition,
      unit: null,
      baseline_value: null,
      baseline_date: null,
      target_value: null,
      achievement_condition: "gte",
      data_source: cat.sourceHint,
      frequency: cat.frequency,
      base_day: null,
      kpi_id: null,
      requirement: cat.requirement,
      auto_filled: false,
      sort_order: no,
      checkpoints: [],
    };
    // 新規は id を送らない形で保存する
    const rows = [...ds.indicators, row];
    setDs({ ...ds, indicators: rows });
    void save({
      indicators: rows.map((i) => ({
        ...(i.id.startsWith("new-") ? {} : { id: i.id }),
        measure_work_id: i.measure_work_id,
        category_no: i.category_no,
        label: i.label,
        definition: i.definition,
        unit: i.unit,
        baseline_value: i.baseline_value,
        target_value: i.target_value,
        achievement_condition: i.achievement_condition,
        data_source: i.data_source,
        frequency: i.frequency,
        base_day: i.base_day,
        requirement: i.requirement,
        sort_order: i.sort_order,
        checkpoints: i.checkpoints.map((c) => ({
          label: c.label,
          relative_year: c.relative_year,
          relative_period: c.relative_period,
          absolute_date: c.absolute_date,
          evaluation_type: c.evaluation_type,
          owner_department: c.owner_department,
        })),
      })),
    });
  };

  const saveActivities = (rows: MeasureActivity[]) =>
    save({
      activities: rows.map((a) => ({
        ...(a.id.startsWith("new-") ? {} : { id: a.id }),
        measure_work_id: a.measure_work_id,
        title: a.title,
        note: a.note,
        start_date: a.start_date,
        due_date: a.due_date,
        recurrence: a.recurrence,
        occurrences: a.occurrences,
        owner_department: a.owner_department,
        document_required: a.document_required,
        document_deadline: a.document_deadline,
        document_offset_days: a.document_offset_days,
        sort_order: a.sort_order,
      })),
    });

  const saveWorks = (rows: MeasureWork[]) =>
    save({
      works: rows.map((w) => ({
        ...(w.id.startsWith("new-") ? {} : { id: w.id }),
        title: w.title,
        summary: w.summary,
        target: w.target,
        method: w.method,
        owner_department: w.owner_department,
        retired: w.retired,
        retired_reason: w.retired_reason,
        sort_order: w.sort_order,
      })),
    });

  const saveCosts = (years: MeasureCostYear[], items: MeasureCostItem[]) =>
    save({
      cost_years: years.map((y) => ({
        fiscal_year: y.fiscal_year,
        total_amount: y.total_amount,
        funding: y.funding,
        note: y.note,
      })),
      cost_items: items.map((it, i) => ({
        item: it.item,
        basis: it.basis,
        amounts: it.amounts,
        sort_order: i,
      })),
    });

  const years = ds.costYears.map((y) => y.fiscal_year);

  return (
    <div className="space-y-4">
      {/* 状態と操作 */}
      <div className="rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap" style={card}>
        <p className="text-[11px] text-slate-400 flex-1 min-w-[220px] leading-relaxed">
          取組ごとに評価（図6）、主要施策ごとに計画期間評価（図7）を回すためのデータセットです。
          <span className="text-cyan-400">自動</span>の付いた値は前の工程から Coe が入れたもので、
          手で直すと印が外れます。必須以外は未設定のままでも次の工程へ進めます。
        </p>
        {canEdit && ds.works.length === 0 && (
          <button
            onClick={() => void seed()}
            disabled={busy}
            className="text-xs px-4 py-2 rounded-lg font-medium disabled:opacity-50"
            style={{ background: "#6366f118", color: "#818cf8", border: "1px solid #6366f140" }}
          >
            前の工程から下書きを起こす
          </button>
        )}
        {canEdit && ds.activities.length > 0 && (
          <button
            onClick={() => void reflect()}
            disabled={busy}
            className="text-xs px-4 py-2 rounded-lg font-medium disabled:opacity-50"
            style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
          >
            スケジュールに反映
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#fb718510", color: "#fb7185" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#10b98110", color: "#34d399" }}>
          {notice}
        </p>
      )}

      {/* 不足 */}
      {(ds.gaps.indicators.length > 0 || ds.gaps.noWorks) && (
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: "#fb718540", background: "#fb718510" }}>
          <p className="text-[11px] font-semibold" style={{ color: "#fb7185" }}>
            評価に必要な指標が埋まっていません
          </p>
          {ds.gaps.noWorks && (
            <p className="text-[11px] text-slate-400 mt-1">取組が1件もありません。</p>
          )}
          <ul className="mt-1 space-y-0.5">
            {ds.gaps.indicators.map((g) => (
              <li key={g.work_id ?? "measure"} className="text-[11px] text-slate-400">
                {g.work_label}: {g.missing.map((m) => `${m.no} ${m.name}（${m.reason}）`).join("・")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ds.gaps.fundingMismatch.length > 0 && (
        <p className="text-[11px] px-3 py-2 rounded-lg" style={{ background: "#fbbf2410", color: "#fbbf24" }}>
          ⚠ 事業費計と財源内訳の合計が一致しない年度があります:{" "}
          {ds.gaps.fundingMismatch.map((y) => fiscalYearLabel(y)).join("、")}
        </p>
      )}

      {/* ── 取組 ───────────────────────── */}
      <section className="rounded-xl border" style={card}>
        <header className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: "var(--border)" }}>
          <h4 className="text-xs font-semibold text-slate-200">取組（図6の評価単位）</h4>
          <span className="text-[10px] text-slate-500">{alive.length}件</span>
          {canEdit && (
            <button
              onClick={() =>
                void saveWorks([
                  ...ds.works,
                  {
                    id: `new-${Date.now()}`,
                    measure_design_id: measureId,
                    code: "",
                    title: "新しい取組",
                    summary: null,
                    target: null,
                    method: null,
                    owner_department: null,
                    retired: false,
                    retired_reason: null,
                    sort_order: ds.works.length,
                  },
                ])
              }
              disabled={busy}
              className="ml-auto text-[11px] text-indigo-400 disabled:opacity-50"
            >
              ＋ 取組を追加
            </button>
          )}
        </header>

        <div className="p-4 space-y-4">
          {ds.works.map((w) => {
            const acts = ds.activities.filter((a) => a.measure_work_id === w.id);
            const inds = workIndicators(w.id);
            const used = new Set(inds.map((i) => i.category_no));
            return (
              <div
                key={w.id}
                className="rounded-lg border p-3"
                style={{ borderColor: "var(--border)", opacity: w.retired ? 0.55 : 1 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-mono text-cyan-400">{w.code}</span>
                  <input
                    className={`${inputCls} flex-1 font-semibold`}
                    style={{ ...inputSty, textDecoration: w.retired ? "line-through" : "none" }}
                    value={w.title}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setDs({
                        ...ds,
                        works: ds.works.map((x) => (x.id === w.id ? { ...x, title: e.target.value } : x)),
                      })
                    }
                    onBlur={() => void saveWorks(ds.works)}
                  />
                  {w.retired && <Chip kind="optional">取り下げ</Chip>}
                  {canEdit && !w.retired && (
                    <button
                      onClick={() =>
                        void saveWorks(ds.works.map((x) => (x.id === w.id ? { ...x, retired: true } : x)))
                      }
                      disabled={busy}
                      className="text-[10px] text-slate-500 disabled:opacity-50"
                      title="行は消さず、取り下げとして残します"
                    >
                      取り下げ
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  <Field label="対象">
                    <input
                      className={inputCls} style={inputSty} value={w.target ?? ""} disabled={!canEdit}
                      onChange={(e) => setDs({ ...ds, works: ds.works.map((x) => x.id === w.id ? { ...x, target: e.target.value } : x) })}
                      onBlur={() => void saveWorks(ds.works)}
                    />
                  </Field>
                  <Field label="実施方法">
                    <input
                      className={inputCls} style={inputSty} value={w.method ?? ""} disabled={!canEdit}
                      placeholder="直営／委託／補助"
                      onChange={(e) => setDs({ ...ds, works: ds.works.map((x) => x.id === w.id ? { ...x, method: e.target.value } : x) })}
                      onBlur={() => void saveWorks(ds.works)}
                    />
                  </Field>
                  <Field label="担当課">
                    <input
                      className={inputCls} style={inputSty} value={w.owner_department ?? ""} disabled={!canEdit}
                      onChange={(e) => setDs({ ...ds, works: ds.works.map((x) => x.id === w.id ? { ...x, owner_department: e.target.value } : x) })}
                      onBlur={() => void saveWorks(ds.works)}
                    />
                  </Field>
                </div>

                {/* アクティビティ */}
                <p className="text-[10px] text-slate-500 mb-1">
                  アクティビティ（実施項目）— スケジュール設定へ反映する単位
                </p>
                <div className="overflow-x-auto rounded-md border mb-3" style={{ borderColor: "var(--border)" }}>
                  <table className="w-full text-[11px]" style={{ minWidth: 820 }}>
                    <thead>
                      <tr className="text-slate-500">
                        <th className="text-left px-2 py-1 font-medium">実施項目</th>
                        <th className="text-left px-2 py-1 font-medium">開始</th>
                        <th className="text-left px-2 py-1 font-medium">期限</th>
                        <th className="text-left px-2 py-1 font-medium">繰り返し</th>
                        <th className="text-left px-2 py-1 font-medium">回数</th>
                        <th className="text-left px-2 py-1 font-medium">成果物</th>
                        <th className="text-left px-2 py-1 font-medium">反映</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acts.map((a) => (
                        <tr key={a.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="px-2 py-1">
                            <input className={inputCls} style={inputSty} value={a.title} disabled={!canEdit}
                              onChange={(e) => setDs({ ...ds, activities: ds.activities.map((x) => x.id === a.id ? { ...x, title: e.target.value } : x) })}
                              onBlur={() => void saveActivities(ds.activities)} />
                          </td>
                          <td className="px-2 py-1">
                            <input type="date" className={inputCls} style={inputSty} value={a.start_date ?? ""} disabled={!canEdit}
                              onChange={(e) => setDs({ ...ds, activities: ds.activities.map((x) => x.id === a.id ? { ...x, start_date: e.target.value || null } : x) })}
                              onBlur={() => void saveActivities(ds.activities)} />
                          </td>
                          <td className="px-2 py-1">
                            <input type="date" className={inputCls}
                              style={{ ...inputSty, borderColor: a.due_date ? "var(--border)" : "#fbbf2460" }}
                              value={a.due_date ?? ""} disabled={!canEdit}
                              onChange={(e) => setDs({ ...ds, activities: ds.activities.map((x) => x.id === a.id ? { ...x, due_date: e.target.value || null } : x) })}
                              onBlur={() => void saveActivities(ds.activities)} />
                          </td>
                          <td className="px-2 py-1">
                            <select className={inputCls} style={inputSty} value={a.recurrence} disabled={!canEdit}
                              onChange={(e) => {
                                const next = ds.activities.map((x) => x.id === a.id ? { ...x, recurrence: e.target.value as ActivityRecurrence } : x);
                                setDs({ ...ds, activities: next });
                                void saveActivities(next);
                              }}>
                              {Object.entries(RECURRENCE_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" min={1} max={60} className={inputCls} style={inputSty}
                              value={a.occurrences ?? ""} disabled={!canEdit || a.recurrence === "none"}
                              placeholder="期間から"
                              onChange={(e) => setDs({ ...ds, activities: ds.activities.map((x) => x.id === a.id ? { ...x, occurrences: e.target.value ? Number(e.target.value) : null } : x) })}
                              onBlur={() => void saveActivities(ds.activities)} />
                          </td>
                          <td className="px-2 py-1">
                            <label className="flex items-center gap-1 text-slate-400">
                              <input type="checkbox" checked={a.document_required} disabled={!canEdit}
                                onChange={(e) => {
                                  const next = ds.activities.map((x) => x.id === a.id ? { ...x, document_required: e.target.checked } : x);
                                  setDs({ ...ds, activities: next });
                                  void saveActivities(next);
                                }} />
                              要
                            </label>
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {a.task_count > 0 ? (
                              <span style={{ color: "#34d399" }}>{a.task_count}件</span>
                            ) : a.due_date ? (
                              <span className="text-slate-500">未反映</span>
                            ) : (
                              <span style={{ color: "#fbbf24" }}>期限未設定</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {acts.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-2 py-2 text-slate-500">
                            実施項目がありません。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <button
                    onClick={() =>
                      void saveActivities([
                        ...ds.activities,
                        {
                          id: `new-${Date.now()}`, measure_work_id: w.id, title: "新しい実施項目",
                          note: null, start_date: null, due_date: null, recurrence: "none",
                          occurrences: null, owner_department: w.owner_department,
                          document_required: false, document_deadline: null,
                          document_offset_days: null, sort_order: acts.length, task_count: 0,
                        },
                      ])
                    }
                    disabled={busy}
                    className="text-[11px] text-indigo-400 mb-3 disabled:opacity-50"
                  >
                    ＋ 実施項目を追加
                  </button>
                )}

                {/* 取組の指標 */}
                <IndicatorTable
                  rows={inds}
                  canEdit={canEdit}
                  onChange={patchIndicator}
                  onSave={() => void saveIndicators()}
                />
                {canEdit && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {INDICATOR_CATEGORIES.filter((c) => c.level === "work" && !used.has(c.no)).map((c) => (
                      <button
                        key={c.no}
                        onClick={() => addIndicator(c.no, w.id)}
                        disabled={busy}
                        className="text-[10px] px-2 py-0.5 rounded border text-slate-400 disabled:opacity-50"
                        style={{ borderColor: "var(--border)" }}
                        title={c.reason}
                      >
                        ＋ {c.no} {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {ds.works.length === 0 && (
            <p className="text-[11px] text-slate-500">
              取組がまだありません。「前の工程から下書きを起こす」を押すか、手で追加してください。
            </p>
          )}
        </div>
      </section>

      {/* ── 主要施策レベルの指標 ───────────────── */}
      <section className="rounded-xl border" style={card}>
        <header className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
          <h4 className="text-xs font-semibold text-slate-200">
            主要施策の指標（図7の評価単位）
            <span className="ml-2 text-[10px] text-slate-500 font-normal">
              指標一覧17カテゴリのうち、この層で持つもの
            </span>
          </h4>
        </header>
        <div className="p-4">
          <IndicatorTable
            rows={measureIndicators}
            canEdit={canEdit}
            onChange={patchIndicator}
            onSave={() => void saveIndicators()}
          />
          {canEdit && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {INDICATOR_CATEGORIES.filter(
                (c) => c.level === "measure" && !measureIndicators.some((i) => i.category_no === c.no),
              ).map((c) => (
                <button
                  key={c.no}
                  onClick={() => addIndicator(c.no, null)}
                  disabled={busy}
                  className="text-[10px] px-2 py-0.5 rounded border text-slate-400 disabled:opacity-50"
                  style={{ borderColor: "var(--border)" }}
                  title={c.reason}
                >
                  ＋ {c.no} {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── 年度別コストと財源 ───────────────── */}
      <section className="rounded-xl border" style={card}>
        <header className="px-4 py-2.5 flex items-center gap-2 border-b" style={{ borderColor: "var(--border)" }}>
          <h4 className="text-xs font-semibold text-slate-200">年度別の事業費と財源</h4>
          {canEdit && (
            <button
              onClick={() => {
                const next = years.length
                  ? Math.max(...years) + 1
                  : new Date().getUTCFullYear();
                void saveCosts(
                  [...ds.costYears, { id: `new-${next}`, measure_design_id: measureId, fiscal_year: next, total_amount: null, funding: {}, note: null }],
                  ds.costItems,
                );
              }}
              disabled={busy}
              className="ml-auto text-[11px] text-indigo-400 disabled:opacity-50"
            >
              ＋ 年度を追加
            </button>
          )}
        </header>
        <div className="p-4 space-y-4">
          <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-[11px]" style={{ minWidth: 840 }}>
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left px-2 py-1 font-medium">年度</th>
                  <th className="text-right px-2 py-1 font-medium">事業費計</th>
                  {FUNDING_SOURCES.map((s) => (
                    <th key={s.key} className="text-right px-2 py-1 font-medium">{s.label}</th>
                  ))}
                  <th className="text-right px-2 py-1 font-medium">内訳計</th>
                </tr>
              </thead>
              <tbody>
                {ds.costYears.map((y) => {
                  const sum = fundingTotal(y.funding);
                  const bad = (y.total_amount ?? 0) !== sum;
                  return (
                    <tr key={y.fiscal_year} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-1 text-slate-200 whitespace-nowrap">{fiscalYearLabel(y.fiscal_year)}</td>
                      <td className="px-2 py-1">
                        <input type="number" className={`${inputCls} text-right`} style={inputSty}
                          value={y.total_amount ?? ""} disabled={!canEdit}
                          onChange={(e) => setDs({ ...ds, costYears: ds.costYears.map((x) => x.fiscal_year === y.fiscal_year ? { ...x, total_amount: e.target.value ? Number(e.target.value) : null } : x) })}
                          onBlur={() => void saveCosts(ds.costYears, ds.costItems)} />
                      </td>
                      {FUNDING_SOURCES.map((s) => (
                        <td key={s.key} className="px-2 py-1">
                          <input type="number" className={`${inputCls} text-right`} style={inputSty}
                            value={y.funding[s.key as FundingKey] ?? ""} disabled={!canEdit}
                            onChange={(e) => setDs({
                              ...ds,
                              costYears: ds.costYears.map((x) => x.fiscal_year === y.fiscal_year
                                ? { ...x, funding: { ...x.funding, [s.key]: e.target.value ? Number(e.target.value) : null } }
                                : x),
                            })}
                            onBlur={() => void saveCosts(ds.costYears, ds.costItems)} />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right font-mono" style={{ color: bad ? "#fbbf24" : "#94a3b8" }}>
                        {sum.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
                {ds.costYears.length === 0 && (
                  <tr><td colSpan={7} className="px-2 py-2 text-slate-500">年度がまだありません。</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-[10px] text-slate-500 mb-1">積算内訳（費目 × 年度）</p>
            <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-[11px]" style={{ minWidth: 700 }}>
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left px-2 py-1 font-medium">費目</th>
                    {years.map((y) => (
                      <th key={y} className="text-right px-2 py-1 font-medium whitespace-nowrap">{fiscalYearLabel(y)}</th>
                    ))}
                    <th className="text-left px-2 py-1 font-medium">積算根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {ds.costItems.map((it, idx) => (
                    <tr key={it.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-1">
                        <input className={inputCls} style={inputSty} value={it.item} disabled={!canEdit}
                          onChange={(e) => setDs({ ...ds, costItems: ds.costItems.map((x, i) => i === idx ? { ...x, item: e.target.value } : x) })}
                          onBlur={() => void saveCosts(ds.costYears, ds.costItems)} />
                      </td>
                      {years.map((y) => (
                        <td key={y} className="px-2 py-1">
                          <input type="number" className={`${inputCls} text-right`} style={inputSty}
                            value={it.amounts[String(y)] ?? ""} disabled={!canEdit}
                            onChange={(e) => setDs({
                              ...ds,
                              costItems: ds.costItems.map((x, i) => i === idx
                                ? { ...x, amounts: { ...x.amounts, [String(y)]: e.target.value ? Number(e.target.value) : 0 } }
                                : x),
                            })}
                            onBlur={() => void saveCosts(ds.costYears, ds.costItems)} />
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <input className={inputCls} style={inputSty} value={it.basis ?? ""} disabled={!canEdit}
                          placeholder="単価 × 回数 × 人数"
                          onChange={(e) => setDs({ ...ds, costItems: ds.costItems.map((x, i) => i === idx ? { ...x, basis: e.target.value } : x) })}
                          onBlur={() => void saveCosts(ds.costYears, ds.costItems)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <button
                onClick={() => void saveCosts(ds.costYears, [
                  ...ds.costItems,
                  { id: `new-${Date.now()}`, measure_design_id: measureId, item: "新しい費目", basis: null, amounts: {}, sort_order: ds.costItems.length },
                ])}
                disabled={busy}
                className="text-[11px] text-indigo-400 mt-1.5 disabled:opacity-50"
              >
                ＋ 費目を追加
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** 指標の表（取組レベル・主要施策レベルの共通） */
function IndicatorTable({
  rows,
  canEdit,
  onChange,
  onSave,
}: {
  rows: MeasureIndicatorRow[];
  canEdit: boolean;
  onChange: (id: string, over: Partial<MeasureIndicatorRow>) => void;
  onSave: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="text-[11px] text-slate-500">指標がまだありません。</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
      <table className="w-full text-[11px]" style={{ minWidth: 900 }}>
        <thead>
          <tr className="text-slate-500">
            <th className="text-left px-2 py-1 font-medium w-8">No</th>
            <th className="text-left px-2 py-1 font-medium">指標</th>
            <th className="text-left px-2 py-1 font-medium w-20">単位</th>
            <th className="text-right px-2 py-1 font-medium w-24">基準値</th>
            <th className="text-right px-2 py-1 font-medium w-24">目標値</th>
            <th className="text-left px-2 py-1 font-medium w-28">測定頻度</th>
            <th className="text-left px-2 py-1 font-medium w-20">評価時点</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cat = INDICATOR_BY_NO[r.category_no];
            const open = openId === r.id;
            return (
              <Fragment key={r.id}>
                <tr className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-1.5 font-mono text-slate-500">{r.category_no}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <Chip kind={r.requirement}>{REQUIREMENT_LABEL[r.requirement]}</Chip>
                      <span className="text-slate-300 font-semibold">{cat?.name}</span>
                      {r.auto_filled && <Chip kind="auto">自動</Chip>}
                    </div>
                    <input className={inputCls} style={inputSty} value={r.label} disabled={!canEdit}
                      placeholder={cat?.definition.slice(0, 40)}
                      onChange={(e) => onChange(r.id, { label: e.target.value, auto_filled: false })}
                      onBlur={onSave} />
                    <input className={`${inputCls} mt-1 text-slate-500`} style={inputSty} value={r.data_source ?? ""}
                      disabled={!canEdit} placeholder="データソース"
                      onChange={(e) => onChange(r.id, { data_source: e.target.value, auto_filled: false })}
                      onBlur={onSave} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={inputCls} style={inputSty} value={r.unit ?? ""} disabled={!canEdit}
                      placeholder="回／%／有無"
                      onChange={(e) => onChange(r.id, { unit: e.target.value, auto_filled: false })}
                      onBlur={onSave} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" className={`${inputCls} text-right`} style={inputSty}
                      value={r.baseline_value ?? ""} disabled={!canEdit}
                      onChange={(e) => onChange(r.id, { baseline_value: e.target.value ? Number(e.target.value) : null, auto_filled: false })}
                      onBlur={onSave} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" className={`${inputCls} text-right`} style={inputSty}
                      value={r.target_value ?? ""} disabled={!canEdit}
                      onChange={(e) => onChange(r.id, { target_value: e.target.value ? Number(e.target.value) : null, auto_filled: false })}
                      onBlur={onSave} />
                    <select className={`${inputCls} mt-1`} style={inputSty} value={r.achievement_condition} disabled={!canEdit}
                      onChange={(e) => { onChange(r.id, { achievement_condition: e.target.value as MeasureIndicatorRow["achievement_condition"] }); onSave(); }}>
                      <option value="gte">以上</option>
                      <option value="lte">以下</option>
                      <option value="eq">同じ</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select className={inputCls} style={inputSty} value={r.frequency} disabled={!canEdit}
                      onChange={(e) => { onChange(r.id, { frequency: e.target.value as IndicatorFrequency }); onSave(); }}>
                      {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <input className={`${inputCls} mt-1 text-slate-500`} style={inputSty} value={r.base_day ?? ""}
                      disabled={!canEdit} placeholder="基準日（各年度3月31日 等）"
                      onChange={(e) => onChange(r.id, { base_day: e.target.value })}
                      onBlur={onSave} />
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => setOpenId(open ? null : r.id)} className="text-indigo-400 text-[11px]">
                      {r.checkpoints.length}件 {open ? "▲" : "▼"}
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr style={{ background: "var(--bg-primary)" }}>
                    <td colSpan={7} className="px-3 py-2">
                      <p className="text-[10px] text-slate-500 mb-1">
                        評価時点 — 計画開始からの相対年次と絶対日付のどちらでも指定できます。
                        年次評価を行わない計画は「計画期間ごと」だけで足ります
                      </p>
                      {r.checkpoints.map((c, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-end mb-1.5">
                          <Field label="名称">
                            <input className={inputCls} style={{ ...inputSty, width: 130 }} value={c.label} disabled={!canEdit}
                              onChange={(e) => onChange(r.id, { checkpoints: r.checkpoints.map((x, k) => k === i ? { ...x, label: e.target.value } : x) })}
                              onBlur={onSave} />
                          </Field>
                          <Field label="第N年度">
                            <input type="number" min={1} max={30} className={inputCls} style={{ ...inputSty, width: 70 }}
                              value={c.relative_year ?? ""} disabled={!canEdit}
                              onChange={(e) => onChange(r.id, { checkpoints: r.checkpoints.map((x, k) => k === i ? { ...x, relative_year: e.target.value ? Number(e.target.value) : null } : x) })}
                              onBlur={onSave} />
                          </Field>
                          <Field label="時期">
                            <select className={inputCls} style={{ ...inputSty, width: 90 }} value={c.relative_period ?? ""} disabled={!canEdit}
                              onChange={(e) => { onChange(r.id, { checkpoints: r.checkpoints.map((x, k) => k === i ? { ...x, relative_period: (e.target.value || null) as typeof x.relative_period } : x) }); onSave(); }}>
                              <option value="">—</option>
                              {Object.entries(RELATIVE_PERIOD_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="絶対日付">
                            <input type="date" className={inputCls} style={{ ...inputSty, width: 140 }} value={c.absolute_date ?? ""} disabled={!canEdit}
                              onChange={(e) => onChange(r.id, { checkpoints: r.checkpoints.map((x, k) => k === i ? { ...x, absolute_date: e.target.value || null } : x) })}
                              onBlur={onSave} />
                          </Field>
                          <Field label="評価の種類">
                            <select className={inputCls} style={{ ...inputSty, width: 150 }} value={c.evaluation_type ?? ""} disabled={!canEdit}
                              onChange={(e) => { onChange(r.id, { checkpoints: r.checkpoints.map((x, k) => k === i ? { ...x, evaluation_type: (e.target.value || null) as typeof x.evaluation_type } : x) }); onSave(); }}>
                              <option value="">—</option>
                              {Object.entries(EVALUATION_KIND_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          </Field>
                          {canEdit && (
                            <button
                              onClick={() => { onChange(r.id, { checkpoints: r.checkpoints.filter((_, k) => k !== i) }); onSave(); }}
                              className="text-[10px] text-slate-500 pb-1"
                            >
                              削除
                            </button>
                          )}
                        </div>
                      ))}
                      {canEdit && (
                        <button
                          onClick={() => {
                            onChange(r.id, {
                              checkpoints: [
                                ...r.checkpoints,
                                { id: `new-${Date.now()}`, measure_indicator_id: r.id, label: "評価", relative_year: null, relative_period: null, absolute_date: null, evaluation_type: null, owner_department: null, sort_order: r.checkpoints.length },
                              ],
                            });
                            onSave();
                          }}
                          className="text-[11px] text-indigo-400"
                        >
                          ＋ 評価時点を追加
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
