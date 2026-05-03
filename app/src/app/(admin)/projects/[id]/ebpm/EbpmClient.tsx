"use client";

import { useState, useEffect, useRef } from "react";
import UpgradeModal from "@/components/UpgradeModal";

// ────────────────── 型定義 ──────────────────
interface KpiRow { id: string; label: string; target: number; current: number; unit: string }
interface EvidenceRow {
  id: string; title: string; evidence_type: string; strength: number;
  output_kpi_id: string | null; outcome_kpi_id: string | null;
}
interface SuggestionRow {
  id: string; suggestion_type: string; title: string;
  body: string; priority: string; created_at: string;
}
interface BenchmarkRow {
  id: string; kpi_id: string; source: string;
  label: string; value: number; unit: string | null; year: number | null;
}
interface ReportRow {
  id: string; report_type: string; title: string;
  content: string; generated_at: string;
}
interface EbpmScore {
  evidence_score: number; kpi_score: number;
  schedule_score: number; document_score: number; total_score: number;
}

// ────────────────── 定数 ──────────────────
const SUGGESTION_TYPE_LABEL: Record<string, string> = {
  kpi_adjustment: "KPI調整", evidence_gap: "エビデンスギャップ",
  schedule_risk: "スケジュールリスク", efficiency: "効率化", best_practice: "ベストプラクティス",
};
const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-500/20 text-red-300 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  low: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};
const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };
const REPORT_TYPES = [
  { value: "council", label: "議会向け報告書" },
  { value: "public", label: "住民向け報告" },
  { value: "evaluation", label: "評価報告書" },
  { value: "annual", label: "年次報告書" },
];
const EVIDENCE_TYPE_COLORS: Record<string, string> = {
  rct: "#6366f1", observational: "#06b6d4",
  case_study: "#10b981", expert: "#f59e0b", statistics: "#8b5cf6", other: "#94a3b8",
};
const cardStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };

// ────────────────── スコアゲージ ──────────────────
function ScoreGauge({ label, score, color }: { label: string; score: number; color: string }) {
  const grade =
    score >= 80 ? { text: "優秀", cls: "text-emerald-400" } :
    score >= 60 ? { text: "良好", cls: "text-cyan-400" } :
    score >= 40 ? { text: "要改善", cls: "text-amber-400" } :
    { text: "要対応", cls: "text-red-400" };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-slate-400">{label}</span>
        <span className={`text-xs font-semibold ${grade.cls}`}>{grade.text}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#2a2d3a" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-right text-sm font-bold text-slate-200">{score}点</span>
    </div>
  );
}

