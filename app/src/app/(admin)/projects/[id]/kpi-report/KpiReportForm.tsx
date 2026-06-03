"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  indicator_type: string;
}

const INDICATOR_LABELS: Record<string, string> = {
  process: "プロセス",
  outcome_initial: "初期アウトカム",
  outcome_mid: "中期アウトカム",
  outcome_long: "長期アウトカム",
  efficiency: "効率性",
};

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

// Generate report period options (current + 3 past quarters)
function getPeriodOptions(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const fiscalQuarter = month <= 3 ? 4 : month <= 6 ? 1 : month <= 9 ? 2 : 3;
  const fiscalYear = month <= 3 ? year - 1 : year;

  const options: string[] = [];
  let fy = fiscalYear;
  let fq = fiscalQuarter;
  for (let i = 0; i < 5; i++) {
    options.push(`${fy}年度 第${fq}四半期`);
    fq--;
    if (fq === 0) { fq = 4; fy--; }
  }
  return options;
}

interface ReportEntry {
  kpi_id: string;
  value: string;
  comment: string;
  enabled: boolean;
}

export default function KpiReportForm({
  projectId,
  kpis,
}: {
  projectId: string;
  kpis: KpiRow[];
}) {
  const router = useRouter();
  const periodOptions = getPeriodOptions();

  const [period, setPeriod] = useState(periodOptions[0] ?? "");
  const [entries, setEntries] = useState<ReportEntry[]>(
    kpis.map((k) => ({ kpi_id: k.id, value: "", comment: "", enabled: false })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateEntry = (idx: number, k: keyof ReportEntry, v: string | boolean) =>
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [k]: v } : e)));

  const enabledEntries = entries.filter((e) => e.enabled && e.value.trim());

  const handleSubmit = async () => {
    if (enabledEntries.length === 0) {
      setError("報告するKPIを1件以上選択し、実績値を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      for (const entry of enabledEntries) {
        const res = await fetch("/api/admin/kpi-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            kpi_id: entry.kpi_id,
            reported_value: parseFloat(entry.value),
            report_period: period,
            comment: entry.comment || null,
          }),
        });
        const json = (await res.json()) as { error: string | null };
        if (!res.ok) { setError(json.error ?? "送信に失敗しました"); return; }
      }
      setSuccess(true);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div
        className="rounded-2xl border p-8 text-center space-y-4"
        style={{ background: "var(--bg-secondary)", borderColor: "#10b98130" }}
      >
        <div className="flex items-center justify-center w-12 h-12 rounded-full mx-auto"
          style={{ background: "#10b98120" }}>
          <svg width={24} height={24} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold text-slate-100">報告を送信しました</p>
          <p className="text-sm text-slate-500 mt-1">管理者が確認後、KPIに反映されます。</p>
        </div>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={() => { setSuccess(false); setEntries(kpis.map((k) => ({ kpi_id: k.id, value: "", comment: "", enabled: false }))); }}
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
          >
            続けて報告する
          </button>
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors duration-200"
          >
            計画ページへ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-6 space-y-6"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
    >
      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
          style={{ background: "#ef444410", borderColor: "#ef444430" }}>
          {error}
        </div>
      )}

      {/* Period */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          報告期間 <span className="text-red-400">*</span>
        </label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {periodOptions.map((p) => (
            <option key={p} value={p} style={{ background: "var(--bg-secondary)" }}>{p}</option>
          ))}
          <option value="custom" style={{ background: "var(--bg-secondary)" }}>カスタム入力...</option>
        </select>
        {period === "custom" && (
          <input
            type="text"
            onChange={(e) => setPeriod(e.target.value)}
            className={`mt-2 ${inputClass}`}
            style={inputStyle}
            placeholder="例: 2024年度 上半期"
          />
        )}
      </div>

      {/* KPI list */}
      <div className="space-y-4">
        <p className="text-sm font-medium text-slate-300">報告するKPIを選択してください</p>
        {kpis.length === 0 ? (
          <p className="text-sm text-slate-500">この計画にはKPIが設定されていません。</p>
        ) : (
          kpis.map((kpi, i) => {
            const entry = entries[i];
            if (!entry) return null;
            const achievement = kpi.target > 0 ? Math.min(100, Math.round((kpi.current / kpi.target) * 100)) : null;
            return (
              <div
                key={kpi.id}
                className="rounded-xl border overflow-hidden transition-all duration-200"
                style={{
                  borderColor: entry.enabled ? "#6366f140" : "var(--border)",
                  background: entry.enabled ? "#6366f108" : "var(--bg-input)",
                }}
              >
                {/* KPI header (click to enable) */}
                <button
                  type="button"
                  onClick={() => updateEntry(i, "enabled", !entry.enabled)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <div
                    className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors duration-200"
                    style={{
                      background: entry.enabled ? "#6366f1" : "transparent",
                      borderColor: entry.enabled ? "#6366f1" : "#374151",
                    }}
                  >
                    {entry.enabled && (
                      <svg width={10} height={10} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{kpi.label}</span>
                      <span className="text-xs text-slate-500">{kpi.unit && `(${kpi.unit})`}</span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "#1e2133", color: "#64748b", border: "1px solid var(--border)" }}
                      >
                        {INDICATOR_LABELS[kpi.indicator_type] ?? kpi.indicator_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-slate-500">
                        目標: {kpi.target}{kpi.unit} / 現在: {kpi.current}{kpi.unit}
                      </span>
                      {achievement !== null && (
                        <span
                          className="text-xs font-semibold"
                          style={{ color: achievement >= 80 ? "#10b981" : achievement >= 50 ? "#06b6d4" : "#f59e0b" }}
                        >
                          {achievement}%達成
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Input area (only when enabled) */}
                {entry.enabled && (
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--border)" }}>
                    <div className="pt-3">
                      <label className="block text-xs font-medium text-slate-400 mb-1">
                        実績値 <span className="text-red-400">*</span>
                        {kpi.unit && <span className="text-slate-600 ml-1">({kpi.unit})</span>}
                      </label>
                      <input
                        type="number"
                        value={entry.value}
                        onChange={(e) => updateEntry(i, "value", e.target.value)}
                        className={inputClass}
                        style={inputStyle}
                        placeholder="実績値を入力"
                        step="any"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">コメント（任意）</label>
                      <textarea
                        value={entry.comment}
                        onChange={(e) => updateEntry(i, "comment", e.target.value)}
                        rows={2}
                        className={inputClass}
                        style={inputStyle}
                        placeholder="変動要因や補足事項があれば記入してください"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || enabledEntries.length === 0}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {submitting ? "送信中..." : `${enabledEntries.length}件の実績を報告する`}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 inline-flex items-center transition-colors duration-200"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
