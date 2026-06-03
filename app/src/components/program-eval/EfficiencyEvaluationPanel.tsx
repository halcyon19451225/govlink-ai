"use client";

import { useEffect, useMemo, useState } from "react";
import PermissionGate from "@/components/PermissionGate";
import { calcSensitivity } from "@/lib/stats/sensitivity-analysis";
import { runMonteCarloInWorker, type MonteCarloParams, type MonteCarloResult } from "@/lib/stats/monte-carlo";
import TornadoChart from "@/components/stats/TornadoChart";
import MonteCarloHistogram from "@/components/stats/MonteCarloHistogram";

// 効率性評価（第5階層）パネル（フェーズP4）。
// 旧 CostEfficiencyClient のコスト比率計算・感度分析・モンテカルロを移植し、
// 「新規効率性評価を作成」で POST /api/admin/projects/[id]/evaluations
// （evaluation_tier='efficiency'）に送信する（案B-2: cost_efficiency_records と連動）。

interface EfficiencyDetail {
  id: string;
  major_policy_name: string | null;
  evaluation_type: string;
  total_investment: number | null;
  total_reduction: number | null;
  cost_ratio: number | null;
}

interface EfficiencyEval {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  created_at: string;
  efficiency_detail?: EfficiencyDetail | null;
}

interface Props {
  projectId: string;
}

const cardStyle: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const subCardStyle: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";

function safeNum(s: string): number {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}
function safeInt(s: string): number {
  const v = parseInt(s, 10);
  return isNaN(v) ? 0 : v;
}

const EMPTY_FORM = {
  major_policy_name: "介護予防・フレイル対策事業",
  fiscal_year: String(new Date().getFullYear()),
  evaluation_type: "ex_ante" as "ex_ante" | "ex_post",
  labor_cost: "",
  operating_cost: "",
  insured_n: "",
  delta_cert_rate: "",
  unit_benefit: "",
  delta_recep_rate: "",
  recipient_count: "",
  delta_unit_benefit: "",
  evidence_basis: "",
  notes: "",
};

