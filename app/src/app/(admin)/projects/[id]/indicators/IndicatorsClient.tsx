"use client";

/**
 * 指標管理（D4）— 指標の一覧・設定・履歴の画面
 *
 * 設計: claude/coe-dataset-model.md §9。
 * 「指標を登録する → 最新値を確認する → 履歴で推移を見る」の3手で使えるようにし、
 * 迷いやすい所（4つのタイプの違い・経年比較が個票でないと出せない理由・
 * 同じ基準日で計算し直しても上書きされないこと・不足の直し方）は画面内に説明を置く
 * （文言の正本は src/content/manual/indicators.md）。
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { IndicatorListItem, IndicatorRow, IndicatorTargetRow, IndicatorValueRow } from "@/lib/indicator/service";
import type { DatasetChoice } from "./page";

type Api<T> = { data: T | null; error: string | null };

interface ProjectRow {
  id: string;
  title: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
}

const card = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };
const btnPrimary = "px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50";
const btnGhost = "px-3 py-1.5 rounded-lg text-sm border text-slate-300 hover:text-slate-100";

const CALC_LABEL: Record<string, string> = {
  manual: "手入力", aggregate: "集計型", longitudinal: "経年比較型", cross: "クロス集計型", formula: "計算式型",
};
/** タイプの説明。**登録する前にここを読めば選べる**ようにしておく */
const CALC_HELP: Record<string, { what: string; needs: string; example: string }> = {
  manual: {
    what: "人が値を入れます。計算はしません。",
    needs: "データセットは不要です。",
    example: "外部から示された値や、当面は手で集計する値に。",
  },
  aggregate: {
    what: "1つのデータセットの行を絞って集計します（合計・平均・件数・割合・値そのまま）。",
    needs: "集計データ・個票データのどちらでも使えます。",
    example: "ある区分に絞った合計や、2つの列の割り算（割合）。",
  },
  longitudinal: {
    what: "同じ人の同じ属性を2つの時点で比べ、「維持・改善」の割合を出します。",
    needs: "**個票データが必要です。** 集計データでは誰が誰か分からないため出せません。",
    example: "基準日と、その n か月前の状態を比べる。",
  },
  cross: {
    what: "複数の属性を突合し、条件をすべて満たす人を数えます。",
    needs: "**個票データが必要です。**",
    example: "ある区分かつ別の区分にも当てはまる人の割合。",
  },
  formula: {
    what: "他の指標の値から計算します（四則のみ）。",
    needs: "参照する指標の**同じ基準日の値**が先に必要です。",
    example: "{ind:指標A} / {ind:指標B} * 100",
  },
};
const VIA_LABEL: Record<string, string> = {
  ui: "画面", bulk: "一括取得", gap_analysis: "ギャップ分析", dialogue: "AI対話（担当者が承認）",
  evaluation: "評価", auto_tasks: "自動集計", migration: "移行",
};
const METHOD_LABEL: Record<string, string> = {
  sum: "合計", mean: "平均", count: "件数", rate: "割合（分子÷分母）", value: "値そのまま",
};

