"use client";

import { useState, useMemo } from "react";
import PermissionGate from "@/components/PermissionGate";
import { calcSensitivity } from "@/lib/stats/sensitivity-analysis";
import { runMonteCarloInWorker, type MonteCarloParams, type MonteCarloResult } from "@/lib/stats/monte-carlo";
import TornadoChart from "@/components/stats/TornadoChart";
import MonteCarloHistogram from "@/components/stats/MonteCarloHistogram";

// ---- 型定義 ----

interface CostEffRecord {
  id: string;
  major_policy_name: string | null;
  fiscal_year: number | null;
  evaluation_type: string;
  labor_cost: number | null;
  operating_cost: number | null;
  total_investment: number | null;
  insured_n: number | null;
  utilization_rate: number | null;
  unit_benefit: number | null;
  delta_cert_rate: number | null;
  reduction_a: number | null;
  delta_recep_rate: number | null;
  reduction_b: number | null;
  recipient_count: number | null;
  delta_unit_benefit: number | null;
  reduction_c: number | null;
  total_reduction: number | null;
  cost_ratio: number | null;
  actual_total_reduction: number | null;
  actual_cost_ratio: number | null;
  evidence_basis: string | null;
  notes: string | null;
  created_at: string;
  upstream_logic_model_prefill?: {
    id: string;
    name: string | null;
    inputs: string[];
  } | null;
}

interface EvalRef {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
}

interface Props {
  project: { id: string; title: string };
  records: CostEffRecord[];
  evaluations: EvalRef[];
}

// ---- 定数 ----

const TABS = ["評価一覧", "感度分析・モンテカルロ"] as const;
type Tab = (typeof TABS)[number];

const cardStyle: React.CSSProperties = { background: "#1a1d27", borderColor: "#2a2d3a" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle: React.CSSProperties = { background: "#161922", borderColor: "#2a2d3a" };

// ---- 計算ユーティリティ ----

function safeNum(s: string): number {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

function safeInt(s: string): number {
  const v = parseInt(s, 10);
  return isNaN(v) ? 0 : v;
}

/** ロジックモデルの inputs テキストから万円の数値を抽出（ベストエフォート） */
function extractCostsFromInputs(inputs: unknown): { labor: number | null; operating: number | null } {
  if (!Array.isArray(inputs)) return { labor: null, operating: null };
  const text = (inputs as unknown[]).join(" ");
  // 万円パターン: "予算1000万円" → 1000
  const re = /(\d+(?:\.\d+)?)\s*万[円]/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1] ?? "0");
    if (n > 0) nums.push(n);
  }
  return { labor: nums[0] ?? null, operating: nums[1] ?? null };
}

// ---- コンポーネント ----

