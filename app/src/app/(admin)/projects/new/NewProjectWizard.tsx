"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";
import PdcaNav from "@/components/PdcaNav";
import UpgradeModal from "@/components/UpgradeModal";

// ─── Types ───────────────────────────────────────────────────────────────────

interface KpiSuggestion {
  id: string;
  label: string;
  unit: string | null;
  indicator_type: string;
  sort_order: number;
}

interface Template {
  id: string;
  name: string;
  category: string;
  legal_basis: string | null;
  plan_period_years: number | null;
  is_composite: boolean;
  description: string | null;
  is_system: boolean;
  kpi_suggestions: KpiSuggestion[];
}

interface GoalInput {
  title: string;
  description: string;
}

interface KpiInput {
  label: string;
  target: string;
  unit: string;
  goal_index: number | null;
  indicator_type: string;
  previous_value: string;
  previous_target: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  elderly_care: "高齢者介護",
  disability: "障害福祉",
  child: "子育て・教育",
  health: "健康増進",
  urban: "都市計画",
  disaster: "防災",
  environment: "環境",
  education: "教育",
  other: "その他",
};

const INDICATOR_TYPE_LABELS: Record<string, string> = {
  process: "プロセス指標",
  outcome_initial: "初期アウトカム",
  outcome_mid: "中期アウトカム",
  outcome_long: "長期アウトカム",
  efficiency: "効率性指標",
};

const STATUS_OPTIONS = [
  { value: "draft", label: "計画中" },
  { value: "active", label: "実施中" },
  { value: "completed", label: "完了" },
] as const;

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };
const cardStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };

// ─── Step indicators ──────────────────────────────────────────────────────────