// ────────────────── メインコンポーネント ──────────────────
export default function EbpmClient({
  projectId, kpis, evidences, initialSuggestions, benchmarks, initialReports,
}: {
  projectId: string;
  kpis: KpiRow[];
  evidences: EvidenceRow[];
  initialSuggestions: SuggestionRow[];
  benchmarks: BenchmarkRow[];
  initialReports: ReportRow[];
}) {
  const [score, setScore] = useState<EbpmScore | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>(initialSuggestions);
  const [reports, setReports] = useState<ReportRow[]>(initialReports);
  const [estatKeyword, setEstatKeyword] = useState("");
  const [benchmarkKpiId, setBenchmarkKpiId] = useState(kpis[0]?.id ?? "");
  const [benchmarkList, setBenchmarkList] = useState<BenchmarkRow[]>(benchmarks);
  const [reportType, setReportType] = useState<"council" | "public" | "evaluation" | "annual">("council");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamMode, setStreamMode] = useState<"idle" | "suggest" | "report">("idle");
  const [estatLoading, setEstatLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // スコアを取得
  useEffect(() => {
    fetch(`/api/admin/ebpm-score/${projectId}`)
      .then((r) => r.json())
      .then((j: { data: EbpmScore; error: string | null }) => {
        if (j.data) setScore(j.data);
      })
      .catch(() => null);
  }, [projectId]);

  // ── AI改善提案 ──
  const handleSuggest = async () => {
    setStreamMode("suggest");
    setError(null);
    try {
      const res = await fetch("/api/ai/suggest-improvements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json() as { data: SuggestionRow[] | null; error: string | null; upgrade_url?: string };
      if (!res.ok || json.error) {
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "AI生成回数の上限に達しました");
        } else {
          setError(json.error ?? "生成に失敗しました");
        }
        return;
      }
      if (json.data && json.data.length > 0) {
        setSuggestions((prev) => [...json.data!, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setStreamMode("idle");
    }
  };

  // ── AIレポート生成 ──
  const handleReport = async () => {
    setStreamMode("report");
    setStreamText("");
    setError(null);
    try {
      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, reportType, periodStart: periodStart || undefined, periodEnd: periodEnd || undefined }),
      });
      if (!res.body) throw new Error("レスポンスが空です");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        setStreamText(buf);
        if (reportRef.current) reportRef.current.scrollTop = reportRef.current.scrollHeight;
      }
      // 新しいレポートをリストに追加
      const label = REPORT_TYPES.find((t) => t.value === reportType)?.label ?? reportType;
      const newReport: ReportRow = {
        id: crypto.randomUUID(),
        report_type: reportType,
        title: `${label} (${new Date().toLocaleDateString("ja-JP")})`,
        content: buf,
        generated_at: new Date().toISOString(),
      };
      setReports((prev) => [newReport, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
    } finally {
      setStreamMode("idle");
    }
  };

  // ── e-Stat検索 ──
  const handleEstat = async () => {
    if (!estatKeyword.trim()) return;
    setEstatLoading(true);
    setError(null);
    try {
      const url = new URL("/api/integrations/estat", window.location.origin);
      url.searchParams.set("keyword", estatKeyword);
      if (benchmarkKpiId) url.searchParams.set("kpiId", benchmarkKpiId);
      const res = await fetch(url.toString());
      const json = (await res.json()) as { data: BenchmarkRow[] | null; error: string | null };
      if (!res.ok) { setError(json.error ?? "取得に失敗しました"); return; }
      if (json.data) {
        const newItems = json.data.map((d, i) => ({
          ...d,
          id: `tmp-${i}`,
          kpi_id: benchmarkKpiId,
        }));
        setBenchmarkList((prev) => [...newItems, ...prev]);
      }
    } finally {
      setEstatLoading(false);
    }
  };

  const totalColor =
    !score ? "#94a3b8" :
    score.total_score >= 80 ? "#10b981" :
    score.total_score >= 60 ? "#06b6d4" :
    score.total_score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <>
    {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
    <div className="space-y-8">
      {error && (
        <div className="rounded-xl border px-4 py-3 text-sm text-red-400"
          style={{ background: "#ef444410", borderColor: "#ef444430" }}>
          {error}
        </div>
      )}

      {/* ── セクション1: スコアカード ── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          EBPMスコアカード
        </h3>
        <div className="rounded-2xl border p-6" style={cardStyle}>
          {score ? (
            <div className="flex flex-col lg:flex-row gap-8 items-center">
              {/* 総合スコア */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">総合スコア</span>
                <span className="text-6xl font-bold" style={{ color: totalColor }}>
                  {score.total_score}
                </span>
                <span className="text-sm font-semibold" style={{ color: totalColor }}>
                  {score.total_score >= 80 ? "優秀" : score.total_score >= 60 ? "良好" : score.total_score >= 40 ? "要改善" : "要対応"}
                </span>
              </div>
              {/* 4指標 */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-5 w-full">
                <ScoreGauge label="エビデンス充足度" score={score.evidence_score} color="#8b5cf6" />
                <ScoreGauge label="KPI達成率" score={score.kpi_score} color="#6366f1" />
                <ScoreGauge label="スケジュール進捗" score={score.schedule_score} color="#10b981" />
                <ScoreGauge label="ドキュメント充足度" score={score.document_score} color="#f59e0b" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center py-4">スコアを計算中...</p>
          )}
        </div>
      </section>

      {/* ── セクション2: KPI × エビデンス相関マップ ── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          KPI × エビデンス相関マップ
        </h3>
        <div className="rounded-2xl border p-6" style={cardStyle}>
          {kpis.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">KPIがまだ登録されていません</p>
          ) : (
            <div className="space-y-4">
              {kpis.map((kpi) => {
                const linked = evidences.filter(
                  (e) => e.output_kpi_id === kpi.id || e.outcome_kpi_id === kpi.id,
                );
                const avgStr =
                  linked.length > 0
                    ? linked.reduce((s, e) => s + e.strength, 0) / linked.length
                    : 0;
                const pct = kpi.target > 0 ? Math.min(100, (kpi.current / kpi.target) * 100) : 0;
                return (
                  <div key={kpi.id} className="flex items-center gap-4 flex-wrap">
                    <div className="w-40 shrink-0">
                      <p className="text-xs font-medium text-slate-300 truncate">{kpi.label}</p>
                      <p className="text-xs text-slate-500">達成率 {Math.round(pct)}%</p>
                    </div>
                    {/* エビデンスバブル */}
                    <div className="flex-1 flex gap-2 flex-wrap items-center min-h-8">
                      {linked.length === 0 ? (
                        <span className="text-xs text-slate-600">エビデンスなし</span>
                      ) : (
                        linked.map((e) => (
                          <div
                            key={e.id}
                            className="rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                            style={{
                              width: `${20 + e.strength * 6}px`,
                              height: `${20 + e.strength * 6}px`,
                              background: EVIDENCE_TYPE_COLORS[e.evidence_type] ?? "#94a3b8",
                              opacity: 0.85,
                            }}
                            title={`${e.title} (★${e.strength})`}
                          >
                            {e.strength}
                          </div>
                        ))
                      )}
                    </div>
                    {/* エビデンス強度平均バー */}
                    {linked.length > 0 && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs text-slate-500">平均強度</span>
                        <span className="text-xs font-semibold text-slate-300">
                          ★{avgStr.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* 凡例 */}
              <div className="flex gap-3 flex-wrap pt-2 border-t" style={{ borderColor: "#2a2d3a" }}>
                {Object.entries(EVIDENCE_TYPE_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                    <span className="text-xs text-slate-500">{type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── セクション3: 比較基準値 ── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          比較基準値（e-Stat / RESAS）
        </h3>
        <div className="rounded-2xl border p-6 space-y-5" style={cardStyle}>
          {/* e-Stat 検索フォーム */}
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-48">
              <label className="block text-xs text-slate-400 mb-1.5">キーワード</label>
              <input
                type="text"
                value={estatKeyword}
                onChange={(e) => setEstatKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleEstat()}
                placeholder="例: 待機児童 保育所"
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200"
                style={{ background: "#0f1117", borderColor: "#2a2d3a" }}
              />
            </div>
            <div className="min-w-36">
              <label className="block text-xs text-slate-400 mb-1.5">対象KPI</label>
              <select
                value={benchmarkKpiId}
                onChange={(e) => setBenchmarkKpiId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors duration-200"
                style={{ background: "#0f1117", borderColor: "#2a2d3a" }}
              >
                {kpis.map((k) => (
                  <option key={k.id} value={k.id} style={{ background: "#1a1d27" }}>{k.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleEstat}
              disabled={estatLoading || !estatKeyword.trim()}
              className="text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all duration-200"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              {estatLoading ? "検索中..." : "統計データを検索"}
            </button>
          </div>

          {/* ベンチマーク一覧 */}
          {benchmarkList.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-2">
              ベンチマーク値がまだ登録されていません
            </p>
          ) : (
            <div className="space-y-2">
              {kpis.map((kpi) => {
                const bms = benchmarkList.filter((b) => b.kpi_id === kpi.id);
                if (bms.length === 0) return null;
                return (
                  <div key={kpi.id}>
                    <p className="text-xs font-semibold text-slate-400 mb-2">{kpi.label}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      <div
                        className="rounded-lg border p-3 flex flex-col gap-0.5"
                        style={{ borderColor: "#6366f130", background: "#6366f108" }}
                      >
                        <span className="text-xs text-slate-500">現在値</span>
                        <span className="text-base font-bold text-indigo-400">
                          {kpi.current}{kpi.unit}
                        </span>
                        <span className="text-xs text-slate-600">目標: {kpi.target}{kpi.unit}</span>
                      </div>
                      {bms.slice(0, 4).map((bm) => (
                        <div
                          key={bm.id}
                          className="rounded-lg border p-3 flex flex-col gap-0.5"
                          style={{ borderColor: "#2a2d3a" }}
                        >
                          <span className="text-xs text-slate-500">
                            {bm.source === "estat" ? "e-Stat" : bm.source === "resas" ? "RESAS" : bm.source}
                            {bm.year ? ` (${bm.year}年)` : ""}
                          </span>
                          <span className="text-base font-bold text-slate-200">
                            {bm.value}{bm.unit ?? kpi.unit}
                          </span>
                          <span className="text-xs text-slate-600">{bm.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── セクション4: AI改善提案 ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            AI改善提案
          </h3>
          <button
            onClick={handleSuggest}
            disabled={streamMode !== "idle"}
            className="text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all duration-200 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {streamMode === "suggest" ? "生成中..." : "AIで改善提案を生成"}
          </button>
        </div>

        {streamMode === "suggest" && (
          <div className="rounded-xl border p-4 mb-4 text-sm text-slate-400 flex items-center gap-3"
            style={cardStyle}>
            <svg className="animate-spin h-4 w-4 shrink-0" style={{ color: "#6366f1" }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            AIが政策データを分析して改善提案を生成中です...（30〜60秒かかります）
          </div>
        )}

        {suggestions.length === 0 && streamMode !== "suggest" ? (
          <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "#2a2d3a" }}>
            <p className="text-sm text-slate-500">改善提案がまだ生成されていません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div key={s.id} className="rounded-xl border p-5" style={cardStyle}>
                <div className="flex items-start gap-3 flex-wrap mb-2">
                  <span className="text-xs text-slate-500 border rounded px-2 py-0.5" style={{ borderColor: "#2a2d3a" }}>
                    {SUGGESTION_TYPE_LABEL[s.suggestion_type] ?? s.suggestion_type}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${PRIORITY_BADGE[s.priority] ?? PRIORITY_BADGE.medium}`}>
                    優先度:{PRIORITY_LABEL[s.priority] ?? s.priority}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-100 mb-1">{s.title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── セクション5: レポート生成 ── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
          AIレポート自動生成
        </h3>
        <div className="rounded-2xl border p-6 space-y-5" style={cardStyle}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">レポートタイプ</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as typeof reportType)}
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors duration-200"
                style={{ background: "#0f1117", borderColor: "#2a2d3a" }}
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value} style={{ background: "#1a1d27" }}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">開始日（任意）</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors duration-200"
                style={{ background: "#0f1117", borderColor: "#2a2d3a" }}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">終了日（任意）</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors duration-200"
                style={{ background: "#0f1117", borderColor: "#2a2d3a" }}
              />
            </div>
          </div>
          <button
            onClick={handleReport}
            disabled={streamMode !== "idle"}
            className="text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all duration-200 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {streamMode === "report" ? "生成中..." : "AIでレポートを生成"}
          </button>

          {/* ストリーミング中のプレビュー */}
          {streamMode === "report" && (
            <div
              ref={reportRef}
              className="rounded-xl border p-4 max-h-80 overflow-y-auto text-sm text-slate-300 leading-relaxed whitespace-pre-wrap"
              style={{ borderColor: "#2a2d3a", background: "#0f1117" }}
            >
              {streamText || "生成中..."}
            </div>
          )}

          {/* レポート履歴 */}
          {reports.length > 0 && (
            <div className="space-y-3 border-t pt-4" style={{ borderColor: "#2a2d3a" }}>
              <p className="text-xs text-slate-500">生成済みレポート</p>
              {reports.map((r) => (
                <details key={r.id} className="rounded-xl border" style={cardStyle}>
                  <summary
                    className="px-4 py-3 cursor-pointer flex items-center justify-between"
                    style={{ listStyle: "none" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs border rounded px-2 py-0.5 text-slate-400" style={{ borderColor: "#2a2d3a" }}>
                        {REPORT_TYPES.find((t) => t.value === r.report_type)?.label ?? r.report_type}
                      </span>
                      <span className="text-sm text-slate-200">{r.title}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {new Date(r.generated_at).toLocaleDateString("ja-JP")}
                    </span>
                  </summary>
                  <div className="px-4 pb-4 space-y-3">
                    <div
                      className="rounded-lg border p-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto"
                      style={{ background: "#0f1117", borderColor: "#2a2d3a" }}
                    >
                      {r.content}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(r.content)}
                        className="text-xs px-3 py-1.5 rounded-lg border text-slate-400 hover:text-slate-200 transition-colors"
                        style={{ borderColor: "#2a2d3a" }}
                      >
                        コピー
                      </button>
                      <button
                        onClick={() => {
                          const w = window.open("", "_blank");
                          if (w) {
                            w.document.write(`<pre style="font-family:sans-serif;padding:2rem;white-space:pre-wrap">${r.content}</pre>`);
                            w.print();
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-lg border text-slate-400 hover:text-slate-200 transition-colors"
                        style={{ borderColor: "#2a2d3a" }}
                      >
                        印刷
                      </button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
    </>
  );
}
