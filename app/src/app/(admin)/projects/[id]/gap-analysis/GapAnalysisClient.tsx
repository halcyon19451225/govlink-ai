"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import StatCalcStepsPanel from "@/components/stats/StatCalcStepsPanel";
import PermissionGate from "@/components/PermissionGate";

interface GapAnalysis {
  id: string;
  project_id: string;
  checkpoint_id: string | null;
  indicator_name: string;
  indicator_unit: string | null;
  data_source: string;
  current_value: number;
  current_year: number;
  target_value: number;
  target_basis: string;
  gap_value: number;
  affected_population: number | null;
  trend: "improving" | "worsening" | "stable" | "unknown";
  priority_score: number | null;
  notes: string | null;
  ai_analysis: string | null;
  created_at: string;
  updated_at: string;
}

interface DatasetRow {
  id: string;
  dataset_def_id: string;
  file_name: string;
  uploaded_at: string;
  survey_year: number | null;
}

interface TrendAnalysisResult {
  id: string;
  results: {
    slope: number;
    intercept: number;
    rSquared: number;
    forecast: Array<{ year: number; value: number }>;
  };
  calculationSteps: object;
}

const TREND_OPTIONS = [
  { value: "improving", label: "改善中" },
  { value: "worsening", label: "悪化中" },
  { value: "stable", label: "横ばい" },
  { value: "unknown", label: "不明" },
] as const;