function fmtNum(v: string | number | null | undefined, unit?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const s = Math.abs(n) >= 1000 ? n.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) : String(Math.round(n * 1000) / 1000);
  return unit ? `${s} ${unit}` : s;
}
function fmtDate(s: string | null | undefined): string {
  return s ? s.slice(0, 10) : "—";
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface MissingItem {
  reason: string;
  message?: string;
  datasetId?: string;
  datasetName?: string;
  neededAsOf?: string;
}

export default function IndicatorsClient({
  project,
  initialIndicators,
  datasets,
}: {
  project: ProjectRow;
  initialIndicators: IndicatorListItem[];
  datasets: DatasetChoice[];
}) {
  const [indicators, setIndicators] = useState<IndicatorListItem[]>(initialIndicators);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ label: string; items: MissingItem[] } | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/admin/projects/${project.id}/indicators`);
    const json = (await res.json()) as Api<{ indicators: IndicatorListItem[] }>;
    if (json.data) setIndicators(json.data.indicators);
  }, [project.id]);

  const filtered = useMemo(() => {
    const t = q.trim();
    if (!t) return indicators;
    return indicators.filter((i) => i.label.includes(t) || (i.description ?? "").includes(t));
  }, [indicators, q]);

  const compute = useCallback(
    async (indicatorId: string, asOf: string) => {
      setBusy(indicatorId);
      setNotice(null);
      setMissing(null);
      try {
        const res = await fetch(`/api/admin/projects/${project.id}/indicators/${indicatorId}/compute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asOf }),
        });
        const json = (await res.json()) as Api<{ ok: boolean; value?: number; label?: string; missing?: MissingItem[] }>;
        if (json.error) { setNotice(json.error); return; }
        if (json.data && json.data.ok === false) {
          setMissing({ label: json.data.label ?? "", items: json.data.missing ?? [] });
          return;
        }
        setNotice(`${fmtNum(json.data?.value)} を ${asOf} 時点の値として記録しました`);
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [project.id, reload],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">指標管理</h1>
          <p className="text-sm text-slate-400 mt-1">{project.title}</p>
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setShowBulk(true)}>
            ⚡ 複数の指標の最新値を取得
          </button>
          <button className={btnPrimary} onClick={() => setShowCreate(true)}>＋ 指標を追加</button>
        </div>
      </header>

      {/* ── この画面の説明（迷わせないための常設）── */}
      <section className="rounded-xl border p-4 text-sm text-slate-300 space-y-2" style={card}>
        <p>
          <strong className="text-slate-100">指標は「どう測るか」の正本です。</strong>
          データセット管理に上げたデータを見て値を出し、その値を<strong className="text-slate-100">基準日つきの履歴</strong>として積みます。
        </p>
        <ul className="list-disc list-inside space-y-1 text-slate-400">
          <li>「最新値の確認」を押すと、その基準日<strong className="text-slate-300">以前で最も新しい版</strong>を使って計算します。使った版は履歴に残ります。</li>
          <li>
            <strong className="text-slate-300">同じ基準日で計算し直しても、前の値は消えません。</strong>
            新しい版を上げて値が変わったことを、あとから追えるようにするためです。一覧の「最新値」は、基準日が最も新しい1行です。
          </li>
          <li>データが足りないときは、<strong className="text-slate-300">どのデータセットを・いつ時点で</strong>上げればよいかを案内します。</li>
          <li>ここで登録した指標は、ギャップ分析の現状値や、施策構築の AI が参照します。</li>
        </ul>
      </section>

      {notice && (
        <div className="rounded-lg border px-4 py-3 text-sm text-emerald-300" style={{ ...card, borderColor: "#10b98155" }}>
          {notice}
        </div>
      )}
      {missing && (
        <div className="rounded-lg border px-4 py-3 text-sm space-y-2" style={{ ...card, borderColor: "#f59e0b55" }}>
          <p className="text-amber-300 font-medium">「{missing.label}」はまだ計算できません</p>
          <ul className="space-y-1">
            {missing.items.map((m, i) => (
              <li key={i} className="text-slate-300">
                ・{m.message ?? m.reason}
                {m.datasetId && (
                  <Link href={`/projects/${project.id}/datasets`} className="ml-2 text-indigo-400 hover:text-indigo-300">
                    データセット管理で上げる →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 一覧 ── */}
      <section className="rounded-xl border" style={card}>
        <div className="p-4 border-b flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <input
            className={inputClass}
            style={{ ...inputStyle, maxWidth: 320 }}
            placeholder="指標名で絞り込む"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="text-xs text-slate-500">{filtered.length} 件</span>
        </div>

        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">
            指標がまだありません。「＋ 指標を追加」から登録してください。
            まずは手入力型で名前と目標だけ決めておき、データが揃ってから計算型に変えることもできます。
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((ind) => (
              <IndicatorRowView
                key={ind.id}
                projectId={project.id}
                indicator={ind}
                busy={busy === ind.id}
                onCompute={(asOf) => compute(ind.id, asOf)}
                expanded={selected === ind.id}
                onToggle={() => setSelected(selected === ind.id ? null : ind.id)}
                onChanged={reload}
              />
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <CreateIndicatorModal
          projectId={project.id}
          datasets={datasets}
          indicators={indicators}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await reload(); }}
        />
      )}
      {showBulk && (
        <BulkComputeModal
          projectId={project.id}
          indicators={indicators}
          onClose={() => setShowBulk(false)}
          onDone={reload}
        />
      )}
    </div>
  );
}

// ── 一覧の1行 ───────────────────────────────────────────

function IndicatorRowView({
  projectId,
  indicator,
  busy,
  expanded,
  onToggle,
  onCompute,
  onChanged,
}: {
  projectId: string;
  indicator: IndicatorListItem;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCompute: (asOf: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [asOf, setAsOf] = useState(today());
  const [detail, setDetail] = useState<{ indicator: IndicatorRow; targets: IndicatorTargetRow[]; values: IndicatorValueRow[] } | null>(null);
  const [manual, setManual] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/projects/${projectId}/indicators/${indicator.id}`);
    const json = (await res.json()) as Api<{ indicator: IndicatorRow; targets: IndicatorTargetRow[]; values: IndicatorValueRow[] }>;
    if (json.data) setDetail(json.data);
  }, [projectId, indicator.id]);

  const toggle = () => {
    onToggle();
    if (!expanded && !detail) void load();
  };

  const saveManual = async () => {
    const v = Number(manual);
    if (!Number.isFinite(v)) return;
    await fetch(`/api/admin/projects/${projectId}/indicators/${indicator.id}/values`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ asOf, value: v }),
    });
    setManual("");
    await load();
    await onChanged();
  };

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <button className="text-left flex-1 min-w-0" onClick={toggle}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-100">{indicator.label}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded border text-slate-400" style={{ borderColor: "var(--border)" }}>
              {CALC_LABEL[indicator.calc_type] ?? indicator.calc_type}
            </span>
            {indicator.target_needs_review && (
              <span className="text-[11px] px-1.5 py-0.5 rounded text-amber-300" style={{ background: "#f59e0b22" }}>
                目標の見直しが必要
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-400 flex gap-4 flex-wrap">
            <span>
              最新値 <strong className="text-slate-200">{fmtNum(indicator.latest_value, indicator.unit)}</strong>
              {indicator.latest_as_of && `（${fmtDate(indicator.latest_as_of)} 時点・${VIA_LABEL[indicator.latest_via ?? ""] ?? indicator.latest_via}）`}
            </span>
            <span>目標 {fmtNum(indicator.target_value, indicator.unit)}</span>
            <span>履歴 {indicator.value_count} 件</span>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <input
            type="date"
            className="rounded-lg border px-2 py-1.5 text-xs text-slate-100"
            style={inputStyle}
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            title="いつ時点の値として記録するか"
          />
          {indicator.calc_type === "manual" ? (
            <span className="text-xs text-slate-500">手入力（開いて入力）</span>
          ) : (
            <button className={btnGhost} style={{ borderColor: "var(--border)" }} disabled={busy} onClick={() => onCompute(asOf)}>
              {busy ? "計算中…" : "最新値の確認"}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 rounded-lg border p-4 space-y-4" style={{ ...card, background: "var(--bg-input)" }}>
          {indicator.description && <p className="text-sm text-slate-300">{indicator.description}</p>}

          {indicator.calc_type === "manual" && (
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{fmtDate(asOf)} 時点の値</label>
                <input
                  className={inputClass}
                  style={{ ...inputStyle, maxWidth: 200 }}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="数値"
                />
              </div>
              <button className={btnPrimary} onClick={saveManual} disabled={manual.trim() === ""}>
                履歴に記録
              </button>
              <p className="text-xs text-slate-500 basis-full">
                手入力も計算した値と同じ履歴に積まれます。上書きはされません。
              </p>
            </div>
          )}

          <div>
            <h4 className="text-xs font-medium text-slate-400 mb-2">値の履歴</h4>
            {!detail ? (
              <p className="text-xs text-slate-500">読み込み中…</p>
            ) : detail.values.length === 0 ? (
              <p className="text-xs text-slate-500">まだ値がありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left py-1 pr-4">基準日</th>
                      <th className="text-right py-1 pr-4">値</th>
                      <th className="text-right py-1 pr-4">分子/分母</th>
                      <th className="text-left py-1 pr-4">経路</th>
                      <th className="text-left py-1">備考</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {detail.values.map((v) => (
                      <tr key={v.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="py-1 pr-4">{fmtDate(v.as_of)}</td>
                        <td className="py-1 pr-4 text-right">{fmtNum(v.value, indicator.unit)}</td>
                        <td className="py-1 pr-4 text-right text-slate-500">
                          {v.numerator !== null && v.denominator !== null ? `${fmtNum(v.numerator)} / ${fmtNum(v.denominator)}` : "—"}
                        </td>
                        <td className="py-1 pr-4">{VIA_LABEL[v.via] ?? v.via}</td>
                        <td className="py-1 text-slate-500">{v.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-500 mt-2">
                  同じ基準日の行が複数あるのは、あとから新しい版で計算し直したためです。一覧に出るのは一番新しい1行です。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 登録 ────────────────────────────────────────────────

function CreateIndicatorModal({
  projectId,
  datasets,
  indicators,
  onClose,
  onCreated,
}: {
  projectId: string;
  datasets: DatasetChoice[];
  indicators: IndicatorListItem[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");
  const [description, setDescription] = useState("");
  const [calcType, setCalcType] = useState("manual");
  const [datasetId, setDatasetId] = useState("");
  const [measure, setMeasure] = useState("");
  const [method, setMethod] = useState("sum");
  const [denominator, setDenominator] = useState("");
  const [attrKey, setAttrKey] = useState("");
  const [monthsBack, setMonthsBack] = useState(12);
  const [order, setOrder] = useState("");
  const [expression, setExpression] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dataset = datasets.find((d) => d.id === datasetId);
  const columns = useMemo(() => {
    if (!dataset) return [] as { name: string; role: string }[];
    if (dataset.kind === "individual") {
      const keys = (dataset.schema as { attr_keys?: string[] } | null)?.attr_keys ?? [];
      return keys.map((k) => ({ name: k, role: "attr" }));
    }
    return Array.isArray(dataset.schema) ? (dataset.schema as { name: string; role: string }[]) : [];
  }, [dataset]);
  const measureColumns = columns.filter((c) => c.role === "measure" || c.role === "attr");

  const help = CALC_HELP[calcType]!;
  const needsIndividual = calcType === "longitudinal" || calcType === "cross";
  const individualChosenWrong = needsIndividual && dataset != null && dataset.kind !== "individual";

  const buildSpec = (): Record<string, unknown> | undefined => {
    switch (calcType) {
      case "aggregate":
        return {
          type: "aggregate", datasetId, measure, method,
          ...(method === "rate" && denominator ? { denominator } : {}),
        };
      case "longitudinal":
        return {
          type: "longitudinal", datasetId, attrKey, monthsBack,
          order: order.split(/[,\s]+/).filter(Boolean),
          improvedWhen: "same_or_earlier",
        };
      case "cross":
        return { type: "cross", datasetId, conditions: [{ key: attrKey, in: order.split(/[,\s]+/).filter(Boolean) }], method: "count" };
      case "formula":
        return { type: "formula", expression };
      default:
        return undefined;
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/indicators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label, unit, description: description || null, calcType,
          ...(calcType !== "manual" ? { spec: buildSpec() } : {}),
          ...(targetValue.trim() !== ""
            ? { target: { scope: "plan", targetValue: Number(targetValue), achievementCondition: "gte" } }
            : {}),
        }),
      });
      const json = (await res.json()) as Api<unknown>;
      if (json.error) { setError(json.error); return; }
      await onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6" style={{ background: "#0008" }}>
      <div className="w-full max-w-2xl rounded-xl border p-6 space-y-4 my-8" style={card}>
        <h2 className="text-lg font-semibold text-slate-100">指標を追加</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-slate-400 mb-1">指標名</label>
            <input className={inputClass} style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: ○○率" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">単位</label>
            <input className={inputClass} style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="％・人・件 など" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">目標値（任意・あとからでも可）</label>
            <input className={inputClass} style={inputStyle} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-400 mb-1">説明（何を測る指標か）</label>
            <input className={inputClass} style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">どうやって値を出すか</label>
          <div className="flex gap-2 flex-wrap">
            {Object.keys(CALC_LABEL).map((t) => (
              <button
                key={t}
                className={`px-3 py-1.5 rounded-lg text-sm border ${calcType === t ? "text-white bg-indigo-600 border-indigo-500" : "text-slate-300"}`}
                style={calcType === t ? {} : { borderColor: "var(--border)" }}
                onClick={() => setCalcType(t)}
              >
                {CALC_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="mt-2 rounded-lg border p-3 text-xs text-slate-400 space-y-1" style={{ borderColor: "var(--border)" }}>
            <p className="text-slate-300">{help.what}</p>
            <p>{help.needs}</p>
            <p className="text-slate-500">{help.example}</p>
          </div>
        </div>

        {calcType !== "manual" && calcType !== "formula" && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">どのデータセットを見るか</label>
              <select className={inputClass} style={inputStyle} value={datasetId} onChange={(e) => { setDatasetId(e.target.value); setMeasure(""); setAttrKey(""); }}>
                <option value="">選んでください</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}（{d.kind === "individual" ? "個票" : "集計"}・有効な版 {d.version_count} 件{d.latest_as_of ? `・最新 ${d.latest_as_of}` : "・未登録"}）
                  </option>
                ))}
              </select>
              {datasets.length === 0 && (
                <p className="text-xs text-amber-300 mt-1">
                  データセットがまだありません。
                  <Link href={`/projects/${projectId}/datasets`} className="text-indigo-400 hover:text-indigo-300 ml-1">データセット管理で作る →</Link>
                </p>
              )}
              {individualChosenWrong && (
                <p className="text-xs text-amber-300 mt-1">
                  このタイプは個票データが必要です。集計データでは、同じ人を時点をまたいで追えないため計算できません。
                </p>
              )}
            </div>

            {calcType === "aggregate" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">集計する{dataset?.kind === "individual" ? "属性" : "列"}</label>
                  <select className={inputClass} style={inputStyle} value={measure} onChange={(e) => setMeasure(e.target.value)}>
                    <option value="">選んでください</option>
                    {measureColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">集計方法</label>
                  <select className={inputClass} style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                {method === "rate" && (
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">分母にする列</label>
                    <select className={inputClass} style={inputStyle} value={denominator} onChange={(e) => setDenominator(e.target.value)}>
                      <option value="">選んでください</option>
                      {measureColumns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {(calcType === "longitudinal" || calcType === "cross") && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">見る属性</label>
                  <select className={inputClass} style={inputStyle} value={attrKey} onChange={(e) => setAttrKey(e.target.value)}>
                    <option value="">選んでください</option>
                    {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                {calcType === "longitudinal" && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">何か月前と比べるか</label>
                    <input
                      className={inputClass} style={inputStyle} type="number" min={1} max={120}
                      value={monthsBack} onChange={(e) => setMonthsBack(Number(e.target.value))}
                    />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-xs text-slate-400 mb-1">
                    {calcType === "longitudinal" ? "値の並び（軽い→重い の順に、カンマ区切り）" : "当てはまりとみなす値（カンマ区切り）"}
                  </label>
                  <input className={inputClass} style={inputStyle} value={order} onChange={(e) => setOrder(e.target.value)} placeholder="A, B, C" />
                  {calcType === "longitudinal" && (
                    <p className="text-xs text-slate-500 mt-1">
                      この並びの上で「同じか手前」なら維持・改善として数えます。両方の時点に観測がある人だけが分母です。
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {calcType === "formula" && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">式</label>
            <input
              className={inputClass} style={inputStyle} value={expression}
              onChange={(e) => setExpression(e.target.value)}
              placeholder="{ind:…} / {ind:…} * 100"
            />
            <p className="text-xs text-slate-500 mt-1">
              使えるのは指標の参照・数値・＋ − × ÷ と括弧だけです。参照する指標の<strong>同じ基準日の値</strong>が先に必要です。
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1" style={{ borderColor: "var(--border)" }}>
              {indicators.map((i) => (
                <button
                  key={i.id}
                  className="block w-full text-left text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => setExpression((e) => `${e}{ind:${i.id}}`)}
                >
                  ＋ {i.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>キャンセル</button>
          <button className={btnPrimary} onClick={save} disabled={saving || label.trim() === ""}>
            {saving ? "登録中…" : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 一括取得 ────────────────────────────────────────────

function BulkComputeModal({
  projectId,
  indicators,
  onClose,
  onDone,
}: {
  projectId: string;
  indicators: IndicatorListItem[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const computable = indicators.filter((i) => i.calc_type !== "manual");
  const [asOf, setAsOf] = useState(today());
  const [picked, setPicked] = useState<Set<string>>(new Set(computable.map((i) => i.id)));
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ ok: boolean; label: string; value?: number; missing?: MissingItem[] }[] | null>(null);

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/indicators/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asOf, indicatorIds: Array.from(picked) }),
      });
      const json = (await res.json()) as Api<{ results: { ok: boolean; label: string; value?: number; missing?: MissingItem[] }[] }>;
      setResults(json.data?.results ?? []);
      await onDone();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6" style={{ background: "#0008" }}>
      <div className="w-full max-w-2xl rounded-xl border p-6 space-y-4 my-8" style={card}>
        <h2 className="text-lg font-semibold text-slate-100">複数の指標の最新値を取得</h2>
        <p className="text-sm text-slate-400">
          基準日を1つ決めて、選んだ指標をまとめて計算します。
          <strong className="text-slate-300">計算できた分だけ履歴に積まれます。</strong>
          足りないものは、何をいつ時点で上げればよいかを下に出します。
        </p>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">いつ時点の値として取るか</label>
            <input type="date" className={inputClass} style={{ ...inputStyle, maxWidth: 200 }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setPicked(new Set(computable.map((i) => i.id)))}>
            すべて選ぶ
          </button>
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setPicked(new Set())}>
            選択を解除
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-lg border divide-y" style={{ borderColor: "var(--border)" }}>
          {computable.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">計算できる指標がありません（手入力型のみ登録されています）。</p>
          ) : (
            computable.map((i) => (
              <label key={i.id} className="flex items-center gap-3 p-3 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="flex-1">{i.label}</span>
                <span className="text-xs text-slate-500">{CALC_LABEL[i.calc_type]}</span>
              </label>
            ))
          )}
        </div>

        {results && (
          <div className="rounded-lg border p-3 space-y-1 text-sm" style={{ borderColor: "var(--border)" }}>
            {results.map((r, i) => (
              <p key={i} className={r.ok ? "text-emerald-300" : "text-amber-300"}>
                {r.ok ? `✓ ${r.label}: ${fmtNum(r.value)}` : `⚠ ${r.label}: ${r.missing?.[0]?.message ?? "計算できません"}`}
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>閉じる</button>
          <button className={btnPrimary} onClick={run} disabled={running || picked.size === 0}>
            {running ? "取得中…" : `取得（${picked.size} 件）`}
          </button>
        </div>
      </div>
    </div>
  );
}