const STEP_LABELS = ["テンプレート選択", "基本情報", "基本目標", "KPI設定"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEP_LABELS.map((label, idx) => {
        const num = idx + 1;
        const isActive = num === current;
        const isDone = num < current;
        return (
          <div key={num} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0"
                style={{
                  background: isActive
                    ? "linear-gradient(135deg, #6366f1, #06b6d4)"
                    : isDone
                    ? "#10b981"
                    : "#2a2d3a",
                  color: isActive || isDone ? "#fff" : "#64748b",
                }}
              >
                {isDone ? "✓" : num}
              </div>
              <span
                className="text-xs font-medium hidden sm:inline"
                style={{ color: isActive ? "#e2e8f0" : isDone ? "#10b981" : "#64748b" }}
              >
                {label}
              </span>
            </div>
            {idx < STEP_LABELS.length - 1 && (
              <div className="w-6 h-px mx-1" style={{ background: isDone ? "#10b981" : "#2a2d3a" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Template Selection ──────────────────────────────────────────────

function Step1({
  templates,
  selected,
  onSelect,
  onNext,
}: {
  templates: Template[];
  selected: Template | null;
  onSelect: (t: Template | null) => void;
  onNext: () => void;
}) {
  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    const cat = t.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  const otherTemplate = templates.find((t) => t.category === "other");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">計画テンプレートを選択</h3>
        <p className="text-sm text-slate-500">
          テンプレートを選ぶとKPIの推奨値が自動入力されます。後から変更できます。
        </p>
      </div>

      {Object.entries(grouped)
        .filter(([cat]) => cat !== "other")
        .map(([cat, items]) => (
          <div key={cat}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((t) => {
                const isSelected = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(isSelected ? null : t)}
                    className="rounded-xl border p-4 text-left transition-all duration-200 hover:border-indigo-500/50"
                    style={{
                      background: isSelected ? "#6366f115" : "#1a1d27",
                      borderColor: isSelected ? "#6366f160" : "#2a2d3a",
                      boxShadow: isSelected ? "0 0 0 1px #6366f140" : "none",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-slate-200 leading-snug">{t.name}</span>
                      {isSelected && (
                        <span className="shrink-0 text-xs font-bold text-indigo-400 border rounded px-1.5 py-0.5"
                          style={{ borderColor: "#6366f140", background: "#6366f115" }}>
                          選択中
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>
                    )}
                    <div className="flex gap-3 mt-2">
                      {t.plan_period_years != null && t.plan_period_years > 0 && (
                        <span className="text-xs text-slate-600">{t.plan_period_years}年計画</span>
                      )}
                      {t.is_composite && (
                        <span className="text-xs text-slate-600">複合計画</span>
                      )}
                      {t.kpi_suggestions.length > 0 && (
                        <span className="text-xs text-cyan-700">
                          KPI {t.kpi_suggestions.length}件
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      {/* Free form option */}
      {otherTemplate && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            テンプレートなし
          </p>
          <button
            type="button"
            onClick={() => onSelect(selected?.id === otherTemplate.id ? null : otherTemplate)}
            className="rounded-xl border p-4 text-left transition-all duration-200 w-full hover:border-indigo-500/50"
            style={{
              background: selected?.id === otherTemplate.id ? "#6366f115" : "#1a1d27",
              borderColor: selected?.id === otherTemplate.id ? "#6366f160" : "#2a2d3a",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">{otherTemplate.name}</span>
              {selected?.id === otherTemplate.id && (
                <span className="text-xs font-bold text-indigo-400 border rounded px-1.5 py-0.5"
                  style={{ borderColor: "#6366f140", background: "#6366f115" }}>
                  選択中
                </span>
              )}
            </div>
            {otherTemplate.description && (
              <p className="text-xs text-slate-500 mt-1">{otherTemplate.description}</p>
            )}
          </button>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onNext}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          次へ →
        </button>
        {!selected && (
          <button
            type="button"
            onClick={onNext}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 inline-flex items-center transition-colors duration-200"
          >
            テンプレートなしで続ける
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: Basic Information ────────────────────────────────────────────────

function Step2({
  values,
  onChange,
  onNext,
  onBack,
}: {
  values: {
    title: string; description: string; department: string;
    status: string; planStartDate: string; planEndDate: string;
  };
  onChange: (k: string, v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canNext = values.title.trim().length > 0 && values.department.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">基本情報を入力</h3>
        <p className="text-sm text-slate-500">計画の名称・担当課・期間を設定します。</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          計画名 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          required
          value={values.title}
          onChange={(e) => onChange("title", e.target.value)}
          className={inputClass}
          style={inputStyle}
          placeholder="例: 第8期介護保険事業計画"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">概要</label>
        <textarea
          value={values.description}
          onChange={(e) => onChange("description", e.target.value)}
          rows={3}
          className={inputClass}
          style={inputStyle}
          placeholder="計画の概要・背景を入力してください"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          担当課 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          required
          value={values.department}
          onChange={(e) => onChange("department", e.target.value)}
          className={inputClass}
          style={inputStyle}
          placeholder="例: 高齢福祉課"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">計画開始日</label>
          <input
            type="date"
            value={values.planStartDate}
            onChange={(e) => onChange("planStartDate", e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">計画終了日</label>
          <input
            type="date"
            value={values.planEndDate}
            onChange={(e) => onChange("planEndDate", e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">ステータス</label>
        <select
          value={values.status}
          onChange={(e) => onChange("status", e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ background: "#1a1d27" }}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "#2a2d3a" }}>
          ← 戻る
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          次へ →
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Goals ────────────────────────────────────────────────────────────

function Step3({
  goals,
  planName,
  templateName,
  onGoalsChange,
  onNext,
  onBack,
}: {
  goals: GoalInput[];
  planName: string;
  templateName?: string;
  onGoalsChange: (g: GoalInput[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestGoals = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/suggest-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName, templateName }),
      });
      const json = (await res.json()) as { data: { goals: GoalInput[] } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "AI提案の生成に失敗しました");
        return;
      }
      onGoalsChange(json.data.goals);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const addGoal = () => onGoalsChange([...goals, { title: "", description: "" }]);
  const removeGoal = (i: number) => onGoalsChange(goals.filter((_, idx) => idx !== i));
  const updateGoal = (i: number, k: keyof GoalInput, v: string) =>
    onGoalsChange(goals.map((g, idx) => (idx === i ? { ...g, [k]: v } : g)));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-1">基本目標を設定</h3>
          <p className="text-sm text-slate-500">計画の上位目標を設定します（省略可）。</p>
        </div>
        <button
          type="button"
          onClick={suggestGoals}
          disabled={loading || !planName}
          className="shrink-0 flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "#6366f110", borderColor: "#6366f140", color: "#818cf8" }}
        >
          {loading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              生成中...
            </>
          ) : (
            <>✦ AIで目標を提案</>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
          style={{ background: "#ef444410", borderColor: "#ef444430" }}>
          {error}
        </div>
      )}

      <div className="space-y-3">
        {goals.map((g, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3" style={cardStyle}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-indigo-400">基本目標 {i + 1}</span>
              <button
                type="button"
                onClick={() => removeGoal(i)}
                className="text-slate-600 hover:text-red-400 text-xs transition-colors duration-200"
              >
                削除
              </button>
            </div>
            <input
              type="text"
              value={g.title}
              onChange={(e) => updateGoal(i, "title", e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="目標タイトル（例: 介護予防の推進）"
            />
            <textarea
              value={g.description}
              onChange={(e) => updateGoal(i, "description", e.target.value)}
              rows={2}
              className={inputClass}
              style={inputStyle}
              placeholder="目標の説明（任意）"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addGoal}
        className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 border rounded-lg px-3 py-1.5 transition-colors duration-200"
        style={{ borderColor: "#06b6d430", background: "#06b6d408" }}
      >
        ＋ 目標を追加
      </button>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "#2a2d3a" }}>
          ← 戻る
        </button>
        <button
          type="button"
          onClick={onNext}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          次へ →
        </button>
        {goals.length === 0 && (
          <button type="button" onClick={onNext}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 inline-flex items-center transition-colors duration-200">
            目標なしで続ける
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: KPIs ─────────────────────────────────────────────────────────────

function Step4({
  kpis,
  goals,
  onKpisChange,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  kpis: KpiInput[];
  goals: GoalInput[];
  onKpisChange: (k: KpiInput[]) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const addKpi = () =>
    onKpisChange([
      ...kpis,
      { label: "", target: "", unit: "", goal_index: null, indicator_type: "process", previous_value: "", previous_target: "" },
    ]);
  const removeKpi = (i: number) => onKpisChange(kpis.filter((_, idx) => idx !== i));
  const updateKpi = (i: number, k: keyof KpiInput, v: string | number | null) =>
    onKpisChange(kpis.map((kpi, idx) => (idx === i ? { ...kpi, [k]: v } : kpi)));

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">KPIを設定</h3>
        <p className="text-sm text-slate-500">成果を測定する指標を設定します（省略可）。</p>
      </div>

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
          style={{ background: "#ef444410", borderColor: "#ef444430" }}>
          {error}
        </div>
      )}

      <div className="space-y-4">
        {kpis.map((kpi, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3" style={cardStyle}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-cyan-400">KPI {i + 1}</span>
              <button
                type="button"
                onClick={() => removeKpi(i)}
                className="text-slate-600 hover:text-red-400 text-xs transition-colors duration-200"
              >
                削除
              </button>
            </div>

            {/* Label + target + unit */}
            <div className="flex gap-2">
              <input
                type="text"
                value={kpi.label}
                onChange={(e) => updateKpi(i, "label", e.target.value)}
                className={`flex-1 ${inputClass}`}
                style={inputStyle}
                placeholder="KPIラベル（例: 待機児童数）"
              />
              <input
                type="number"
                value={kpi.target}
                onChange={(e) => updateKpi(i, "target", e.target.value)}
                className="w-28 rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                style={inputStyle}
                placeholder="目標値"
                min="0"
                step="any"
              />
              <input
                type="text"
                value={kpi.unit}
                onChange={(e) => updateKpi(i, "unit", e.target.value)}
                className="w-20 rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                style={inputStyle}
                placeholder="単位"
              />
            </div>

            {/* Indicator type + goal link */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">指標タイプ</label>
                <select
                  value={kpi.indicator_type}
                  onChange={(e) => updateKpi(i, "indicator_type", e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  style={inputStyle}
                >
                  {Object.entries(INDICATOR_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v} style={{ background: "#1a1d27" }}>{l}</option>
                  ))}
                </select>
              </div>
              {goals.length > 0 && (
                <div className="flex-1">
                  <label className="block text-xs text-slate-500 mb-1">紐付け目標</label>
                  <select
                    value={kpi.goal_index ?? ""}
                    onChange={(e) => updateKpi(i, "goal_index", e.target.value === "" ? null : parseInt(e.target.value))}
                    className="w-full rounded-lg border px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                    style={inputStyle}
                  >
                    <option value="" style={{ background: "#1a1d27" }}>なし</option>
                    {goals.map((g, gi) => (
                      <option key={gi} value={gi} style={{ background: "#1a1d27" }}>
                        目標{gi + 1}: {g.title || "（未入力）"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Previous period values */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">前期実績値（任意）</label>
                <input
                  type="number"
                  value={kpi.previous_value}
                  onChange={(e) => updateKpi(i, "previous_value", e.target.value)}
                  className={`w-full ${inputClass}`}
                  style={inputStyle}
                  placeholder="前期実績"
                  step="any"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">前期目標値（任意）</label>
                <input
                  type="number"
                  value={kpi.previous_target}
                  onChange={(e) => updateKpi(i, "previous_target", e.target.value)}
                  className={`w-full ${inputClass}`}
                  style={inputStyle}
                  placeholder="前期目標"
                  step="any"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {kpis.length < 20 && (
        <button
          type="button"
          onClick={addKpi}
          className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 border rounded-lg px-3 py-1.5 transition-colors duration-200"
          style={{ borderColor: "#06b6d430", background: "#06b6d408" }}
        >
          ＋ KPIを追加
        </button>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "#2a2d3a" }}>
          ← 戻る
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="text-white px-8 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {submitting ? "登録中..." : "計画を登録する"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function NewProjectWizard({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Step 2
  const [basicInfo, setBasicInfo] = useState({
    title: "",
    description: "",
    department: "",
    status: "draft",
    planStartDate: "",
    planEndDate: "",
  });

  // Step 3
  const [goals, setGoals] = useState<GoalInput[]>([]);

  // Step 4
  const [kpis, setKpis] = useState<KpiInput[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);

  // When template is selected, pre-fill KPIs from suggestions
  const handleSelectTemplate = (t: Template | null) => {
    setSelectedTemplate(t);
    if (t && t.kpi_suggestions.length > 0) {
      setKpis(
        t.kpi_suggestions.map((s) => ({
          label: s.label,
          target: "",
          unit: s.unit ?? "",
          goal_index: null,
          indicator_type: s.indicator_type,
          previous_value: "",
          previous_target: "",
        })),
      );
    } else {
      setKpis([]);
    }
  };

  const updateBasicInfo = (k: string, v: string) =>
    setBasicInfo((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const validKpis = kpis
        .filter((k) => k.label.trim() && k.target.trim() && !isNaN(parseFloat(k.target)))
        .map((k, i) => ({
          label: k.label.trim(),
          target: parseFloat(k.target),
          unit: k.unit,
          goal_index: k.goal_index,
          indicator_type: k.indicator_type,
          previous_value: k.previous_value.trim() && !isNaN(parseFloat(k.previous_value))
            ? parseFloat(k.previous_value)
            : null,
          previous_target: k.previous_target.trim() && !isNaN(parseFloat(k.previous_target))
            ? parseFloat(k.previous_target)
            : null,
          sort_order: i,
        }));

      const validGoals = goals
        .filter((g) => g.title.trim())
        .map((g, i) => ({ title: g.title.trim(), description: g.description, sort_order: i }));

      const payload = {
        title: basicInfo.title,
        description: basicInfo.description,
        department: basicInfo.department,
        status: basicInfo.status,
        template_id: selectedTemplate?.id || undefined,
        plan_start_date: basicInfo.planStartDate || null,
        plan_end_date: basicInfo.planEndDate || null,
        is_composite: selectedTemplate?.is_composite ?? false,
        goals: validGoals,
        kpis: validKpis,
      };
      console.log("[NewProjectWizard] POST /api/admin/projects 送信データ:", JSON.stringify(payload, null, 2));

      const res = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as { data: { projectId: string } | null; error: string | null; upgrade_url?: string };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "プランの上限に達しました");
        } else {
          setSubmitError(json.error ?? "登録に失敗しました");
        }
        return;
      }
      router.push("/dashboard");
    } catch {
      setSubmitError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
    <div className="max-w-2xl">
      <PdcaNav currentStage="P" currentStep="計画策定・スケジュール" />
      <div className="mb-4">
        <BackButton />
      </div>
      <h2
        className="text-2xl font-bold tracking-tight mb-6 bg-clip-text text-transparent"
        style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
      >
        新規計画を登録
      </h2>

      <div
        className="rounded-2xl border p-6"
        style={{ background: "#1a1d27", borderColor: "#2a2d3a", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
      >
        <StepIndicator current={step} />

        {step === 1 && (
          <Step1
            templates={templates}
            selected={selectedTemplate}
            onSelect={handleSelectTemplate}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step2
            values={basicInfo}
            onChange={updateBasicInfo}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <Step3
            goals={goals}
            planName={basicInfo.title}
            {...(selectedTemplate?.name ? { templateName: selectedTemplate.name } : {})}
            onGoalsChange={setGoals}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4
            kpis={kpis}
            goals={goals}
            onKpisChange={setKpis}
            onBack={() => setStep(3)}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
          />
        )}
      </div>
    </div>
    </>
  );
}