export default function EfficiencyEvaluationPanel({ projectId }: Props) {
  const [records, setRecords] = useState<EfficiencyEval[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 感度分析・モンテカルロ
  const [sensitivityResult, setSensitivityResult] = useState<ReturnType<typeof calcSensitivity> | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);

  // ---- 既存の効率性評価を取得 ----
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/projects/${projectId}/evaluations`)
      .then((r) => r.json())
      .then((json: { data: EfficiencyEval[] | null }) => {
        if (cancelled) return;
        const all = json.data ?? [];
        setRecords(all.filter((e) => e.evaluation_tier === "efficiency"));
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ---- リアルタイム計算 ----
  const calc = useMemo(() => {
    const labor_cost = safeNum(form.labor_cost);
    const operating_cost = safeNum(form.operating_cost);
    const total_investment = labor_cost + operating_cost;
    const insured_n = safeInt(form.insured_n);
    const delta_cert_rate = safeNum(form.delta_cert_rate);
    const unit_benefit = safeNum(form.unit_benefit);
    const delta_recep_rate = safeNum(form.delta_recep_rate);
    const recipient_count = safeInt(form.recipient_count);
    const delta_unit_benefit = safeNum(form.delta_unit_benefit);
    const reduction_a = insured_n * (Math.abs(delta_cert_rate) / 100) * unit_benefit;
    const reduction_b = recipient_count * (Math.abs(delta_recep_rate) / 100) * unit_benefit;
    const reduction_c = recipient_count * Math.abs(delta_unit_benefit);
    const total_reduction = reduction_a + reduction_b + reduction_c;
    const cost_ratio = total_reduction > 0 ? total_investment / total_reduction : 0;
    return {
      total_investment, reduction_a, reduction_b, reduction_c, total_reduction, cost_ratio,
      insured_n, delta_cert_rate, unit_benefit, delta_recep_rate, recipient_count, delta_unit_benefit,
    };
  }, [form]);

  const costRatioBadge = useMemo(() => {
    if (calc.cost_ratio === 0) return null;
    if (calc.cost_ratio < 1) return { label: "効果的", bg: "#10b98120", text: "#10b981", border: "#10b98140" };
    if (calc.cost_ratio <= 2) return { label: "普通", bg: "#f59e0b20", text: "#f59e0b", border: "#f59e0b40" };
    return { label: "要検討", bg: "#ef444420", text: "#ef4444", border: "#ef444440" };
  }, [calc.cost_ratio]);

  const setField = (field: keyof typeof form, value: string) => setForm((p) => ({ ...p, [field]: value }));

  // ---- 新規効率性評価を作成（POST /evaluations tier='efficiency'） ----
  const handleSave = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: "efficiency",
          fiscal_year: form.fiscal_year ? parseInt(form.fiscal_year, 10) : null,
          status: "draft",
          result:
            calc.cost_ratio > 0
              ? `コスト比率 ${calc.cost_ratio.toFixed(2)}（投資 ${calc.total_investment.toLocaleString()} 万円 / 削減 ${calc.total_reduction.toLocaleString(undefined, { maximumFractionDigits: 1 })} 万円）`
              : null,
          efficiency_detail: {
            major_policy_name: form.major_policy_name || null,
            evaluation_type: form.evaluation_type,
            labor_cost: safeNum(form.labor_cost) || null,
            operating_cost: safeNum(form.operating_cost) || null,
            insured_n: calc.insured_n || null,
            unit_benefit: calc.unit_benefit || null,
            delta_cert_rate: calc.delta_cert_rate || null,
            reduction_a: calc.reduction_a || null,
            delta_recep_rate: calc.delta_recep_rate || null,
            reduction_b: calc.reduction_b || null,
            recipient_count: calc.recipient_count || null,
            delta_unit_benefit: calc.delta_unit_benefit || null,
            reduction_c: calc.reduction_c || null,
            evidence_basis: form.evidence_basis || null,
            notes: form.notes || null,
          },
        }),
      });
      const json = (await res.json()) as { data: EfficiencyEval | null; error: string | null };
      if (!res.ok || json.error) {
        setFormError(json.error ?? "保存に失敗しました");
        return;
      }
      if (json.data) setRecords((prev) => [...prev, json.data!]);
      setShowModal(false);
      setForm({ ...EMPTY_FORM });
    } catch {
      setFormError("ネットワークエラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 感度分析 ----
  const handleSensitivity = () => {
    if (calc.total_investment === 0) return;
    setSensitivityResult(
      calcSensitivity({
        insured_n: calc.insured_n,
        delta_cert_rate: calc.delta_cert_rate,
        unit_benefit: calc.unit_benefit,
        delta_recep_rate: calc.delta_recep_rate,
        recipient_count: calc.recipient_count,
        delta_unit_benefit: calc.delta_unit_benefit,
        total_investment: calc.total_investment,
      }),
    );
  };

  // ---- モンテカルロ ----
  const handleMonteCarlo = () => {
    if (calc.total_investment === 0) return;
    setMcRunning(true);
    setMcError(null);
    setMcResult(null);
    const sf = 0.1;
    const params: MonteCarloParams = {
      insured_n: { mean: calc.insured_n || 1, stddev: Math.abs(calc.insured_n || 1) * sf },
      delta_cert_rate: { mean: calc.delta_cert_rate || 1, stddev: Math.abs(calc.delta_cert_rate || 1) * sf },
      unit_benefit: { mean: calc.unit_benefit || 1, stddev: Math.abs(calc.unit_benefit || 1) * sf },
      delta_recep_rate: { mean: calc.delta_recep_rate || 1, stddev: Math.abs(calc.delta_recep_rate || 1) * sf },
      recipient_count: { mean: calc.recipient_count || 1, stddev: Math.abs(calc.recipient_count || 1) * sf },
      delta_unit_benefit: { mean: calc.delta_unit_benefit || 1, stddev: Math.abs(calc.delta_unit_benefit || 1) * sf },
      total_investment: calc.total_investment,
      iterations: 10000,
    };
    runMonteCarloInWorker(
      params,
      (result) => { setMcResult(result); setMcRunning(false); },
      (err) => { setMcError(err); setMcRunning(false); },
    );
  };

  function badgeColor(ratio: number | null) {
    if (ratio == null) return "#64748b";
    if (ratio < 1) return "#10b981";
    if (ratio <= 2) return "#f59e0b";
    return "#ef4444";
  }

  return (
    <div className="space-y-6">
      {/* アクションバー */}
      <div className="flex justify-end">
        <PermissionGate module="program_evaluation" level="edit" projectId={projectId}>
          <button
            type="button"
            onClick={() => { setShowModal(true); setFormError(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: "#6366f1" }}
          >
            + 新規効率性評価を作成
          </button>
        </PermissionGate>
      </div>

      {/* 既存レコード一覧 */}
      {loading ? (
        <p className="text-sm text-slate-500">読み込み中...</p>
      ) : records.length === 0 ? (
        <div className="rounded-xl border p-10 text-center" style={cardStyle}>
          <p className="text-slate-500 text-sm mb-2">効率性評価レコードがありません</p>
          <p className="text-slate-600 text-xs">「+ 新規効率性評価を作成」からコスト比率を記録できます</p>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-input)" }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">施策名</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">年度</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">投資額</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">削減額</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">コスト比率</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => {
                const d = rec.efficiency_detail;
                return (
                  <tr key={rec.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-3 text-slate-300 max-w-xs">
                      <p className="truncate">{d?.major_policy_name ?? rec.result ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{rec.fiscal_year ? `${rec.fiscal_year}年度` : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {d?.total_investment != null ? `${d.total_investment.toLocaleString(undefined, { maximumFractionDigits: 1 })} 万` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300">
                      {d?.total_reduction != null ? `${d.total_reduction.toLocaleString(undefined, { maximumFractionDigits: 1 })} 万` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d?.cost_ratio != null ? (
                        <span className="font-mono font-bold" style={{ color: badgeColor(d.cost_ratio) }}>
                          {d.cost_ratio.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 感度分析・モンテカルロ（フォーム入力値に基づく） */}
      <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">感度分析・モンテカルロ</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              「新規効率性評価を作成」のフォームに入力したパラメータを用いて分析します
              （投資総額: <span className="font-mono text-slate-400">{calc.total_investment.toLocaleString()} 万円</span>）
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <div className="neu-button-wrap">
              <button
              type="button"
              onClick={handleSensitivity}
              disabled={calc.total_investment === 0}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              感度分析
            </button>
            </div>
            <div className="neu-button-wrap">
              <button
              type="button"
              onClick={handleMonteCarlo}
              disabled={mcRunning || calc.total_investment === 0}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              {mcRunning ? "実行中..." : "モンテカルロ"}
            </button>
            </div>
          </div>
        </div>
        {calc.total_investment === 0 && (
          <p className="text-xs text-slate-500">
            「新規効率性評価を作成」を開き、コスト・パラメータを入力してから実行してください。
          </p>
        )}
        {sensitivityResult && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              基準コスト比率: <span className="font-mono text-slate-200">{sensitivityResult.baseline_ratio.toFixed(4)}</span>
            </p>
            <TornadoChart items={sensitivityResult.items} baseline={sensitivityResult.baseline_ratio} />
          </div>
        )}
        {mcError && <p className="text-xs text-red-400">エラー: {mcError}</p>}
        {mcResult && (
          <div className="space-y-3">
            <div className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4" style={subCardStyle}>
              {[
                { label: "平均", value: mcResult.mean.toFixed(3) },
                { label: "標準偏差", value: mcResult.stddev.toFixed(3) },
                { label: "5パーセンタイル", value: mcResult.p5.toFixed(3) },
                { label: "95パーセンタイル", value: mcResult.p95.toFixed(3) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-lg font-bold font-mono text-slate-100">{value}</p>
                </div>
              ))}
            </div>
            <MonteCarloHistogram result={mcResult} />
          </div>
        )}
      </div>

      {/* ===== 新規効率性評価モーダル ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8" style={{ background: "#00000080" }}>
          <div className="rounded-xl border w-full max-w-2xl mx-4 neu-card" style={cardStyle}>
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-base font-semibold text-slate-100">新規効率性評価を作成</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-200 text-lg leading-none">×</button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* 事前/事後 */}
              <div className="flex gap-2">
                {(["ex_ante", "ex_post"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setField("evaluation_type", t)}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium"
                    style={{
                      background: form.evaluation_type === t ? "#6366f120" : "transparent",
                      color: form.evaluation_type === t ? "#818cf8" : "#64748b",
                      border: `1px solid ${form.evaluation_type === t ? "#6366f140" : "var(--border)"}`,
                    }}
                  >
                    {t === "ex_ante" ? "事前評価" : "事後評価"}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">主要施策名</label>
                  <input type="text" value={form.major_policy_name} onChange={(e) => setField("major_policy_name", e.target.value)} className={inputClass} style={subCardStyle} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
                  <input type="number" value={form.fiscal_year} onChange={(e) => setField("fiscal_year", e.target.value)} className={inputClass} style={subCardStyle} />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">投資コスト（万円）</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">人件費</label>
                    <input type="number" value={form.labor_cost} onChange={(e) => setField("labor_cost", e.target.value)} className={inputClass} style={subCardStyle} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">運営費</label>
                    <input type="number" value={form.operating_cost} onChange={(e) => setField("operating_cost", e.target.value)} className={inputClass} style={subCardStyle} placeholder="0" />
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2 text-sm" style={subCardStyle}>
                  <span className="text-slate-500 text-xs">投資総額: </span>
                  <span className="text-slate-200 font-medium">{calc.total_investment.toLocaleString()} 万円</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">認定率改善</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">第1号被保険者数（人）</label>
                    <input type="number" value={form.insured_n} onChange={(e) => setField("insured_n", e.target.value)} className={inputClass} style={subCardStyle} placeholder="例: 6085" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">認定率改善幅 (%)</label>
                    <input type="number" value={form.delta_cert_rate} onChange={(e) => setField("delta_cert_rate", e.target.value)} className={inputClass} style={subCardStyle} placeholder="例: 0.5" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 mb-1 block">1人当たり給付費（万円）</label>
                    <input type="number" value={form.unit_benefit} onChange={(e) => setField("unit_benefit", e.target.value)} className={inputClass} style={subCardStyle} placeholder="例: 16.19" />
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2 text-xs text-slate-400" style={subCardStyle}>
                  削減A = {calc.reduction_a.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">受給率改善</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">受給者数（人）</label>
                    <input type="number" value={form.recipient_count} onChange={(e) => setField("recipient_count", e.target.value)} className={inputClass} style={subCardStyle} placeholder="例: 993" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">受給率改善幅 (%)</label>
                    <input type="number" value={form.delta_recep_rate} onChange={(e) => setField("delta_recep_rate", e.target.value)} className={inputClass} style={subCardStyle} placeholder="例: 0.5" />
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2 text-xs text-slate-400" style={subCardStyle}>
                  削減B = {calc.reduction_b.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">単位給付費改善</p>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">単位給付費改善幅（万円）</label>
                  <input type="number" value={form.delta_unit_benefit} onChange={(e) => setField("delta_unit_benefit", e.target.value)} className={inputClass} style={subCardStyle} placeholder="0" />
                </div>
                <div className="rounded-lg border px-3 py-2 text-xs text-slate-400" style={subCardStyle}>
                  削減C = {calc.reduction_c.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円
                </div>
              </div>

              <div className="rounded-xl border p-4 space-y-2" style={subCardStyle}>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">合計削減額</span>
                  <span className="text-base font-bold text-slate-100">{calc.total_reduction.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円</span>
                </div>
                <div className="flex justify-between items-center border-t pt-2" style={{ borderColor: "var(--border)" }}>
                  <span className="text-sm font-medium text-slate-300">コスト比率（試算）</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold font-mono text-slate-100">{calc.cost_ratio > 0 ? calc.cost_ratio.toFixed(2) : "—"}</span>
                    {costRatioBadge && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: costRatioBadge.bg, color: costRatioBadge.text, border: `1px solid ${costRatioBadge.border}` }}>
                        {costRatioBadge.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">根拠</label>
                  <input type="text" value={form.evidence_basis} onChange={(e) => setField("evidence_basis", e.target.value)} className={inputClass} style={subCardStyle} placeholder="データ根拠" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">メモ</label>
                  <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={inputClass} style={subCardStyle} rows={2} />
                </div>
              </div>

              {formError && <p className="text-xs text-red-400">{formError}</p>}
            </div>

            <div className="flex gap-3 justify-end px-6 py-4 border-t" style={{ borderColor: "var(--border)" }}>
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200">
                キャンセル
              </button>
              <PermissionGate module="program_evaluation" level="edit" projectId={projectId}>
                <div className="neu-button-wrap">
                  <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 neu-button-primary"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                >
                  {submitting ? "保存中..." : "保存"}
                </button>
                </div>
              </PermissionGate>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
