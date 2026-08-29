"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// ─── 型 ──────────────────────────────────────────────────────────────────────

type AchievementCondition = "lte" | "lt" | "gte" | "gt" | "eq";

interface Kpi {
  id: string;
  label: string;
  target: number;
  unit: string;
  achievement_condition: AchievementCondition | null;
  target_deadline: string | null;
  goal_id: string | null;
  goal_title: string | null;
}

interface GapRecord {
  id: string;
  kpi_id: string | null;
  indicator_name: string;
  current_value: number | null;
  target_value: number;
  gap_value: number | null;
  data_source: string;
  priority_score: number | null;
  ai_analysis: string | null;
  updated_at: string;
}

interface Props {
  project: { id: string; title: string };
  kpis: Kpi[];
  initialGaps: GapRecord[];
  projectId: string;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const CONDITION_LABEL: Record<AchievementCondition, string> = {
  gte: "以上", gt: "超", lte: "以下", lt: "未満", eq: "達成",
};

function condLabel(c: AchievementCondition | null) {
  return c ? CONDITION_LABEL[c] : "以上";
}

/** "YYYY-MM-DD" → "YYYY年M月" */
function fmtDeadline(d: string | null) {
  if (!d) return null;
  const [y, m] = d.split("-");
  return `${y}年${parseInt(m ?? "1", 10)}月`;
}

// ─── ギャップ計算 ─────────────────────────────────────────────────────────────

function calcDisplay(kpi: Kpi, current: number | null) {
  if (current === null || current === undefined) return null;
  const cond = kpi.achievement_condition ?? "gte";
  let gapValue: number;
  let achieved: boolean;

  if (cond === "lte" || cond === "lt") {
    gapValue = current - kpi.target;
    achieved = cond === "lte" ? current <= kpi.target : current < kpi.target;
  } else {
    gapValue = kpi.target - current;
    achieved = cond === "eq" ? current === kpi.target
      : cond === "gt" ? current > kpi.target
      : current >= kpi.target;
  }

  const achievementRate = kpi.target !== 0
    ? Math.round((current / kpi.target) * 1000) / 10
    : null;

  return { gapValue, achieved, achievementRate };
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function GapAnalysisClient({ project, kpis, initialGaps, projectId }: Props) {
  // 現状値マップ（kpi_id → 入力値文字列）
  const [currentValues, setCurrentValues] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const gap of initialGaps) {
      if (gap.kpi_id && gap.current_value != null) {
        m[gap.kpi_id] = String(gap.current_value);
      }
    }
    return m;
  });

  // データ取得元ヒント（kpi_id → source文字列）
  const [sourceHints, setSourceHints] = useState<Record<string, string>>({});

  // ギャップ分析結果（kpi_id → GapRecord）
  const [gapMap, setGapMap] = useState<Record<string, GapRecord>>(() => {
    const m: Record<string, GapRecord> = {};
    for (const gap of initialGaps) {
      if (gap.kpi_id) m[gap.kpi_id] = gap;
    }
    return m;
  });

  // 現状整理（As-Is）のKPIごとのステータス（kpi_id → 状態）
  const [asisStatus, setAsisStatus] = useState<
    Record<string, { asis_id: string; status: string; current_step: string }>
  >({});
  // 課題仮説設定のKPIごとのステータス（kpi_id → 状態）
  const [issueStatus, setIssueStatus] = useState<
    Record<string, { dialogue_id: string; status: string; current_step: string }>
  >({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/projects/${projectId}/asis-analysis?byKpi=true`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: {
            statuses: { kpi_id: string; asis_id: string; status: string; current_step: string }[];
          } | null;
          error: string | null;
        };
        if (cancelled || !json.data) return;
        const map: Record<string, { asis_id: string; status: string; current_step: string }> = {};
        for (const s of json.data.statuses) {
          map[s.kpi_id] = { asis_id: s.asis_id, status: s.status, current_step: s.current_step };
        }
        setAsisStatus(map);
      } catch {
        /* 取得失敗時はボタン未実施扱い */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/projects/${projectId}/issue-dialogue?byKpi=true`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: {
            statuses: {
              kpi_id: string;
              dialogue_id: string;
              status: string;
              current_step: string;
            }[];
          } | null;
          error: string | null;
        };
        if (cancelled || !json.data) return;
        const map: Record<
          string,
          { dialogue_id: string; status: string; current_step: string }
        > = {};
        for (const s of json.data.statuses) {
          map[s.kpi_id] = {
            dialogue_id: s.dialogue_id,
            status: s.status,
            current_step: s.current_step,
          };
        }
        setIssueStatus(map);
      } catch {
        /* 取得失敗時はボタン未実施扱い */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState<Record<string, boolean>>({});
  const [bulkAnalyzeLoading, setBulkAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeSuccess, setAnalyzeSuccess] = useState<string | null>(null);

  const setCurrentValue = (kpiId: string, val: string) =>
    setCurrentValues((p) => ({ ...p, [kpiId]: val }));

  // ─── データセットから現状値を取得 ──────────────────────────────────────────

  const handleSuggestValues = async () => {
    setSuggestLoading(true);
    setSuggestError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/gap-analysis/suggest-values`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        data: Array<{ kpi_id: string; current_value: number | null; source: string | null }> | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setSuggestError(json.error ?? "取得に失敗しました");
        return;
      }
      const newValues: Record<string, string> = { ...currentValues };
      const newHints: Record<string, string> = { ...sourceHints };
      for (const item of json.data) {
        if (item.current_value != null) {
          newValues[item.kpi_id] = String(item.current_value);
          if (item.source) newHints[item.kpi_id] = item.source;
        }
      }
      setCurrentValues(newValues);
      setSourceHints(newHints);
    } catch {
      setSuggestError("通信エラーが発生しました");
    } finally {
      setSuggestLoading(false);
    }
  };

  // ─── 分析実行（個別 or 一括）────────────────────────────────────────────────

  const runAnalyze = async (kpiId?: string) => {
    setAnalyzeError(null);
    setAnalyzeSuccess(null);
    if (kpiId) {
      setAnalyzeLoading((p) => ({ ...p, [kpiId]: true }));
    } else {
      setBulkAnalyzeLoading(true);
    }

    try {
      const targetKpis = kpiId ? [kpiId] : kpis.map((k) => k.id);
      const current_values = targetKpis
        .filter((id) => currentValues[id] !== undefined && currentValues[id] !== "")
        .map((id) => ({
          kpi_id: id,
          current_value: parseFloat(currentValues[id]!),
          data_source: sourceHints[id] ?? "手入力",
        }));

      if (current_values.length === 0) {
        setAnalyzeError("現状値を入力してください");
        return;
      }

      const res = await fetch(`/api/admin/projects/${projectId}/gap-analysis/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpi_id: kpiId, current_values }),
      });
      const json = (await res.json()) as {
        data: Array<{ kpi_id: string; gap_id: string; gapValue: number; achieved: boolean; priorityScore: number; achievementRate: number | null }> | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setAnalyzeError(json.error ?? "分析に失敗しました");
        return;
      }

      // ローカル state 更新
      setGapMap((prev) => {
        const next = { ...prev };
        for (const r of json.data!) {
          const cv = parseFloat(currentValues[r.kpi_id] ?? "0");
          const kpi = kpis.find((k) => k.id === r.kpi_id);
          if (!kpi) continue;
          next[r.kpi_id] = {
            ...(prev[r.kpi_id] ?? {
              id: r.gap_id, kpi_id: r.kpi_id,
              indicator_name: kpi.label,
              target_value: kpi.target,
              data_source: sourceHints[r.kpi_id] ?? "手入力",
              updated_at: new Date().toISOString(),
            }),
            id: r.gap_id,
            current_value: cv,
            gap_value: r.gapValue,
            priority_score: r.priorityScore,
            ai_analysis: r.achieved
              ? `${kpi.label}は目標（${kpi.target}${kpi.unit}${condLabel(kpi.achievement_condition)}）を達成しています。`
              : `${kpi.label}は現状${cv}${kpi.unit}で、目標まで${Math.abs(r.gapValue).toFixed(1)}${kpi.unit}のギャップがあります。`,
            target_value: kpi.target,
          };
        }
        return next;
      });

      const count = json.data.length;
      setAnalyzeSuccess(`✓ ${count}件の指標を分析しました`);
      setTimeout(() => setAnalyzeSuccess(null), 3000);
    } catch {
      setAnalyzeError("通信エラーが発生しました");
    } finally {
      if (kpiId) setAnalyzeLoading((p) => ({ ...p, [kpiId]: false }));
      else setBulkAnalyzeLoading(false);
    }
  };

  // ─── 優先度カラー ─────────────────────────────────────────────────────────────

  function priorityColor(score: number | null) {
    if (score === null) return "var(--text-secondary)";
    if (score >= 70) return "#ef4444";
    if (score >= 40) return "#f59e0b";
    return "#10b981";
  }

  function gapColor(gap: GapRecord | undefined, kpi: Kpi, currentStr: string) {
    if (!currentStr) return "var(--text-secondary)";
    const current = parseFloat(currentStr);
    const result = calcDisplay(kpi, current);
    if (!result) return "var(--text-secondary)";
    return result.achieved ? "#10b981" : "#ef4444";
  }

  // ─── KPI未設定 ──────────────────────────────────────────────────────────────

  if (kpis.length === 0) {
    return (
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
          ギャップ分析
        </h2>
        <div className="neu-card p-8 text-center space-y-3">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            ギャップ分析を行うには、まず計画概要で長期目標（KPI）を設定してください。
          </p>
          <Link
            href={`/projects/${projectId}`}
            className="inline-block text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            計画概要で目標を設定する →
          </Link>
        </div>
      </div>
    );
  }

  // ─── メイン画面 ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl space-y-6">

      {/* ヘッダー */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            ギャップ分析
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            計画の長期目標指標について、現状値を入力しギャップを分析します
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSuggestValues}
            disabled={suggestLoading}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl border transition-colors hover:border-cyan-400 hover:text-cyan-400 disabled:opacity-40"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            {suggestLoading ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            ) : "📊"}
            データセットから現状値を取得
          </button>
          <div className="neu-button-wrap">
            <button
              type="button"
              onClick={() => runAnalyze()}
              disabled={bulkAnalyzeLoading}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              {bulkAnalyzeLoading ? (
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : "▶"}
              全指標を一括分析
            </button>
          </div>
        </div>
      </div>

      {/* エラー・成功メッセージ */}
      {suggestError && (
        <div className="text-sm text-red-400 bg-red-400/10 px-4 py-2 rounded-lg">{suggestError}</div>
      )}
      {analyzeError && (
        <div className="text-sm text-red-400 bg-red-400/10 px-4 py-2 rounded-lg">{analyzeError}</div>
      )}
      {analyzeSuccess && (
        <div className="text-sm text-emerald-400 bg-emerald-400/10 px-4 py-2 rounded-lg">{analyzeSuccess}</div>
      )}

      {/* KPIテーブル */}
      <div className="neu-card overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--border)" }}>
              {["指標名", "目標値", "現状値", "ギャップ", "達成率", "優先度", "現状整理", "課題仮説", ""].map((h) => (
                <th key={h} className="text-left text-xs font-semibold px-4 py-3"
                  style={{ color: "var(--text-secondary)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kpis.map((kpi, idx) => {
              const currentStr = currentValues[kpi.id] ?? "";
              const current = currentStr !== "" ? parseFloat(currentStr) : null;
              const display = calcDisplay(kpi, current);
              const gap = gapMap[kpi.id];
              const isAnalyzing = analyzeLoading[kpi.id] ?? false;

              const deadlineStr = fmtDeadline(kpi.target_deadline);
              const targetLabel = `${kpi.target}${kpi.unit} ${condLabel(kpi.achievement_condition)}`;

              return (
                <tr key={kpi.id}
                  className="border-b transition-colors"
                  style={{
                    borderColor: "var(--border)",
                    background: idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-input)",
                  }}>

                  {/* 指標名 */}
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {kpi.label}
                      </p>
                      {kpi.goal_title && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {kpi.goal_title}
                        </p>
                      )}
                      {deadlineStr && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          期限: {deadlineStr}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* 目標値 */}
                  <td className="px-4 py-3">
                    <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                      {targetLabel}
                    </span>
                  </td>

                  {/* 現状値（入力） */}
                  <td className="px-4 py-3">
                    <div className="relative">
                      <input
                        type="number"
                        value={currentStr}
                        onChange={(e) => setCurrentValue(kpi.id, e.target.value)}
                        className="neu-input text-sm w-28"
                        style={{ color: "var(--text-primary)", paddingRight: kpi.unit ? "2rem" : undefined }}
                        placeholder="入力"
                        step="any"
                      />
                      {kpi.unit && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                          style={{ color: "var(--text-secondary)" }}>
                          {kpi.unit}
                        </span>
                      )}
                    </div>
                    {sourceHints[kpi.id] && (
                      <p className="text-xs mt-1 truncate max-w-[8rem]" title={sourceHints[kpi.id]}
                        style={{ color: "var(--text-secondary)" }}>
                        📊 {sourceHints[kpi.id]}
                      </p>
                    )}
                  </td>

                  {/* ギャップ */}
                  <td className="px-4 py-3">
                    {display ? (
                      <span className="text-sm font-semibold"
                        style={{ color: gapColor(gap, kpi, currentStr) }}>
                        {display.achieved ? "✓ 達成" : `${display.gapValue > 0 ? "+" : ""}${display.gapValue.toFixed(1)}${kpi.unit}`}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>—</span>
                    )}
                  </td>

                  {/* 達成率 */}
                  <td className="px-4 py-3">
                    {display?.achievementRate != null ? (
                      <div className="space-y-1">
                        <span className="text-sm font-semibold"
                          style={{ color: display.achieved ? "#10b981" : "var(--text-primary)" }}>
                          {display.achievementRate}%
                        </span>
                        <div className="w-20 h-1.5 rounded-full overflow-hidden"
                          style={{ background: "var(--border)" }}>
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(100, display.achievementRate)}%`,
                              background: display.achieved ? "#10b981" : "#6366f1",
                            }} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>—</span>
                    )}
                  </td>

                  {/* 優先度 */}
                  <td className="px-4 py-3">
                    {gap?.priority_score != null ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{
                          color: priorityColor(gap.priority_score),
                          background: priorityColor(gap.priority_score) + "20",
                          border: `1px solid ${priorityColor(gap.priority_score)}40`,
                        }}>
                        {gap.priority_score}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>—</span>
                    )}
                  </td>

                  {/* 現状整理（As-Is）導線 */}
                  <td className="px-4 py-3">
                    {(() => {
                      const asis = asisStatus[kpi.id];
                      const href = `/projects/${projectId}/asis-analysis?kpiId=${kpi.id}`;
                      if (!asis) {
                        return (
                          <Link
                            href={href}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:border-indigo-400 hover:text-indigo-400"
                            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                          >
                            📝 現状整理
                          </Link>
                        );
                      }
                      if (asis.status === "completed") {
                        return (
                          <Link
                            href={href}
                            className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
                            style={{ color: "#10b981", background: "#10b98120", border: "1px solid #10b98140" }}
                          >
                            ✓ 整理済み
                          </Link>
                        );
                      }
                      return (
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
                          style={{ color: "#f59e0b", background: "#f59e0b20", border: "1px solid #f59e0b40" }}
                        >
                          ⏳ 整理中
                        </Link>
                      );
                    })()}
                  </td>

                  {/* 課題仮説設定の導線（現状整理の次工程） */}
                  <td className="px-4 py-3">
                    {(() => {
                      const issue = issueStatus[kpi.id];
                      const href = `/projects/${projectId}/issue-hypothesis?kpiId=${kpi.id}`;
                      if (!issue) {
                        return (
                          <Link
                            href={href}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:border-indigo-400 hover:text-indigo-400"
                            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                          >
                            💡 課題仮説
                          </Link>
                        );
                      }
                      if (issue.status === "completed") {
                        return (
                          <Link
                            href={href}
                            className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
                            style={{ color: "#10b981", background: "#10b98120", border: "1px solid #10b98140" }}
                          >
                            ✓ 設定済み
                          </Link>
                        );
                      }
                      return (
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
                          style={{ color: "#f59e0b", background: "#f59e0b20", border: "1px solid #f59e0b40" }}
                        >
                          ⏳ 設定中
                        </Link>
                      );
                    })()}
                  </td>

                  {/* 個別分析ボタン */}
                  <td className="px-4 py-3">
                    <div className="neu-button-wrap">
                      <button
                        type="button"
                        onClick={() => runAnalyze(kpi.id)}
                        disabled={isAnalyzing || !currentStr}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed neu-button-primary"
                        style={{ background: "linear-gradient(135deg, #0891b2, #06b6d4)" }}
                      >
                        {isAnalyzing ? (
                          <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : "▶ 分析"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* AIコメント一覧 */}
      {Object.values(gapMap).some((g) => g.ai_analysis) && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}>
            分析コメント
          </h3>
          <div className="space-y-2">
            {kpis.filter((k) => gapMap[k.id]?.ai_analysis).map((kpi) => {
              const gap = gapMap[kpi.id]!;
              return (
                <div key={kpi.id} className="neu-card-inset px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold text-white"
                      style={{ background: gap.priority_score != null && gap.priority_score >= 70 ? "#ef4444" : "#6366f1" }}>
                      {kpi.label.slice(0, 8)}
                    </span>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                      {gap.ai_analysis}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