export default function CostEfficiencyClient({ project, records: initialRecords }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(TABS[0]);
  const [records, setRecords] = useState<CostEffRecord[]>(initialRecords);

  // モーダル（editingId があれば編集モード、なければ新規作成モード）
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillHint, setPrefillHint] = useState<string[] | null>(null);

  // フォーム状態
  const [evalType, setEvalType] = useState<"ex_ante" | "ex_post">("ex_ante");
  const [form, setForm] = useState({
    major_policy_name: "介護予防・フレイル対策事業",
    fiscal_year: String(new Date().getFullYear()),
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
  });

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 感度分析
  const [sensitivityResult, setSensitivityResult] = useState<ReturnType<typeof calcSensitivity> | null>(null);

  // モンテカルロ（感度分析タブ用フォーム値を別管理）
  const [analysisForm, setAnalysisForm] = useState({
    labor_cost: "",
    operating_cost: "",
    insured_n: "",
    delta_cert_rate: "",
    unit_benefit: "",
    delta_recep_rate: "",
    recipient_count: "",
    delta_unit_benefit: "",
  });
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);

  // ---- リアルタイム計算（モーダルフォーム用） ----
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
    return { total_investment, reduction_a, reduction_b, reduction_c, total_reduction, cost_ratio, insured_n, delta_cert_rate, unit_benefit, delta_recep_rate, recipient_count, delta_unit_benefit };
  }, [form]);

  // 感度分析タブ用計算
  const analysisCalc = useMemo(() => {
    const labor_cost = safeNum(analysisForm.labor_cost);
    const operating_cost = safeNum(analysisForm.operating_cost);
    const total_investment = labor_cost + operating_cost;
    const insured_n = safeInt(analysisForm.insured_n);
    const delta_cert_rate = safeNum(analysisForm.delta_cert_rate);
    const unit_benefit = safeNum(analysisForm.unit_benefit);
    const delta_recep_rate = safeNum(analysisForm.delta_recep_rate);
    const recipient_count = safeInt(analysisForm.recipient_count);
    const delta_unit_benefit = safeNum(analysisForm.delta_unit_benefit);
    return { total_investment, insured_n, delta_cert_rate, unit_benefit, delta_recep_rate, recipient_count, delta_unit_benefit };
  }, [analysisForm]);

  const costRatioBadge = useMemo(() => {
    if (calc.cost_ratio === 0) return null;
    if (calc.cost_ratio < 1) return { label: "効果的", bg: "#10b98120", text: "#10b981", border: "#10b98140" };
    if (calc.cost_ratio <= 2) return { label: "普通", bg: "#f59e0b20", text: "#f59e0b", border: "#f59e0b40" };
    return { label: "要検討", bg: "#ef444420", text: "#ef4444", border: "#ef444440" };
  }, [calc.cost_ratio]);

  // ---- モーダルを開く + ロジックモデルプリフィル取得 ----
  const handleOpenModal = async () => {
    setShowModal(true);
    setFormError(null);
    setPrefillHint(null);

    // ロジックモデルの投入資源をプリフィル取得（R1-4）
    setPrefillLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/cost-efficiency`);
      const json = (await res.json()) as {
        data: Array<{ upstream_logic_model_prefill?: { inputs: unknown } | null }> | null;
        error: string | null;
      };
      if (res.ok && json.data) {
        // 最初に見つかったロジックモデルプリフィルを使用
        const prefill = json.data.find((r) => r.upstream_logic_model_prefill?.inputs)
          ?.upstream_logic_model_prefill;
        if (prefill?.inputs && Array.isArray(prefill.inputs)) {
          const inputTexts = prefill.inputs as string[];
          setPrefillHint(inputTexts);
          const costs = extractCostsFromInputs(inputTexts);
          if (costs.labor != null) setForm((f) => ({ ...f, labor_cost: String(costs.labor) }));
          if (costs.operating != null) setForm((f) => ({ ...f, operating_cost: String(costs.operating) }));
        }
      }
    } catch {
      // プリフィル失敗はサイレントに無視
    } finally {
      setPrefillLoading(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setFormError(null);
    setPrefillHint(null);
    setForm({
      major_policy_name: "介護予防・フレイル対策事業",
      fiscal_year: String(new Date().getFullYear()),
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
    });
    setEvalType("ex_ante");
    setEditingId(null);
  };

  // ---- 編集モーダルを開く ----
  const handleEditRecord = (rec: CostEffRecord) => {
    setEditingId(rec.id);
    setEvalType(rec.evaluation_type === "ex_post" ? "ex_post" : "ex_ante");
    setForm({
      major_policy_name: rec.major_policy_name ?? "介護予防・フレイル対策事業",
      fiscal_year: rec.fiscal_year != null ? String(rec.fiscal_year) : String(new Date().getFullYear()),
      labor_cost: rec.labor_cost != null ? String(rec.labor_cost) : "",
      operating_cost: rec.operating_cost != null ? String(rec.operating_cost) : "",
      insured_n: rec.insured_n != null ? String(rec.insured_n) : "",
      delta_cert_rate: rec.delta_cert_rate != null ? String(rec.delta_cert_rate) : "",
      unit_benefit: rec.unit_benefit != null ? String(rec.unit_benefit) : "",
      delta_recep_rate: rec.delta_recep_rate != null ? String(rec.delta_recep_rate) : "",
      recipient_count: rec.recipient_count != null ? String(rec.recipient_count) : "",
      delta_unit_benefit: rec.delta_unit_benefit != null ? String(rec.delta_unit_benefit) : "",
      evidence_basis: rec.evidence_basis ?? "",
      notes: rec.notes ?? "",
    });
    setPrefillHint(null);
    setFormError(null);
    setShowModal(true);
  };

  // ---- 保存（新規: POST / 編集: PATCH） ----
  const handleSave = async () => {
    setSubmitting(true);
    setFormError(null);
    const payload = {
      major_policy_name: form.major_policy_name || null,
      fiscal_year: form.fiscal_year ? parseInt(form.fiscal_year, 10) : null,
      evaluation_type: evalType,
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
      total_reduction: calc.total_reduction || null,
      evidence_basis: form.evidence_basis || null,
      notes: form.notes || null,
    };
    try {
      if (editingId) {
        // 編集: PATCH
        const res = await fetch(
          `/api/admin/projects/${project.id}/cost-efficiency/${editingId}`,
          { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        );
        const json = (await res.json()) as { data: CostEffRecord | null; error: string | null };
        if (!res.ok || json.error) { setFormError(json.error ?? "更新に失敗しました"); return; }
        if (json.data) setRecords((prev) => prev.map((r) => r.id === editingId ? { ...r, ...json.data! } : r));
      } else {
        // 新規: POST
        const res = await fetch(`/api/admin/projects/${project.id}/cost-efficiency`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { data: CostEffRecord | null; error: string | null };
        if (!res.ok || json.error) { setFormError(json.error ?? "保存に失敗しました"); return; }
        if (json.data) setRecords((prev) => [...prev, json.data!]);
      }
      handleCloseModal();
    } catch {
      setFormError("ネットワークエラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 感度分析実行 ----
  const handleSensitivity = () => {
    if (analysisCalc.total_investment === 0) return;
    const result = calcSensitivity({
      insured_n: analysisCalc.insured_n,
      delta_cert_rate: analysisCalc.delta_cert_rate,
      unit_benefit: analysisCalc.unit_benefit,
      delta_recep_rate: analysisCalc.delta_recep_rate,
      recipient_count: analysisCalc.recipient_count,
      delta_unit_benefit: analysisCalc.delta_unit_benefit,
      total_investment: analysisCalc.total_investment,
    });
    setSensitivityResult(result);
  };

  // ---- モンテカルロ実行 ----
  const handleMonteCarlo = () => {
    if (analysisCalc.total_investment === 0) return;
    setMcRunning(true);
    setMcError(null);
    setMcResult(null);
    const stdFactor = 0.1;
    const mcParams: MonteCarloParams = {
      insured_n: { mean: analysisCalc.insured_n || 1, stddev: Math.abs(analysisCalc.insured_n || 1) * stdFactor },
      delta_cert_rate: { mean: analysisCalc.delta_cert_rate || 1, stddev: Math.abs(analysisCalc.delta_cert_rate || 1) * stdFactor },
      unit_benefit: { mean: analysisCalc.unit_benefit || 1, stddev: Math.abs(analysisCalc.unit_benefit || 1) * stdFactor },
      delta_recep_rate: { mean: analysisCalc.delta_recep_rate || 1, stddev: Math.abs(analysisCalc.delta_recep_rate || 1) * stdFactor },
      recipient_count: { mean: analysisCalc.recipient_count || 1, stddev: Math.abs(analysisCalc.recipient_count || 1) * stdFactor },
      delta_unit_benefit: { mean: analysisCalc.delta_unit_benefit || 1, stddev: Math.abs(analysisCalc.delta_unit_benefit || 1) * stdFactor },
      total_investment: analysisCalc.total_investment,
      iterations: 10000,
    };
    runMonteCarloInWorker(mcParams, (result) => { setMcResult(result); setMcRunning(false); }, (err) => { setMcError(err); setMcRunning(false); });
  };

  const setField = (field: keyof typeof form, value: string) => setForm((p) => ({ ...p, [field]: value }));
  const setAnalysisField = (field: keyof typeof analysisForm, value: string) => setAnalysisForm((p) => ({ ...p, [field]: value }));

  // ---- ヘルパー ----
  function evalTypeLabel(t: string) {
    return t === "ex_ante" ? "事前" : t === "ex_post" ? "事後" : t;
  }

  function getCostRatioBadge(ratio: number | null) {
    if (ratio == null) return null;
    if (ratio < 1) return { label: "効果的", color: "#10b981" };
    if (ratio <= 2) return { label: "普通", color: "#f59e0b" };
    return { label: "要検討", color: "#ef4444" };
  }

  return (
    <div>
      {/* タブ */}
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: "#2a2d3a" }}>
        {TABS.map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-medium transition-colors duration-200 border-b-2 -mb-px"
            style={{ borderBottomColor: activeTab === tab ? "#6366f1" : "transparent", color: activeTab === tab ? "#818cf8" : "#64748b" }}>
            {tab}
          </button>
        ))}
      </div>

      {/* タブ1: 評価一覧 */}
      {activeTab === "評価一覧" && (
        <div className="space-y-6">
          {/* アクションバー */}
          <div className="flex justify-end">
            <PermissionGate module="cost_efficiency" level="edit" projectId={project.id}>
              <button
                type="button"
                onClick={() => void handleOpenModal()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: "#6366f1" }}
              >
                + 新規評価を作成
              </button>
            </PermissionGate>
          </div>

          {/* 評価レコード一覧 */}
          {records.length === 0 ? (
            <div className="rounded-xl border p-12 text-center" style={cardStyle}>
              <p className="text-slate-500 text-sm mb-3">評価レコードがありません</p>
              <p className="text-slate-600 text-xs">「+ 新規評価を作成」から事前・事後評価を記録できます</p>
            </div>
          ) : (
            <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
              <div className="px-5 py-3 border-b" style={{ borderColor: "#2a2d3a" }}>
                <h3 className="text-sm font-semibold text-slate-200">保存済みレコード</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a2d3a", background: "#161922" }}>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">施策名</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">年度</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">区分</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">投資額</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">削減額</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-500">コスト比率</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => {
                    const badge = getCostRatioBadge(rec.cost_ratio);
                    return (
                      <tr
                        key={rec.id}
                        style={{ borderBottom: "1px solid #2a2d3a", cursor: "pointer" }}
                        className="hover:bg-white/[0.03] transition-colors"
                        onClick={() => handleEditRecord(rec)}
                      >
                        <td className="px-4 py-3 text-slate-300 max-w-xs"><p className="truncate">{rec.major_policy_name ?? "—"}</p></td>
                        <td className="px-4 py-3 text-slate-400">{rec.fiscal_year ? `${rec.fiscal_year}年度` : "—"}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: rec.evaluation_type === "ex_ante" ? "#6366f115" : "#10b98115", color: rec.evaluation_type === "ex_ante" ? "#818cf8" : "#10b981" }}>
                            {evalTypeLabel(rec.evaluation_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-300">
                          {rec.total_investment != null ? `${rec.total_investment.toLocaleString(undefined, { maximumFractionDigits: 1 })} 万` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-300">
                          {rec.total_reduction != null ? `${rec.total_reduction.toLocaleString(undefined, { maximumFractionDigits: 1 })} 万` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {rec.cost_ratio != null ? (
                            <span className="font-mono font-bold" style={{ color: badge?.color }}>{rec.cost_ratio.toFixed(2)}</span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => { e.stopPropagation(); handleEditRecord(rec); }}>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded-md transition-colors"
                            style={{ background: "#6366f118", color: "#818cf8", border: "1px solid #6366f130" }}
                          >
                            編集
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* タブ2: 感度分析・モンテカルロ */}
      {activeTab === "感度分析・モンテカルロ" && (
        <div className="space-y-8">
          {/* パラメータ入力（感度分析用） */}
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            <h3 className="text-sm font-semibold text-slate-200">分析パラメータ入力</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { key: "labor_cost" as const, label: "人件費（万円）" },
                { key: "operating_cost" as const, label: "運営費（万円）" },
                { key: "insured_n" as const, label: "被保険者数" },
                { key: "delta_cert_rate" as const, label: "認定率改善（%）" },
                { key: "unit_benefit" as const, label: "1人当たり給付費（万円）" },
                { key: "delta_recep_rate" as const, label: "受給率改善（%）" },
                { key: "recipient_count" as const, label: "受給者数" },
                { key: "delta_unit_benefit" as const, label: "給付費単価改善（万円）" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                  <input type="number" value={analysisForm[key]} onChange={(e) => setAnalysisField(key, e.target.value)} className={inputClass} style={inputStyle} placeholder="0" />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600">投資総額: <span className="font-mono text-slate-400">{analysisCalc.total_investment.toLocaleString()} 万円</span></p>
          </div>

          {/* 感度分析 */}
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">感度分析（トルネードチャート）</h3>
                <p className="text-xs text-slate-500 mt-0.5">各パラメータを ±10% 変化させたときのコスト比率の変動を可視化します</p>
              </div>
              <button type="button" onClick={handleSensitivity} disabled={analysisCalc.total_investment === 0}
                className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 shrink-0"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
                感度分析を実行
              </button>
            </div>
            {analysisCalc.total_investment === 0 && <p className="text-xs text-slate-500">上の入力フォームにパラメータを入力してから実行してください。</p>}
            {sensitivityResult && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">基準コスト比率: <span className="font-mono text-slate-200">{sensitivityResult.baseline_ratio.toFixed(4)}</span></p>
                <TornadoChart items={sensitivityResult.items} baseline={sensitivityResult.baseline_ratio} />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #2a2d3a" }}>
                        <th className="text-left py-2 px-2 text-slate-500">パラメータ</th>
                        <th className="text-right py-2 px-2 text-slate-500">-20%</th>
                        <th className="text-right py-2 px-2 text-slate-500">-10%</th>
                        <th className="text-right py-2 px-2 text-slate-500">基準</th>
                        <th className="text-right py-2 px-2 text-slate-500">+10%</th>
                        <th className="text-right py-2 px-2 text-slate-500">+20%</th>
                        <th className="text-right py-2 px-2 text-slate-500">影響度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sensitivityResult.items.map((item) => (
                        <tr key={item.param} style={{ borderBottom: "1px solid #2a2d3a22" }}>
                          <td className="py-2 px-2 text-slate-300">{item.label}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-400">{item.low20pct.toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-300">{item.low10pct.toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-mono text-slate-400">{sensitivityResult.baseline_ratio.toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-mono text-green-300">{item.high10pct.toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-mono text-green-400">{item.high20pct.toFixed(4)}</td>
                          <td className="py-2 px-2 text-right font-mono text-amber-400">{item.impact.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* モンテカルロ */}
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">モンテカルロシミュレーション（10,000回）</h3>
                <p className="text-xs text-slate-500 mt-0.5">各パラメータにガウス分布（平均±10%の標準偏差）を仮定してシミュレーションします</p>
              </div>
              <button type="button" onClick={handleMonteCarlo} disabled={mcRunning || analysisCalc.total_investment === 0}
                className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 shrink-0"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
                {mcRunning ? "実行中..." : "シミュレーション開始"}
              </button>
            </div>
            {analysisCalc.total_investment === 0 && <p className="text-xs text-slate-500">上の入力フォームにパラメータを入力してから実行してください。</p>}
            {mcRunning && (
              <div className="flex items-center gap-3 py-4">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#6366f160", borderTopColor: "transparent" }} />
                <span className="text-sm text-slate-400">シミュレーション実行中...</span>
              </div>
            )}
            {mcError && <p className="text-xs text-red-400">エラー: {mcError}</p>}
            {mcResult && (
              <div className="space-y-4">
                <div className="rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-4" style={{ borderColor: "#2a2d3a", background: "#161922" }}>
                  {[{ label: "平均", value: mcResult.mean.toFixed(3) }, { label: "標準偏差", value: mcResult.stddev.toFixed(3) }, { label: "5パーセンタイル", value: mcResult.p5.toFixed(3) }, { label: "95パーセンタイル", value: mcResult.p95.toFixed(3) }].map(({ label, value }) => (
                    <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="text-lg font-bold font-mono text-slate-100">{value}</p></div>
                  ))}
                </div>
                <div className="rounded-xl border p-3" style={{ borderColor: "#6366f140", background: "#6366f108" }}>
                  <p className="text-xs text-slate-400">90%信頼区間: <span className="font-mono text-indigo-300">{mcResult.p5.toFixed(3)}</span>{" 〜 "}<span className="font-mono text-indigo-300">{mcResult.p95.toFixed(3)}</span></p>
                </div>
                <MonteCarloHistogram result={mcResult} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 新規評価作成モーダル ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8" style={{ background: "#00000080" }}>
          <div className="rounded-xl border w-full max-w-2xl mx-4" style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}>
            {/* モーダルヘッダー */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#2a2d3a" }}>
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  {editingId ? "評価を編集" : "新規評価を作成"}
                </h2>
                {prefillLoading && <p className="text-xs text-indigo-400 mt-0.5">ロジックモデルを参照中...</p>}
                {!prefillLoading && prefillHint && (
                  <p className="text-xs text-indigo-400 mt-0.5">
                    💡 ロジックモデルの投入資源を参照しました: {prefillHint.slice(0, 2).join("、")}
                    {prefillHint.length > 2 && "…"}
                  </p>
                )}
              </div>
              <button type="button" onClick={handleCloseModal} className="text-slate-400 hover:text-slate-200 text-lg leading-none">×</button>
            </div>

            {/* モーダルボディ */}
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* 事前/事後タブ */}
              <div className="flex gap-2">
                {(["ex_ante", "ex_post"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setEvalType(t)}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors duration-200"
                    style={{ background: evalType === t ? "#6366f120" : "transparent", color: evalType === t ? "#818cf8" : "#64748b", border: `1px solid ${evalType === t ? "#6366f140" : "#2a2d3a"}` }}>
                    {t === "ex_ante" ? "事前評価" : "事後評価"}
                  </button>
                ))}
              </div>

              {/* 基本情報 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">主要施策名</label>
                  <input type="text" value={form.major_policy_name} onChange={(e) => setField("major_policy_name", e.target.value)} className={inputClass} style={inputStyle} placeholder="例: 自立支援・重度化防止事業" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
                  <input type="number" value={form.fiscal_year} onChange={(e) => setField("fiscal_year", e.target.value)} className={inputClass} style={inputStyle} />
                </div>
              </div>

              {/* 投資コスト */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">投資コスト（万円）</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">人件費</label>
                    <input type="number" value={form.labor_cost} onChange={(e) => setField("labor_cost", e.target.value)} className={inputClass} style={inputStyle} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">運営費</label>
                    <input type="number" value={form.operating_cost} onChange={(e) => setField("operating_cost", e.target.value)} className={inputClass} style={inputStyle} placeholder="0" />
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "#161922", borderColor: "#2a2d3a" }}>
                  <span className="text-slate-500 text-xs">投資総額: </span>
                  <span className="text-slate-200 font-medium">{calc.total_investment.toLocaleString()} 万円</span>
                </div>
              </div>

              {/* 認定率改善 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">認定率改善</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">第1号被保険者数（人）</label>
                    <input type="number" value={form.insured_n} onChange={(e) => setField("insured_n", e.target.value)} className={inputClass} style={inputStyle} placeholder="例: 6085" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">認定率改善幅 (%)</label>
                    <input type="number" value={form.delta_cert_rate} onChange={(e) => setField("delta_cert_rate", e.target.value)} className={inputClass} style={inputStyle} placeholder="例: 0.5" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 mb-1 block">1人当たり給付費（万円）</label>
                    <input type="number" value={form.unit_benefit} onChange={(e) => setField("unit_benefit", e.target.value)} className={inputClass} style={inputStyle} placeholder="例: 16.19" />
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2 text-xs text-slate-400" style={{ background: "#161922", borderColor: "#2a2d3a" }}>
                  削減A = {calc.reduction_a.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円
                </div>
              </div>

              {/* 受給率改善 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">受給率改善</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">受給者数（人）</label>
                    <input type="number" value={form.recipient_count} onChange={(e) => setField("recipient_count", e.target.value)} className={inputClass} style={inputStyle} placeholder="例: 993" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">受給率改善幅 (%)</label>
                    <input type="number" value={form.delta_recep_rate} onChange={(e) => setField("delta_recep_rate", e.target.value)} className={inputClass} style={inputStyle} placeholder="例: 0.5" />
                  </div>
                </div>
                <div className="rounded-lg border px-3 py-2 text-xs text-slate-400" style={{ background: "#161922", borderColor: "#2a2d3a" }}>
                  削減B = {calc.reduction_b.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円
                </div>
              </div>

              {/* 単位給付費改善 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">単位給付費改善</p>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">単位給付費改善幅（万円）</label>
                  <input type="number" value={form.delta_unit_benefit} onChange={(e) => setField("delta_unit_benefit", e.target.value)} className={inputClass} style={inputStyle} placeholder="0" />
                </div>
                <div className="rounded-lg border px-3 py-2 text-xs text-slate-400" style={{ background: "#161922", borderColor: "#2a2d3a" }}>
                  削減C = {calc.reduction_c.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円
                </div>
              </div>

              {/* 合計・コスト比率プレビュー */}
              <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "#2a2d3a", background: "#161922" }}>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">合計削減額</span>
                  <span className="text-base font-bold text-slate-100">{calc.total_reduction.toLocaleString(undefined, { maximumFractionDigits: 2 })} 万円</span>
                </div>
                <div className="flex justify-between items-center border-t pt-2" style={{ borderColor: "#2a2d3a" }}>
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

              {/* 根拠・メモ */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">根拠</label>
                  <input type="text" value={form.evidence_basis} onChange={(e) => setField("evidence_basis", e.target.value)} className={inputClass} style={inputStyle} placeholder="データ根拠" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">メモ</label>
                  <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={inputClass} style={inputStyle} rows={2} />
                </div>
              </div>

              {formError && <p className="text-xs text-red-400">{formError}</p>}
            </div>

            {/* モーダルフッター */}
            <div className="flex gap-3 justify-end px-6 py-4 border-t" style={{ borderColor: "#2a2d3a" }}>
              <button type="button" onClick={handleCloseModal} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors">
                キャンセル
              </button>
              <PermissionGate module="cost_efficiency" level="edit" projectId={project.id}>
                <button type="button" onClick={() => void handleSave()} disabled={submitting}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
                  {submitting ? "保存中..." : editingId ? "更新" : "保存"}
                </button>
              </PermissionGate>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
