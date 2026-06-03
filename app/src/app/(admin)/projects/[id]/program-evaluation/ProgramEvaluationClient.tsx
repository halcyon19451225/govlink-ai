"use client";

import { useState } from "react";
import PermissionGate from "@/components/PermissionGate";
import LogicModelContext from "@/components/LogicModelContext";
import EfficiencyEvaluationPanel from "@/components/program-eval/EfficiencyEvaluationPanel";
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

const STATUS_LABELS: Record<string, string> = {
  draft: "下書き",
  in_review: "審査中",
  approved: "承認済",
};

// 5階層のうち第3〜5階層をタブで表示（設計 §4 / フェーズP4）
const TABS = [
  { key: "process", label: "プロセス評価", tier: "process" as const },
  { key: "outcome", label: "アウトカム・インパクト評価", tier: "outcome" as const },
  { key: "efficiency", label: "効率性評価", tier: "efficiency" as const },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const cardStyle: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };

interface ProcessFormState {
  fiscal_year: number;
  activity: string;
  result: string;
  achievement_rate: string;
  findings: string;
  success_factors: string;
  barrier_factors: string;
  improvement_actions: string;
}

interface OutcomeFormState {
  fiscal_year: number;
  major_policy_name: string;
  result: string;
  achievement_rate: string;
  findings: string;
  next_steps: string;
}

interface DiDFormState {
  treat_pre: string;
  treat_post: string;
  control_pre: string;
  control_post: string;
}

// ---- コンポーネント ----

