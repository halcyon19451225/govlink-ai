"use client";

import { useState } from "react";

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  indicator_type: string;
}

interface ReportRow {
  id: string;
  kpi_id: string;
  kpi_label: string;
  kpi_unit: string;
  reported_value: number;
  report_period: string;
  comment: string | null;
  status: string;
  reported_by: string;
  reported_by_name: string | null;
  created_at: string;
}

const STATUS_CONFIG = {
  pending:  { label: "未確認", color: "#f59e0b", bg: "#f59e0b15", border: "#f59e0b30" },
  approved: { label: "承認済", color: "#10b981", bg: "#10b98115", border: "#10b98130" },
  rejected: { label: "却下",   color: "#ef4444", bg: "#ef444415", border: "#ef444430" },
} as const;

const INDICATOR_LABELS: Record<string, string> = {
  process: "プロセス",
  outcome_initial: "初期アウトカム",
  outcome_mid: "中期アウトカム",
  outcome_long: "長期アウトカム",
  efficiency: "効率性",
};

export default function KpiSummaryClient({
  projectId,
  kpis,
  initialReports,
}: {
  projectId: string;
  kpis: KpiRow[];
  initialReports: ReportRow[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterKpi, setFilterKpi] = useState<string>("all");
  const [processing, setProcessing] = useState<string | null>(null);

  const handleReview = async (reportId: string, status: "approved" | "rejected") => {
    setProcessing(reportId);
    try {
      const res = await fetch(`/api/admin/kpi-reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setReports((prev) =>
          prev.map((r) => (r.id === reportId ? { ...r, status } : r)),
        );
      }
    } finally {
      setProcessing(null);
    }
  };

  const filtered = reports.filter(
    (r) =>
      (filterStatus === "all" || r.status === filterStatus) &&
      (filterKpi === "all" || r.kpi_id === filterKpi),
  );

  const pendingCount = reports.filter((r) => r.status === "pending").length;

  // KPI progress bars
  const kpiMap = Object.fromEntries(kpis.map((k) => [k.id, k]));

  return (
    <div className="space-y-6">
      {/* KPI Overview */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          KPI達成状況
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {kpis.map((kpi) => {
            const pct = kpi.target > 0 ? Math.min(100, Math.round((kpi.current / kpi.target) * 100)) : 0;
            const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#06b6d4" : "#f59e0b";
            return (
              <div
                key={kpi.id}
                className="rounded-xl border p-4"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{kpi.label}</span>
                    <span className="text-xs text-slate-600">{kpi.unit}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "#1e2133", color: "#64748b", border: "1px solid var(--border)" }}>
                      {INDICATOR_LABELS[kpi.indicator_type] ?? kpi.indicator_type}
                    </span>
                  </div>
                  <span className="text-sm font-bold" style={{ color }}>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--border)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>現在値: {kpi.current}{kpi.unit}</span>
                  <span>目標: {kpi.target}{kpi.unit}</span>
                </div>
              </div>
            );
          })}
          {kpis.length === 0 && (
            <p className="text-sm text-slate-500 col-span-2 py-4">KPIが設定されていません。</p>
          )}
        </div>
      </section>

      {/* Reports section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            報告一覧
            {pendingCount > 0 && (
              <span
                className="ml-2 text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{ background: "#f59e0b20", color: "#f59e0b", border: "1px solid #f59e0b40" }}
              >
                {pendingCount}件未確認
              </span>
            )}
          </h3>
          <div className="flex gap-2">
            {/* Status filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-xs rounded-lg border px-2 py-1.5 text-slate-300 focus:outline-none focus:border-indigo-500"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
            >
              <option value="all">全ステータス</option>
              <option value="pending">未確認</option>
              <option value="approved">承認済</option>
              <option value="rejected">却下</option>
            </select>
            {/* KPI filter */}
            <select
              value={filterKpi}
              onChange={(e) => setFilterKpi(e.target.value)}
              className="text-xs rounded-lg border px-2 py-1.5 text-slate-300 focus:outline-none focus:border-indigo-500"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
            >
              <option value="all">全KPI</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-8 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm text-slate-500">
              {reports.length === 0 ? "まだ報告がありません" : "条件に一致する報告はありません"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const sc = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
              const kpi = kpiMap[r.kpi_id];
              const isPending = r.status === "pending";
              return (
                <div
                  key={r.id}
                  className="rounded-xl border p-4"
                  style={{ background: "var(--bg-secondary)", borderColor: isPending ? "#f59e0b30" : "var(--border)" }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status + KPI */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                          style={{ background: sc.bg, borderColor: sc.border, color: sc.color }}
                        >
                          {sc.label}
                        </span>
                        <span className="text-sm font-medium text-slate-200">{r.kpi_label}</span>
                        {r.kpi_unit && <span className="text-xs text-slate-500">{r.kpi_unit}</span>}
                      </div>

                      {/* Value */}
                      <div className="flex items-baseline gap-3 mb-2">
                        <span className="text-2xl font-bold text-slate-100">
                          {r.reported_value}
                        </span>
                        {r.kpi_unit && (
                          <span className="text-sm text-slate-500">{r.kpi_unit}</span>
                        )}
                        {kpi && kpi.target > 0 && (
                          <span className="text-xs text-slate-500">
                            （目標 {kpi.target}{kpi.unit}、
                            <span
                              style={{
                                color: (r.reported_value / kpi.target) >= 0.8 ? "#10b981" :
                                       (r.reported_value / kpi.target) >= 0.5 ? "#06b6d4" : "#f59e0b",
                              }}
                            >
                              {Math.round((r.reported_value / kpi.target) * 100)}%達成
                            </span>
                            ）
                          </span>
                        )}
                      </div>

                      {/* Meta */}
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                        <span>報告期間: {r.report_period}</span>
                        <span>報告者: {r.reported_by_name ?? r.reported_by}</span>
                        <span>{new Date(r.created_at).toLocaleDateString("ja-JP")}</span>
                      </div>

                      {r.comment && (
                        <p className="mt-2 text-xs text-slate-400 leading-relaxed border rounded-lg px-3 py-2"
                          style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
                          {r.comment}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    {isPending && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          disabled={processing === r.id}
                          onClick={() => void handleReview(r.id, "approved")}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all duration-200 disabled:opacity-50"
                          style={{ background: "#10b98115", borderColor: "#10b98140", color: "#34d399" }}
                        >
                          {processing === r.id ? "..." : "承認"}
                        </button>
                        <button
                          disabled={processing === r.id}
                          onClick={() => void handleReview(r.id, "rejected")}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all duration-200 disabled:opacity-50"
                          style={{ background: "#ef444415", borderColor: "#ef444430", color: "#f87171" }}
                        >
                          {processing === r.id ? "..." : "却下"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Link to report form */}
      <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
        <a
          href={`/projects/${projectId}/kpi-report`}
          className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors duration-200"
        >
          → 自分の実績を報告する
        </a>
      </div>
    </div>
  );
}
