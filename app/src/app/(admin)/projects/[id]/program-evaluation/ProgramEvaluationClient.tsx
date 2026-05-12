"use client";

import PermissionGate from "@/components/PermissionGate";

import { useState } from "react";
import { calcPrePost } from "@/lib/stats/pre-post-comparison";
import { calcDiffInDiff } from "@/lib/stats/diff-in-diff";
import StatCalcStepsPanel from "@/components/stats/StatCalcStepsPanel";

// ---- 型定義 ----

interface ProgramEvalRow {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  status: string;
  result: string | null;
  achievement_rate: number | null;
  findings: string | null;
  kpi_ids: string[] | null;
  flow_decision_path: unknown;
  created_at: string;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
  previous_value: number | null;
}

interface LogicModelRow {
  id: string;
  activities: unknown;
  major_policy: string | null;
}

interface Props {
  project: { id: string; title: string };
  evaluations: ProgramEvalRow[];
  kpis: KpiRow[];
  logicModels: LogicModelRow[];
}

// ---- 定数 ----

const TIER_LABELS: Record<string, string> = {
  needs: "ニーズ評価",
  theory: "セオリー評価",
  process: "プロセス評価",
  outcome: "アウトカム評価",
  cost: "コスト評価",
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft: { bg: "#64748b15", text: "#94a3b8", border: "#64748b30" },
  in_review: { bg: "#f59e0b15", text: "#fbbf24", border: "#f59e0b30" },
  approved: { bg: "#10b98115", text: "#34d399", border: "#10b98130" },
};

const TABS = ["評価タイムライン", "図6: 年次評価ウィザード", "図7: 3年目評価ウィザード"] as const;
type Tab = (typeof TABS)[number];