export default function ProgramEvaluationClient({
  project,
  evaluations: initialEvaluations,
  kpis,
  logicModels,
}: Props) {
  const logicModelId = logicModels[0]?.id ?? null;
  const [activeTab, setActiveTab] = useState<TabKey>("process");
  const [evaluations, setEvaluations] = useState<ProgramEvalRow[]>(initialEvaluations);

  // ロジックモデルの activity 候補
  const activities: string[] = (() => {
    const acts = logicModels[0]?.activities as unknown;
    if (Array.isArray(acts)) return (acts as unknown[]).map((a) => String(a));
    if (acts && typeof acts === "object") {
      const obj = acts as Record<string, unknown>;
      const arr = obj["items"] ?? obj["list"] ?? obj["activities"];
      if (Array.isArray(arr)) return (arr as unknown[]).map((a) => String(a));
    }
    return [];
  })();

  // プロセス評価フォーム
  const [proc, setProc] = useState<ProcessFormState>({
    fiscal_year: new Date().getFullYear(),
    activity: "",
    result: "",
    achievement_rate: "",
    findings: "",
    success_factors: "",
    barrier_factors: "",
    improvement_actions: "",
  });
  const [procSubmitting, setProcSubmitting] = useState(false);
  const [procError, setProcError] = useState<string | null>(null);

  // アウトカム評価フォーム
  const [out, setOut] = useState<OutcomeFormState>({
    fiscal_year: new Date().getFullYear(),
    major_policy_name: logicModels[0]?.major_policy ?? "",
    result: "",
    achievement_rate: "",
    findings: "",
    next_steps: "",
  });
  const [outSubmitting, setOutSubmitting] = useState(false);
  const [outError, setOutError] = useState<string | null>(null);

  // 統計分析モーダル
  const [prePostResult, setPrePostResult] = useState<ReturnType<typeof calcPrePost> | null>(null);
  const [showPrePostModal, setShowPrePostModal] = useState(false);
  const [showDidModal, setShowDidModal] = useState(false);
  const [didForm, setDidForm] = useState<DiDFormState>({ treat_pre: "", treat_post: "", control_pre: "", control_post: "" });
  const [didResult, setDidResult] = useState<ReturnType<typeof calcDiffInDiff> | null>(null);

  const kpisWithPrev = kpis.filter((k) => k.previous_value !== null);

  // ---- 保存共通 ----
  const postEvaluation = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch(`/api/admin/projects/${project.id}/evaluations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data: ProgramEvalRow | null; error: string | null };
    if (!res.ok || json.error) throw new Error(json.error ?? "保存に失敗しました");
    if (json.data) setEvaluations((prev) => [...prev, json.data!]);
    return true;
  };

  const handleProcSave = async () => {
    setProcSubmitting(true);
    setProcError(null);
    try {
      await postEvaluation({
        evaluation_tier: "process",
        fiscal_year: proc.fiscal_year,
        status: "draft",
        logic_model_id: logicModelId,
        result: proc.result || null,
        achievement_rate: proc.achievement_rate ? parseFloat(proc.achievement_rate) : null,
        findings: proc.findings || null,
        success_factors: proc.success_factors || null,
        barrier_factors: proc.barrier_factors || null,
        improvement_actions: proc.improvement_actions || null,
        flow_decision_path: { tier: "process", activity: proc.activity },
      });
      setProc({
        fiscal_year: new Date().getFullYear(),
        activity: "",
        result: "",
        achievement_rate: "",
        findings: "",
        success_factors: "",
        barrier_factors: "",
        improvement_actions: "",
      });
    } catch (e) {
      setProcError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setProcSubmitting(false);
    }
  };

  const handleOutSave = async () => {
    setOutSubmitting(true);
    setOutError(null);
    try {
      await postEvaluation({
        evaluation_tier: "outcome",
        fiscal_year: out.fiscal_year,
        status: "draft",
        logic_model_id: logicModelId,
        result: out.result || null,
        achievement_rate: out.achievement_rate ? parseFloat(out.achievement_rate) : null,
        findings: out.findings || null,
        next_steps: out.next_steps || null,
        flow_decision_path: { tier: "outcome", major_policy_name: out.major_policy_name },
      });
      setOut({
        fiscal_year: new Date().getFullYear(),
        major_policy_name: logicModels[0]?.major_policy ?? "",
        result: "",
        achievement_rate: "",
        findings: "",
        next_steps: "",
      });
    } catch (e) {
      setOutError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setOutSubmitting(false);
    }
  };

  const handlePrePost = () => {
    const data = kpisWithPrev.map((k) => ({ label: k.label, pre: k.previous_value!, post: k.current }));
    if (data.length === 0) return;
    setPrePostResult(calcPrePost(data));
    setShowPrePostModal(true);
  };

  const handleDid = () => {
    const tp = parseFloat(didForm.treat_pre);
    const tpo = parseFloat(didForm.treat_post);
    const cp = parseFloat(didForm.control_pre);
    const cpo = parseFloat(didForm.control_post);
    if ([tp, tpo, cp, cpo].some((v) => isNaN(v))) return;
    setDidResult(calcDiffInDiff({ treat_pre: tp, treat_post: tpo, control_pre: cp, control_post: cpo }));
  };

  // ---- 該当 tier の保存済み評価一覧 ----
  const tierEvaluations = (tiers: string[]) =>
    evaluations.filter((e) => tiers.includes(e.evaluation_tier));

  const EvalTable = ({ rows }: { rows: ProgramEvalRow[] }) =>
    rows.length === 0 ? (
      <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
        <p className="text-sm text-slate-500">保存済みの評価レコードはありません。</p>
      </div>
    ) : (
      <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-input)" }}>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">対象年度</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">結果</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">達成率</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">ステータス</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">作成日</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ev) => (
              <tr key={ev.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-4 py-3 text-slate-300">{ev.fiscal_year ? `${ev.fiscal_year}年度` : "—"}</td>
                <td className="px-4 py-3 text-slate-300 max-w-xs"><p className="truncate">{ev.result ?? "—"}</p></td>
                <td className="px-4 py-3 text-slate-300">{ev.achievement_rate != null ? `${ev.achievement_rate}%` : "—"}</td>
                <td className="px-4 py-3 text-slate-400">{STATUS_LABELS[ev.status] ?? ev.status}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{ev.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div>
      {/* タブ */}
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: "var(--border)" }}>
        {TABS.map((tab) => (
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
          </button>
        ))}
      </div>

      {/* ===== プロセス評価タブ（第3階層） ===== */}
      {activeTab === "process" && (
        <div className="space-y-6">
          <LogicModelContext projectId={project.id} logicModelId={logicModelId} tier="process" />

          <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
            <h3 className="text-sm font-semibold text-slate-200">プロセス評価の記録</h3>
            <p className="text-xs text-slate-500">ロジックモデルの活動が意図どおり実施されたか、実施状況・課題を記録します。</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
                <input type="number" value={proc.fiscal_year} onChange={(e) => setProc((p) => ({ ...p, fiscal_year: parseInt(e.target.value, 10) || p.fiscal_year }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">評価対象の活動</label>
                {activities.length > 0 ? (
                  <select value={proc.activity} onChange={(e) => setProc((p) => ({ ...p, activity: e.target.value }))} className={inputClass} style={inputStyle}>
                    <option value="">— 選択してください —</option>
                    {activities.map((a, i) => <option key={i} value={a}>{a}</option>)}
                  </select>
                ) : (
                  <input type="text" value={proc.activity} onChange={(e) => setProc((p) => ({ ...p, activity: e.target.value }))} className={inputClass} style={inputStyle} placeholder="活動名" />
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">実施状況・評価結果</label>
              <textarea value={proc.result} onChange={(e) => setProc((p) => ({ ...p, result: e.target.value }))} className={inputClass} style={inputStyle} rows={3} placeholder="活動が計画どおり実施されたか記述" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">達成率 (%)</label>
                <input type="number" min={0} max={100} value={proc.achievement_rate} onChange={(e) => setProc((p) => ({ ...p, achievement_rate: e.target.value }))} className={inputClass} style={inputStyle} placeholder="0〜100" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">発見事項</label>
                <input type="text" value={proc.findings} onChange={(e) => setProc((p) => ({ ...p, findings: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">成功要因</label>
                <textarea value={proc.success_factors} onChange={(e) => setProc((p) => ({ ...p, success_factors: e.target.value }))} className={inputClass} style={inputStyle} rows={2} />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">障壁要因</label>
                <textarea value={proc.barrier_factors} onChange={(e) => setProc((p) => ({ ...p, barrier_factors: e.target.value }))} className={inputClass} style={inputStyle} rows={2} />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">改善アクション</label>
              <textarea value={proc.improvement_actions} onChange={(e) => setProc((p) => ({ ...p, improvement_actions: e.target.value }))} className={inputClass} style={inputStyle} rows={2} />
            </div>

            {procError && <p className="text-xs text-red-400">{procError}</p>}
            <PermissionGate module="program_evaluation" level="edit" projectId={project.id}>
              <div className="neu-button-wrap">
                <button type="button" onClick={() => void handleProcSave()} disabled={procSubmitting}
                className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-50 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
                {procSubmitting ? "保存中..." : "プロセス評価を保存"}
              </button>
              </div>
            </PermissionGate>
          </div>

          <EvalTable rows={tierEvaluations(["process"])} />
        </div>
      )}

      {/* ===== アウトカム・インパクト評価タブ（第4階層） ===== */}
      {activeTab === "outcome" && (
        <div className="space-y-6">
          <LogicModelContext projectId={project.id} logicModelId={logicModelId} tier="outcome" />

          <div className="flex gap-3 flex-wrap">
            {kpisWithPrev.length > 0 && (
              <button type="button" onClick={handlePrePost}
                className="text-sm font-medium px-4 py-2 rounded-xl border text-slate-300 hover:border-indigo-500/40 hover:text-indigo-400 transition-colors"
                style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
                前後比較分析
              </button>
            )}
            <button type="button" onClick={() => { setShowDidModal(true); setDidResult(null); }}
              className="text-sm font-medium px-4 py-2 rounded-xl border text-slate-300 hover:border-cyan-500/40 hover:text-cyan-400 transition-colors"
              style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
              DiD分析
            </button>
          </div>

          <div className="rounded-2xl border p-6 space-y-4" style={cardStyle}>
            <h3 className="text-sm font-semibold text-slate-200">アウトカム・インパクト評価の記録</h3>
            <p className="text-xs text-slate-500">ロジックモデルの成果（初期・中間アウトカム）の達成状況を記録します。</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">主要施策名</label>
                <input type="text" value={out.major_policy_name} onChange={(e) => setOut((p) => ({ ...p, major_policy_name: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">対象年度</label>
                <input type="number" value={out.fiscal_year} onChange={(e) => setOut((p) => ({ ...p, fiscal_year: parseInt(e.target.value, 10) || p.fiscal_year }))} className={inputClass} style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">評価結果</label>
              <textarea value={out.result} onChange={(e) => setOut((p) => ({ ...p, result: e.target.value }))} className={inputClass} style={inputStyle} rows={3} placeholder="成果指標の達成状況を記述" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">達成率 (%)</label>
                <input type="number" min={0} max={100} value={out.achievement_rate} onChange={(e) => setOut((p) => ({ ...p, achievement_rate: e.target.value }))} className={inputClass} style={inputStyle} placeholder="0〜100" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">発見事項</label>
                <input type="text" value={out.findings} onChange={(e) => setOut((p) => ({ ...p, findings: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">次のステップ</label>
              <textarea value={out.next_steps} onChange={(e) => setOut((p) => ({ ...p, next_steps: e.target.value }))} className={inputClass} style={inputStyle} rows={2} />
            </div>

            {outError && <p className="text-xs text-red-400">{outError}</p>}
            <PermissionGate module="program_evaluation" level="edit" projectId={project.id}>
              <div className="neu-button-wrap">
                <button type="button" onClick={() => void handleOutSave()} disabled={outSubmitting}
                className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-50 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
                {outSubmitting ? "保存中..." : "アウトカム評価を保存"}
              </button>
              </div>
            </PermissionGate>
          </div>

          <EvalTable rows={tierEvaluations(["outcome", "outcome_initial", "outcome_intermediate"])} />
        </div>
      )}

      {/* ===== 効率性評価タブ（第5階層） ===== */}
      {activeTab === "efficiency" && (
        <div className="space-y-6">
          <LogicModelContext projectId={project.id} logicModelId={logicModelId} tier="efficiency" />
          <EfficiencyEvaluationPanel projectId={project.id} />
        </div>
      )}

      {/* 前後比較モーダル */}
      {showPrePostModal && prePostResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShowPrePostModal(false)}>
          <div className="rounded-2xl border w-full max-w-lg p-6 space-y-4 neu-card" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-200">前後比較分析</h3>
            <p className="text-sm text-indigo-400 font-medium">{prePostResult.interpretation}</p>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="text-left py-2 text-slate-500">指標</th>
                  <th className="text-right py-2 text-slate-500">事前</th>
                  <th className="text-right py-2 text-slate-500">事後</th>
                  <th className="text-right py-2 text-slate-500">変化</th>
                  <th className="text-right py-2 text-slate-500">変化率</th>
                </tr>
              </thead>
              <tbody>
                {prePostResult.items.map((it, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
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
            <button type="button" onClick={() => setShowPrePostModal(false)}
              className="w-full text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200 transition-colors" style={{ borderColor: "var(--border)" }}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* DiDモーダル */}
      {showDidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShowDidModal(false)}>
          <div className="rounded-2xl border w-full max-w-lg p-6 space-y-4 neu-card" style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-200">差分の差分（DiD）分析</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "treat_pre", label: "介入群 事前" },
                { key: "treat_post", label: "介入群 事後" },
                { key: "control_pre", label: "対照群 事前" },
                { key: "control_post", label: "対照群 事後" },
              ] as const).map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                  <input type="number" value={didForm[key]} onChange={(e) => setDidForm((p) => ({ ...p, [key]: e.target.value }))} className={inputClass} style={inputStyle} placeholder="0" />
                </div>
              ))}
            </div>
            <div className="neu-button-wrap w-full">
              <button type="button" onClick={handleDid}
              className="w-full text-sm font-semibold px-4 py-2 rounded-xl text-white neu-button-primary" style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
              計算
            </button>
            </div>
            {didResult && (
              <div className="space-y-3">
                <div className="rounded-xl border p-3 space-y-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
                  <p className="text-indigo-400 font-semibold">{didResult.interpretation}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-slate-500">介入群変化</p><p className="text-slate-200 font-mono">{didResult.treat_diff.toFixed(4)}</p></div>
                    <div><p className="text-slate-500">対照群変化</p><p className="text-slate-200 font-mono">{didResult.control_diff.toFixed(4)}</p></div>
                    <div>
                      <p className="text-slate-500">DiD推定量</p>
                      <p className="font-mono font-bold" style={{ color: didResult.did_estimate >= 0 ? "#10b981" : "#ef4444" }}>{didResult.did_estimate.toFixed(4)}</p>
                    </div>
                  </div>
                </div>
                <StatCalcStepsPanel steps={didResult.calculationSteps} title="計算ステップ" />
              </div>
            )}
            <button type="button" onClick={() => setShowDidModal(false)}
              className="w-full text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200 transition-colors" style={{ borderColor: "var(--border)" }}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