const TREND_BADGE: Record<GapAnalysis["trend"], { label: string; style: React.CSSProperties }> = {
  improving: { label: "改善中", style: { background: "#10b98120", color: "#10b981", border: "1px solid #10b98140" } },
  worsening: { label: "悪化中", style: { background: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" } },
  stable: { label: "横ばい", style: { background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40" } },
  unknown: { label: "不明", style: { background: "#64748b20", color: "#94a3b8", border: "1px solid #64748b40" } },
};

const DATA_SOURCE_TABS = [
  { key: "介護保険事業", label: "介護保険事業" },
  { key: "ニーズ調査", label: "ニーズ調査" },
  { key: "認定状況", label: "認定状況" },
  { key: "サービス利用", label: "サービス利用" },
  { key: "その他", label: "その他" },
];

const cardStyle: React.CSSProperties = { background: "#1a1d27", borderColor: "#2a2d3a" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle: React.CSSProperties = { background: "#161922", borderColor: "#2a2d3a" };

const defaultForm = {
  indicator_name: "",
  indicator_unit: "",
  data_source: "",
  current_value: "",
  current_year: String(new Date().getFullYear()),
  target_value: "",
  target_basis: "",
  affected_population: "",
  trend: "unknown" as GapAnalysis["trend"],
  notes: "",
};

export default function GapAnalysisClient({
  project,
  gaps: initialGaps,
  datasets,
  projectId,
}: {
  project: { id: string; title: string };
  gaps: GapAnalysis[];
  datasets: DatasetRow[];
  projectId: string;
}) {
  const [gaps, setGaps] = useState<GapAnalysis[]>(initialGaps);
  const [activeTab, setActiveTab] = useState(DATA_SOURCE_TABS[0]!.key);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 統計分析結果をgapIdごとに保持
  const [trendResults, setTrendResults] = useState<Record<string, TrendAnalysisResult>>({});
  const [analyzingTrend, setAnalyzingTrend] = useState<string | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importingFromDatasets, setImportingFromDatasets] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // 指定タブのギャップ
  const tabGaps = gaps.filter((g) => {
    if (activeTab === "その他") {
      return !DATA_SOURCE_TABS.slice(0, -1).some((t) => g.data_source.includes(t.key));
    }
    return g.data_source.includes(activeTab);
  });

  const handleFormChange = (field: keyof typeof defaultForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAdd = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/gap-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indicator_name: form.indicator_name,
          indicator_unit: form.indicator_unit || null,
          data_source: form.data_source,
          current_value: parseFloat(form.current_value),
          current_year: parseInt(form.current_year, 10),
          target_value: parseFloat(form.target_value),
          target_basis: form.target_basis,
          affected_population: form.affected_population ? parseFloat(form.affected_population) : null,
          trend: form.trend,
          notes: form.notes || null,
        }),
      });
      const json = (await res.json()) as { data: GapAnalysis | null; error: string | null };
      if (!res.ok || json.error) {
        setFormError(json.error ?? "追加に失敗しました");
        return;
      }
      if (json.data) {
        setGaps((prev) => [...prev, json.data!]);
      }
      setForm(defaultForm);
      setShowAddForm(false);
    } catch {
      setFormError("ネットワークエラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (gapId: string) => {
    if (!confirm("このギャップ分析を削除しますか？")) return;
    setDeletingId(gapId);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/gap-analysis/${gapId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setGaps((prev) => prev.filter((g) => g.id !== gapId));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleTrendAnalysis = async (gap: GapAnalysis) => {
    setAnalyzingTrend(gap.id);
    try {
      // サンプルデータポイント：current_year - 2〜current_year
      const data_points = [
        { year: gap.current_year - 2, value: gap.current_value * 0.9 },
        { year: gap.current_year - 1, value: gap.current_value * 0.95 },
        { year: gap.current_year, value: gap.current_value },
      ];
      const res = await fetch(`/api/admin/projects/${projectId}/stats/trend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indicator_name: gap.indicator_name,
          data_points,
        }),
      });
      const json = (await res.json()) as {
        data: TrendAnalysisResult | null;
        error: string | null;
      };
      if (json.data) {
        setTrendResults((prev) => ({ ...prev, [gap.id]: json.data! }));
      }
    } finally {
      setAnalyzingTrend(null);
    }
  };

  const handleImportFromDatasets = async () => {
    setImportingFromDatasets(true);
    setImportResult(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/gap-analysis/ai-analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from_datasets: true }),
        },
      );
      const json = (await res.json()) as {
        data: { created: number; ids: string[] } | null;
        error: string | null;
      };
      if (!res.ok || json.error) {
        setImportResult(`エラー: ${json.error ?? "不明なエラー"}`);
        return;
      }
      // 再取得して一覧を更新
      const listRes = await fetch(`/api/admin/projects/${projectId}/gap-analysis`);
      const listJson = (await listRes.json()) as { data: GapAnalysis[] | null };
      if (listJson.data) setGaps(listJson.data);
      setImportResult(`${json.data?.created ?? 0} 件のギャップ分析を登録・更新しました`);
    } catch {
      setImportResult("エラー: ネットワークエラーが発生しました");
    } finally {
      setImportingFromDatasets(false);
    }
  };

  const handleAiAnalysis = async (gap: GapAnalysis) => {
    setAnalyzingAi(gap.id);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/gap-analysis/ai-analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gap_ids: [gap.id] }),
        },
      );
      const json = (await res.json()) as { data: { analyzed: number } | null; error: string | null };
      if (res.ok && json.data) {
        // 再取得
        const listRes = await fetch(`/api/admin/projects/${projectId}/gap-analysis`);
        const listJson = (await listRes.json()) as { data: GapAnalysis[] | null };
        if (listJson.data) setGaps(listJson.data);
      }
    } finally {
      setAnalyzingAi(null);
    }
  };

  return (
    <div className="flex gap-6">
      {/* メインエリア */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">{project.title}</h1>
            <p className="text-sm text-slate-500 mt-1">ギャップ分析</p>
          </div>
          <div className="flex items-center gap-2">
            {datasets.length > 0 && (
              <PermissionGate module="gap_analysis" level="edit" projectId={projectId}>
                <button
                  type="button"
                  onClick={() => void handleImportFromDatasets()}
                  disabled={importingFromDatasets}
                  className="text-sm font-semibold px-4 py-2 rounded-xl text-white transition-all duration-200 disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #0ea5e9, #10b981)" }}
                >
                  {importingFromDatasets ? "取込中..." : "CSVから自動取込"}
                </button>
              </PermissionGate>
            )}
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white transition-all duration-200"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              + ギャップを追加
            </button>
          </div>
        </div>

        {/* 取込結果メッセージ */}
        {importResult && (
          <div
            className="rounded-xl border px-4 py-3 text-sm"
            style={{
              borderColor: importResult.startsWith("エラー") ? "#ef444440" : "#10b98140",
              background: importResult.startsWith("エラー") ? "#ef444410" : "#10b98110",
              color: importResult.startsWith("エラー") ? "#ef4444" : "#10b981",
            }}
          >
            {importResult}
            <button
              type="button"
              onClick={() => setImportResult(null)}
              className="ml-3 text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* 追加フォーム */}
        {showAddForm && (
          <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
            <h3 className="text-sm font-semibold text-slate-200">新規ギャップ追加</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">指標名 *</label>
                <input
                  type="text"
                  value={form.indicator_name}
                  onChange={(e) => handleFormChange("indicator_name", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="例: 認定率"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">単位</label>
                <input
                  type="text"
                  value={form.indicator_unit}
                  onChange={(e) => handleFormChange("indicator_unit", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="例: %"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">データソース *</label>
                <input
                  type="text"
                  value={form.data_source}
                  onChange={(e) => handleFormChange("data_source", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="例: 介護保険事業状況報告"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">現状値 *</label>
                <input
                  type="number"
                  value={form.current_value}
                  onChange={(e) => handleFormChange("current_value", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">現状年</label>
                <input
                  type="number"
                  value={form.current_year}
                  onChange={(e) => handleFormChange("current_year", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">目標値 *</label>
                <input
                  type="number"
                  value={form.target_value}
                  onChange={(e) => handleFormChange("target_value", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">目標根拠</label>
                <input
                  type="text"
                  value={form.target_basis}
                  onChange={(e) => handleFormChange("target_basis", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="例: 国の基本指針"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">影響人口</label>
                <input
                  type="number"
                  value={form.affected_population}
                  onChange={(e) => handleFormChange("affected_population", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">傾向</label>
                <select
                  value={form.trend}
                  onChange={(e) => handleFormChange("trend", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  {TREND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">メモ</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => handleFormChange("notes", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  rows={2}
                />
              </div>
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="flex-1 text-sm px-4 py-2 rounded-xl border text-slate-400"
                style={{ borderColor: "#2a2d3a" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={submitting}
                className="flex-1 text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {submitting ? "追加中..." : "追加"}
              </button>
            </div>
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-1 border-b" style={{ borderColor: "#2a2d3a" }}>
          {DATA_SOURCE_TABS.map((tab) => {
            const count =
              tab.key === "その他"
                ? gaps.filter((g) => !DATA_SOURCE_TABS.slice(0, -1).some((t) => g.data_source.includes(t.key))).length
                : gaps.filter((g) => g.data_source.includes(tab.key)).length;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 text-sm font-medium transition-colors duration-200 border-b-2 -mb-px"
                style={{
                  borderBottomColor: activeTab === tab.key ? "#6366f1" : "transparent",
                  color: activeTab === tab.key ? "#818cf8" : "#64748b",
                }}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: "#2a2d3a", color: "#94a3b8" }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ギャップテーブル */}
        {tabGaps.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-10 text-center"
            style={{ borderColor: "#2a2d3a" }}
          >
            <p className="text-sm text-slate-500">このカテゴリにギャップがありません</p>
          </div>
        ) : (
          <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid #2a2d3a", background: "#161922" }}>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">指標名</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">現状値</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">目標値</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">乖離値</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">傾向</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">優先度</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">アクション</th>
                </tr>
              </thead>
              <tbody>
                {tabGaps.map((gap) => {
                  const trendResult = trendResults[gap.id];
                  // チャート用データ：過去2年分 + 現状 + 予測
                  const chartData = trendResult
                    ? [
                        { year: gap.current_year - 2, value: gap.current_value * 0.9, type: "actual" },
                        { year: gap.current_year - 1, value: gap.current_value * 0.95, type: "actual" },
                        { year: gap.current_year, value: gap.current_value, type: "actual" },
                        ...trendResult.results.forecast.map((f) => ({
                          year: f.year,
                          forecast: f.value,
                          type: "forecast",
                        })),
                      ]
                    : [];

                  return (
                    <>
                      <tr
                        key={gap.id}
                        style={{ borderBottom: "1px solid #2a2d3a" }}
                        className="hover:bg-white/2 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-slate-200 font-medium">{gap.indicator_name}</p>
                            {gap.indicator_unit && (
                              <p className="text-xs text-slate-500">単位: {gap.indicator_unit}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {gap.current_value}
                          {gap.indicator_unit && (
                            <span className="text-xs text-slate-500 ml-1">{gap.indicator_unit}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {gap.target_value}
                          {gap.indicator_unit && (
                            <span className="text-xs text-slate-500 ml-1">{gap.indicator_unit}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="font-medium"
                            style={{ color: gap.gap_value > 0 ? "#ef4444" : "#10b981" }}
                          >
                            {gap.gap_value > 0 ? "+" : ""}
                            {gap.gap_value.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={TREND_BADGE[gap.trend].style}
                          >
                            {TREND_BADGE[gap.trend].label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {gap.priority_score != null ? (
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded"
                              style={{
                                background:
                                  gap.priority_score >= 70
                                    ? "#ef444420"
                                    : gap.priority_score >= 40
                                    ? "#f59e0b20"
                                    : "#10b98120",
                                color:
                                  gap.priority_score >= 70
                                    ? "#ef4444"
                                    : gap.priority_score >= 40
                                    ? "#f59e0b"
                                    : "#10b981",
                              }}
                            >
                              {gap.priority_score}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => void handleTrendAnalysis(gap)}
                              disabled={analyzingTrend === gap.id}
                              className="text-xs px-2 py-1 rounded border transition-colors duration-200 hover:border-indigo-500/40 hover:text-indigo-400 text-slate-400 disabled:opacity-50"
                              style={{ borderColor: "#2a2d3a" }}
                            >
                              {analyzingTrend === gap.id ? "分析中..." : "統計分析"}
                            </button>
                            <PermissionGate module="gap_analysis" level="edit" projectId={projectId}>
                              <button
                                type="button"
                                onClick={() => void handleAiAnalysis(gap)}
                                disabled={analyzingAi === gap.id}
                                className="text-xs px-2 py-1 rounded border transition-colors duration-200 hover:border-cyan-500/40 hover:text-cyan-400 text-slate-400 disabled:opacity-50"
                                style={{ borderColor: "#2a2d3a" }}
                              >
                                {analyzingAi === gap.id ? "分析中..." : "AI分析"}
                              </button>
                            </PermissionGate>
                            <button
                              type="button"
                              onClick={() => void handleDelete(gap.id)}
                              disabled={deletingId === gap.id}
                              className="text-xs px-2 py-1 rounded border transition-colors duration-200 hover:border-red-500/40 hover:text-red-400 text-slate-500 disabled:opacity-50"
                              style={{ borderColor: "#2a2d3a" }}
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* AI分析結果 */}
                      {gap.ai_analysis && (
                        <tr key={`${gap.id}-ai`} style={{ borderBottom: "1px solid #2a2d3a" }}>
                          <td colSpan={7} className="px-4 py-3">
                            <div
                              className="rounded-lg px-3 py-2 border-l-2 text-xs text-slate-300 leading-relaxed"
                              style={{ background: "#06b6d410", borderLeftColor: "#06b6d4" }}
                            >
                              <p className="font-semibold text-cyan-400 mb-1">AI分析</p>
                              {gap.ai_analysis}
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* 統計分析結果 */}
                      {trendResult && (
                        <tr key={`${gap.id}-trend`} style={{ borderBottom: "1px solid #2a2d3a" }}>
                          <td colSpan={7} className="px-4 py-4">
                            <div className="space-y-3">
                              <div className="flex items-center gap-4 text-xs text-slate-400">
                                <span>
                                  傾き:{" "}
                                  <span className="text-slate-200 font-mono">
                                    {trendResult.results.slope}
                                  </span>
                                </span>
                                <span>
                                  R²:{" "}
                                  <span className="text-slate-200 font-mono">
                                    {trendResult.results.rSquared}
                                  </span>
                                </span>
                              </div>
                              <div style={{ height: 160 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
                                    <XAxis
                                      dataKey="year"
                                      tick={{ fill: "#64748b", fontSize: 11 }}
                                      stroke="#2a2d3a"
                                    />
                                    <YAxis
                                      tick={{ fill: "#64748b", fontSize: 11 }}
                                      stroke="#2a2d3a"
                                    />
                                    <Tooltip
                                      contentStyle={{
                                        background: "#1a1d27",
                                        border: "1px solid #2a2d3a",
                                        borderRadius: 8,
                                        color: "#e2e8f0",
                                        fontSize: 12,
                                      }}
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="value"
                                      stroke="#6366f1"
                                      strokeWidth={2}
                                      dot={{ fill: "#6366f1", r: 3 }}
                                      name="実績"
                                    />
                                    <Line
                                      type="monotone"
                                      dataKey="forecast"
                                      stroke="#06b6d4"
                                      strokeWidth={2}
                                      strokeDasharray="5 5"
                                      dot={{ fill: "#06b6d4", r: 3 }}
                                      name="予測"
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                              <StatCalcStepsPanel
                                steps={trendResult.calculationSteps}
                                title="回帰計算ステップ"
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 右サイドバー: データ系譜 */}
      <div
        className="w-72 flex-shrink-0 rounded-2xl border p-4 h-fit sticky top-4"
        style={cardStyle}
      >
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          データ系譜
        </h3>
        {datasets.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">
            アップロード済みデータセットなし
          </p>
        ) : (
          <div className="space-y-2">
            {datasets.map((ds) => (
              <div
                key={ds.id}
                className="rounded-lg border p-3"
                style={{ borderColor: "#2a2d3a", background: "#161922" }}
              >
                <p className="text-xs font-medium text-slate-200 truncate">
                  {ds.file_name}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {ds.survey_year != null && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded border"
                      style={{
                        borderColor: "#6366f140",
                        color: "#818cf8",
                        background: "#6366f110",
                      }}
                    >
                      {ds.survey_year}年度
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    {new Date(ds.uploaded_at).toLocaleDateString("ja-JP")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