const cardStyle: React.CSSProperties = { background: "#1a1d27", borderColor: "#2a2d3a" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle: React.CSSProperties = { background: "#161922", borderColor: "#2a2d3a" };

// ---- DiD入力フォーム ----

interface DiDFormState {
  treat_pre: string;
  treat_post: string;
  control_pre: string;
  control_post: string;
}

// ---- メインコンポーネント ----

export default function ProgramEvaluationClient({
  project,
  evaluations: initialEvaluations,
  kpis,
  logicModels,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(TABS[0]);
  const [evaluations, setEvaluations] = useState<ProgramEvalRow[]>(initialEvaluations);

  // 前後比較モーダル
  const [prePostResult, setPrePostResult] = useState<ReturnType<typeof calcPrePost> | null>(null);
  const [showPrePostModal, setShowPrePostModal] = useState(false);

  // DiD モーダル
  const [showDidModal, setShowDidModal] = useState(false);
  const [didForm, setDidForm] = useState<DiDFormState>({
    treat_pre: "",
    treat_post: "",
    control_pre: "",
    control_post: "",
  });
  const [didResult, setDidResult] = useState<ReturnType<typeof calcDiffInDiff> | null>(null);

  // 図6ウィザード
  const [fig6Step, setFig6Step] = useState(1);
  const [fig6, setFig6] = useState({
    fiscal_year: new Date().getFullYear(),
    activity: "",
    evaluation_tier: "process" as "process" | "outcome",
    result: "",
    achievement_rate: "",
    findings: "",
    success_factors: "",
    barrier_factors: "",
    improvement_actions: "",
  });
  const [fig6Submitting, setFig6Submitting] = useState(false);
  const [fig6Error, setFig6Error] = useState<string | null>(null);

  // 図7ウィザード
  const [fig7Step, setFig7Step] = useState(1);
  const [fig7, setFig7] = useState({
    major_policy_name: logicModels[0]?.major_policy ?? "",
    fiscal_year: new Date().getFullYear(),
    result: "",
    achievement_rate: "",
    findings: "",
    next_steps: "",
  });
  const [fig7Submitting, setFig7Submitting] = useState(false);
  const [fig7Error, setFig7Error] = useState<string | null>(null);

  // ---- ロジックモデルのactivity一覧 ----
  const activities: string[] = (() => {
    const lm = logicModels[0];
    if (!lm?.activities) return [];
    const acts = lm.activities as unknown;
    if (Array.isArray(acts)) return (acts as unknown[]).map((a) => String(a));
    if (typeof acts === "object" && acts !== null) {
      const obj = acts as Record<string, unknown>;
      const arr = obj["items"] ?? obj["list"] ?? obj["activities"];
      if (Array.isArray(arr)) return (arr as unknown[]).map((a) => String(a));
    }
    return [];
  })();

  // ---- 前後比較ハンドラ ----
  const handlePrePost = () => {
    const data = kpis
      .filter((k) => k.previous_value !== null)
      .map((k) => ({
        label: k.label,
        pre: k.previous_value!,
        post: k.current,
      }));
    if (data.length === 0) return;
    setPrePostResult(calcPrePost(data));
    setShowPrePostModal(true);
  };

  // ---- DiD ハンドラ ----
  const handleDid = () => {
    const tp = parseFloat(didForm.treat_pre);
    const tpo = parseFloat(didForm.treat_post);
    const cp = parseFloat(didForm.control_pre);
    const cpo = parseFloat(didForm.control_post);
    if ([tp, tpo, cp, cpo].some((v) => isNaN(v))) return;
    setDidResult(
      calcDiffInDiff({
        treat_pre: tp,
        treat_post: tpo,
        control_pre: cp,
        control_post: cpo,
      }),
    );
  };

  // ---- 図6保存 ----
  const handleFig6Save = async () => {
    setFig6Submitting(true);
    setFig6Error(null);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: fig6.evaluation_tier,
          fiscal_year: fig6.fiscal_year,
          status: "draft",
          result: fig6.result || null,
          achievement_rate: fig6.achievement_rate ? parseFloat(fig6.achievement_rate) : null,
          findings: fig6.findings || null,
          success_factors: fig6.success_factors || null,
          barrier_factors: fig6.barrier_factors || null,
          improvement_actions: fig6.improvement_actions || null,
          flow_decision_path: {
            wizard: "figure6",
            steps: [
              { step: 1, fiscal_year: fig6.fiscal_year, activity: fig6.activity, evaluation_tier: fig6.evaluation_tier },
              { step: 2, result: fig6.result, achievement_rate: fig6.achievement_rate, findings: fig6.findings },
              { step: 3, success_factors: fig6.success_factors, barrier_factors: fig6.barrier_factors, improvement_actions: fig6.improvement_actions },
            ],
          },
        }),
      });
      const json = (await res.json()) as { data: ProgramEvalRow | null; error: string | null };
      if (!res.ok || json.error) {
        setFig6Error(json.error ?? "保存に失敗しました");
        return;
      }
      if (json.data) setEvaluations((prev) => [...prev, json.data!]);
      // リセット
      setFig6Step(1);
      setFig6({
        fiscal_year: new Date().getFullYear(),
        activity: "",
        evaluation_tier: "process",
        result: "",
        achievement_rate: "",
        findings: "",
        success_factors: "",
        barrier_factors: "",
        improvement_actions: "",
      });
      setActiveTab("評価タイムライン");
    } catch {
      setFig6Error("ネットワークエラーが発生しました");
    } finally {
      setFig6Submitting(false);
    }
  };

  // ---- 図7保存 ----
  const handleFig7Save = async () => {
    setFig7Submitting(true);
    setFig7Error(null);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_tier: "outcome",
          fiscal_year: fig7.fiscal_year,
          status: "draft",
          result: fig7.result || null,
          achievement_rate: fig7.achievement_rate ? parseFloat(fig7.achievement_rate) : null,
          findings: fig7.findings || null,
          next_steps: fig7.next_steps || null,
          flow_decision_path: {
            wizard: "figure7",
            major_policy_name: fig7.major_policy_name,
          },
        }),
      });
      const json = (await res.json()) as { data: ProgramEvalRow | null; error: string | null };
      if (!res.ok || json.error) {
        setFig7Error(json.error ?? "保存に失敗しました");
        return;
      }
      if (json.data) setEvaluations((prev) => [...prev, json.data!]);
      setFig7Step(1);
      setFig7({
        major_policy_name: logicModels[0]?.major_policy ?? "",
        fiscal_year: new Date().getFullYear(),
        result: "",
        achievement_rate: "",
        findings: "",
        next_steps: "",
      });
      setActiveTab("評価タイムライン");
    } catch {
      setFig7Error("ネットワークエラーが発生しました");
    } finally {
      setFig7Submitting(false);
    }
  };

  const kpisWithPrev = kpis.filter((k) => k.previous_value !== null);

  return (
    <div>
      {/* タブ */}
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: "#2a2d3a" }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-medium transition-colors duration-200 border-b-2 -mb-px"
            style={{
              borderBottomColor: activeTab === tab ? "#6366f1" : "transparent",
              color: activeTab === tab ? "#818cf8" : "#64748b",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* タブ1: 評価タイムライン */}
      {activeTab === "評価タイムライン" && (
        <div className="space-y-6">
          {/* 分析ボタン */}
          <div className="flex gap-3 flex-wrap">
            {kpisWithPrev.length > 0 && (
              <button
                type="button"
                onClick={handlePrePost}
                className="text-sm font-medium px-4 py-2 rounded-xl border transition-colors duration-200 hover:border-indigo-500/40 hover:text-indigo-400 text-slate-300"
                style={{ borderColor: "#2a2d3a", background: "#161922" }}
              >
                前後比較分析
              </button>
            )}
            <button
              type="button"
              onClick={() => { setShowDidModal(true); setDidResult(null); }}
              className="text-sm font-medium px-4 py-2 rounded-xl border transition-colors duration-200 hover:border-cyan-500/40 hover:text-cyan-400 text-slate-300"
              style={{ borderColor: "#2a2d3a", background: "#161922" }}
            >
              DiD分析
            </button>
          </div>

          {/* 評価テーブル */}
          {evaluations.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed p-12 text-center"
              style={{ borderColor: "#2a2d3a" }}
            >
              <p className="text-sm text-slate-500">評価レコードがありません。ウィザードから評価を作成してください。</p>
            </div>
          ) : (
            <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a2d3a", background: "#161922" }}>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">評価階層</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">対象年度</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">結果</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">達成率</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">ステータス</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">作成日</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map((ev) => {
                    const colors = STATUS_COLORS[ev.status] ?? STATUS_COLORS["draft"]!;
                    return (
                      <tr
                        key={ev.id}
                        style={{ borderBottom: "1px solid #2a2d3a" }}
                        className="hover:bg-white/2 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: "#6366f115", color: "#818cf8", border: "1px solid #6366f130" }}
                          >
                            {TIER_LABELS[ev.evaluation_tier] ?? ev.evaluation_tier}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {ev.fiscal_year ? `${ev.fiscal_year}年度` : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-xs">
                          <p className="truncate">{ev.result ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {ev.achievement_rate != null ? `${ev.achievement_rate}%` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
                          >
                            {ev.status === "draft" ? "下書き" : ev.status === "in_review" ? "審査中" : "承認済"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{ev.created_at}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* タブ2: 図6ウィザード */}
      {activeTab === "図6: 年次評価ウィザード" && (
        <div className="max-w-2xl space-y-6">
          {/* ステップインジケーター */}
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                  style={{
                    background: fig6Step >= s ? "#6366f1" : "#2a2d3a",
                    color: fig6Step >= s ? "#fff" : "#64748b",
                  }}
                >
                  {s}
                </div>
                {s < 4 && <div className="w-8 h-px" style={{ background: fig6Step > s ? "#6366f1" : "#2a2d3a" }} />}
              </div>
            ))}
            <span className="text-xs text-slate-500 ml-2">
              {fig6Step === 1 ? "評価対象の選択" : fig6Step === 2 ? "評価実施" : fig6Step === 3 ? "要因分析" : "確認・保存"}
            </span>
          </div>

          <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
            {/* Step 1 */}
            {fig6Step === 1 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 1: 評価対象の選択</h3>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
                  <input
                    type="number"
                    value={fig6.fiscal_year}
                    onChange={(e) => setFig6((p) => ({ ...p, fiscal_year: parseInt(e.target.value, 10) || p.fiscal_year }))}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">評価取組</label>
                  {activities.length > 0 ? (
                    <select
                      value={fig6.activity}
                      onChange={(e) => setFig6((p) => ({ ...p, activity: e.target.value }))}
                      className={inputClass}
                      style={inputStyle}
                    >
                      <option value="">— 選択してください —</option>
                      {activities.map((a, i) => (
                        <option key={i} value={a}>{a}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={fig6.activity}
                      onChange={(e) => setFig6((p) => ({ ...p, activity: e.target.value }))}
                      className={inputClass}
                      style={inputStyle}
                      placeholder="評価取組名を入力"
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">評価階層</label>
                  <div className="flex gap-4">
                    {(["process", "outcome"] as const).map((tier) => (
                      <label key={tier} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="evaluation_tier"
                          value={tier}
                          checked={fig6.evaluation_tier === tier}
                          onChange={() => setFig6((p) => ({ ...p, evaluation_tier: tier }))}
                          className="accent-indigo-500"
                        />
                        <span className="text-sm text-slate-300">{TIER_LABELS[tier]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Step 2 */}
            {fig6Step === 2 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 2: 評価実施</h3>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">評価結果</label>
                  <textarea
                    value={fig6.result}
                    onChange={(e) => setFig6((p) => ({ ...p, result: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={4}
                    placeholder="評価結果を記述してください"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">達成率 (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={fig6.achievement_rate}
                    onChange={(e) => setFig6((p) => ({ ...p, achievement_rate: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="0〜100"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">発見事項</label>
                  <textarea
                    value={fig6.findings}
                    onChange={(e) => setFig6((p) => ({ ...p, findings: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Step 3 */}
            {fig6Step === 3 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 3: 要因分析</h3>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">成功要因</label>
                  <textarea
                    value={fig6.success_factors}
                    onChange={(e) => setFig6((p) => ({ ...p, success_factors: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">障壁要因</label>
                  <textarea
                    value={fig6.barrier_factors}
                    onChange={(e) => setFig6((p) => ({ ...p, barrier_factors: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">改善アクション</label>
                  <textarea
                    value={fig6.improvement_actions}
                    onChange={(e) => setFig6((p) => ({ ...p, improvement_actions: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Step 4 */}
            {fig6Step === 4 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 4: 確認・保存</h3>
                <div className="space-y-2 text-sm rounded-xl border p-4" style={{ borderColor: "#2a2d3a", background: "#161922" }}>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">対象年度</span>
                    <span className="text-slate-200">{fig6.fiscal_year}年度</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">評価取組</span>
                    <span className="text-slate-200">{fig6.activity || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">評価階層</span>
                    <span className="text-slate-200">{TIER_LABELS[fig6.evaluation_tier]}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">評価結果</span>
                    <span className="text-slate-200 line-clamp-2">{fig6.result || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">達成率</span>
                    <span className="text-slate-200">{fig6.achievement_rate ? `${fig6.achievement_rate}%` : "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">成功要因</span>
                    <span className="text-slate-200 line-clamp-2">{fig6.success_factors || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24 shrink-0">障壁要因</span>
                    <span className="text-slate-200 line-clamp-2">{fig6.barrier_factors || "—"}</span>
                  </div>
                </div>
                {fig6Error && <p className="text-xs text-red-400">{fig6Error}</p>}
              </>
            )}

            {/* ナビゲーションボタン */}
            <div className="flex gap-3 pt-2">
              {fig6Step > 1 && (
                <button
                  type="button"
                  onClick={() => setFig6Step((s) => s - 1)}
                  className="flex-1 text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200 transition-colors"
                  style={{ borderColor: "#2a2d3a" }}
                >
                  戻る
                </button>
              )}
              {fig6Step < 4 ? (
                <button
                  type="button"
                  onClick={() => setFig6Step((s) => s + 1)}
                  className="flex-1 text-sm font-semibold px-4 py-2 rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                >
                  次へ
                </button>
              ) : (
                <PermissionGate module="program_evaluation" level="edit" projectId={project.id}>
                  <button
                    type="button"
                    onClick={() => void handleFig6Save()}
                    disabled={fig6Submitting}
                    className="flex-1 text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                  >
                    {fig6Submitting ? "保存中..." : "保存"}
                  </button>
                </PermissionGate>
              )}
            </div>
          </div>
        </div>
      )}

      {/* タブ3: 図7ウィザード */}
      {activeTab === "図7: 3年目評価ウィザード" && (
        <div className="max-w-2xl space-y-6">
          {/* ステップインジケーター */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                  style={{
                    background: fig7Step >= s ? "#6366f1" : "#2a2d3a",
                    color: fig7Step >= s ? "#fff" : "#64748b",
                  }}
                >
                  {s}
                </div>
                {s < 3 && <div className="w-8 h-px" style={{ background: fig7Step > s ? "#6366f1" : "#2a2d3a" }} />}
              </div>
            ))}
            <span className="text-xs text-slate-500 ml-2">
              {fig7Step === 1 ? "対象施策の選択" : fig7Step === 2 ? "中期アウトカム評価" : "確認・保存"}
            </span>
          </div>

          <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
            {/* Step 1 */}
            {fig7Step === 1 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 1: 対象施策の選択</h3>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">主要施策名</label>
                  <input
                    type="text"
                    value={fig7.major_policy_name}
                    onChange={(e) => setFig7((p) => ({ ...p, major_policy_name: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="主要施策名を入力"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
                  <input
                    type="number"
                    value={fig7.fiscal_year}
                    onChange={(e) => setFig7((p) => ({ ...p, fiscal_year: parseInt(e.target.value, 10) || p.fiscal_year }))}
                    className={inputClass}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">評価階層</label>
                  <div
                    className="px-3 py-2 rounded-lg border text-sm text-slate-400"
                    style={{ background: "#161922", borderColor: "#2a2d3a" }}
                  >
                    アウトカム評価（固定）
                  </div>
                </div>
              </>
            )}

            {/* Step 2 */}
            {fig7Step === 2 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 2: 中期アウトカム評価</h3>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">評価結果</label>
                  <textarea
                    value={fig7.result}
                    onChange={(e) => setFig7((p) => ({ ...p, result: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={4}
                    placeholder="中期アウトカムの評価結果を記述してください"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">達成率 (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={fig7.achievement_rate}
                    onChange={(e) => setFig7((p) => ({ ...p, achievement_rate: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="0〜100"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">発見事項</label>
                  <textarea
                    value={fig7.findings}
                    onChange={(e) => setFig7((p) => ({ ...p, findings: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">次のステップ</label>
                  <textarea
                    value={fig7.next_steps}
                    onChange={(e) => setFig7((p) => ({ ...p, next_steps: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    rows={3}
                  />
                </div>
              </>
            )}

            {/* Step 3 */}
            {fig7Step === 3 && (
              <>
                <h3 className="text-sm font-semibold text-slate-200">Step 3: 確認・保存</h3>
                <div className="space-y-2 text-sm rounded-xl border p-4" style={{ borderColor: "#2a2d3a", background: "#161922" }}>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">主要施策名</span>
                    <span className="text-slate-200">{fig7.major_policy_name || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">対象年度</span>
                    <span className="text-slate-200">{fig7.fiscal_year}年度</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">評価階層</span>
                    <span className="text-slate-200">アウトカム評価</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">評価結果</span>
                    <span className="text-slate-200 line-clamp-2">{fig7.result || "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">達成率</span>
                    <span className="text-slate-200">{fig7.achievement_rate ? `${fig7.achievement_rate}%` : "—"}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-28 shrink-0">次のステップ</span>
                    <span className="text-slate-200 line-clamp-2">{fig7.next_steps || "—"}</span>
                  </div>
                </div>
                {fig7Error && <p className="text-xs text-red-400">{fig7Error}</p>}
              </>
            )}

            {/* ナビゲーション */}
            <div className="flex gap-3 pt-2">
              {fig7Step > 1 && (
                <button
                  type="button"
                  onClick={() => setFig7Step((s) => s - 1)}
                  className="flex-1 text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200 transition-colors"
                  style={{ borderColor: "#2a2d3a" }}
                >
                  戻る
                </button>
              )}
              {fig7Step < 3 ? (
                <button
                  type="button"
                  onClick={() => setFig7Step((s) => s + 1)}
                  className="flex-1 text-sm font-semibold px-4 py-2 rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                >
                  次へ
                </button>
              ) : (
                <PermissionGate module="program_evaluation" level="edit" projectId={project.id}>
                  <button
                    type="button"
                    onClick={() => void handleFig7Save()}
                    disabled={fig7Submitting}
                    className="flex-1 text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                  >
                    {fig7Submitting ? "保存中..." : "保存"}
                  </button>
                </PermissionGate>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 前後比較モーダル */}
      {showPrePostModal && prePostResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowPrePostModal(false)}
        >
          <div
            className="rounded-2xl border w-full max-w-lg p-6 space-y-4"
            style={cardStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-200">前後比較分析</h3>
            <p className="text-sm text-indigo-400 font-medium">{prePostResult.interpretation}</p>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid #2a2d3a" }}>
                  <th className="text-left py-2 text-slate-500">指標</th>
                  <th className="text-right py-2 text-slate-500">事前</th>
                  <th className="text-right py-2 text-slate-500">事後</th>
                  <th className="text-right py-2 text-slate-500">変化</th>
                  <th className="text-right py-2 text-slate-500">変化率</th>
                </tr>
              </thead>
              <tbody>
                {prePostResult.items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #2a2d3a22" }}>
                    <td className="py-2 text-slate-300">{it.label}</td>
                    <td className="py-2 text-right text-slate-400">{it.pre}</td>
                    <td className="py-2 text-right text-slate-400">{it.post}</td>
                    <td className="py-2 text-right" style={{ color: it.change >= 0 ? "#10b981" : "#ef4444" }}>
                      {it.change >= 0 ? "+" : ""}{it.change.toFixed(2)}
                    </td>
                    <td className="py-2 text-right" style={{ color: it.changePct >= 0 ? "#10b981" : "#ef4444" }}>
                      {it.changePct >= 0 ? "+" : ""}{it.changePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <StatCalcStepsPanel steps={prePostResult.calculationSteps} title="計算ステップ" />
            <button
              type="button"
              onClick={() => setShowPrePostModal(false)}
              className="w-full text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200 transition-colors"
              style={{ borderColor: "#2a2d3a" }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* DiDモーダル */}
      {showDidModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowDidModal(false)}
        >
          <div
            className="rounded-2xl border w-full max-w-lg p-6 space-y-4"
            style={cardStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-200">差分の差分（DiD）分析</h3>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: "treat_pre", label: "介入群 事前" },
                  { key: "treat_post", label: "介入群 事後" },
                  { key: "control_pre", label: "対照群 事前" },
                  { key: "control_post", label: "対照群 事後" },
                ] as const
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                  <input
                    type="number"
                    value={didForm[key]}
                    onChange={(e) => setDidForm((p) => ({ ...p, [key]: e.target.value }))}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleDid}
              className="w-full text-sm font-semibold px-4 py-2 rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              計算
            </button>
            {didResult && (
              <div className="space-y-3">
                <div className="rounded-xl border p-3 space-y-2 text-sm" style={{ borderColor: "#2a2d3a", background: "#161922" }}>
                  <p className="text-indigo-400 font-semibold">{didResult.interpretation}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">介入群変化</p>
                      <p className="text-slate-200 font-mono">{didResult.treat_diff.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">対照群変化</p>
                      <p className="text-slate-200 font-mono">{didResult.control_diff.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">DiD推定量</p>
                      <p className="font-mono font-bold" style={{ color: didResult.did_estimate >= 0 ? "#10b981" : "#ef4444" }}>
                        {didResult.did_estimate.toFixed(4)}
                      </p>
                    </div>
                  </div>
                </div>
                <StatCalcStepsPanel steps={didResult.calculationSteps} title="計算ステップ" />
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowDidModal(false)}
              className="w-full text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200 transition-colors"
              style={{ borderColor: "#2a2d3a" }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
