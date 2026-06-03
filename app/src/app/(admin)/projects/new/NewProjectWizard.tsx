"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import type { TemplateWithCycles, PdcaCheckpointDef } from "@/lib/templates";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanModule {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAN_TYPE_LABELS: Record<string, string> = {
  kaigo_hoken:     "介護保険事業計画",
  shougai_fukushi: "障害福祉計画",
  kenko_zoshin:    "健康増進計画",
  chiiki_fukushi:  "地域福祉計画",
  custom:          "カスタム",
};

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };
const cardStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

// ─── 日付計算 ─────────────────────────────────────────────────────────────────

function calcCheckpointDate(planStartDate: Date, planYear: number, monthStart: number): Date {
  const baseYear = planStartDate.getFullYear() + (planYear > 0 ? planYear - 1 : -1);
  return new Date(baseYear, monthStart - 1, 1);
}

// ─── StepIndicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ["テンプレート選択", "基本情報", "目的の設定", "目標の設定", "モジュール確認", "スケジュール確認"];

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
                    : "var(--border)",
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
              <div className="w-6 h-px mx-1" style={{ background: isDone ? "#10b981" : "var(--border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: テンプレート選択 ─────────────────────────────────────────────────

function Step1({
  templates,
  selected,
  onSelect,
  onNext,
}: {
  templates: TemplateWithCycles[];
  selected: TemplateWithCycles | null;
  onSelect: (t: TemplateWithCycles | null) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">計画テンプレートを選択</h3>
        <p className="text-sm text-slate-500">
          テンプレートを選ぶとPDCAサイクル・モジュール設定が自動で適用されます。後から変更できます。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => {
          const isSelected = selected?.id === t.id;
          const cycleCount = t.cycles?.length ?? 0;
          const cpCount = t.cycles?.reduce((acc, c) => acc + (c.checkpoints?.length ?? 0), 0) ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(isSelected ? null : t)}
              className="rounded-xl border p-4 text-left transition-all duration-200 hover:border-indigo-500/50"
              style={{
                background: isSelected ? "#6366f115" : "var(--bg-secondary)",
                borderColor: isSelected ? "#6366f160" : "var(--border)",
                boxShadow: isSelected ? "0 0 0 1px #6366f140" : "none",
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-sm font-semibold text-slate-200 leading-snug">{t.name}</span>
                {isSelected && (
                  <span
                    className="shrink-0 text-xs font-bold text-indigo-400 border rounded px-1.5 py-0.5"
                    style={{ borderColor: "#6366f140", background: "#6366f115" }}
                  >
                    選択中
                  </span>
                )}
              </div>
              {t.description && (
                <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>
              )}
              <div className="flex gap-3 mt-2">
                {t.plan_type && (
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ background: "#6366f115", color: "#818cf8" }}
                  >
                    {PLAN_TYPE_LABELS[t.plan_type] ?? t.plan_type}
                  </span>
                )}
                {t.plan_period_years > 0 && (
                  <span className="text-xs text-slate-600">{t.plan_period_years}年計画</span>
                )}
                {cycleCount > 0 && (
                  <span className="text-xs text-cyan-700">
                    {cycleCount}サイクル / {cpCount}チェックポイント
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {/* テンプレートなし */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="rounded-xl border p-4 text-left transition-all duration-200 hover:border-slate-600"
          style={{
            background: selected === null ? "#6366f108" : "var(--bg-secondary)",
            borderColor: selected === null ? "#6366f130" : "var(--border)",
            borderStyle: "dashed",
          }}
        >
          <span className="text-sm font-semibold text-slate-400">テンプレートなしで開始</span>
          <p className="text-xs text-slate-600 mt-0.5">すべてのモジュールをONにして空白から始めます</p>
        </button>
      </div>

      <div className="flex gap-3 pt-2">
        <div className="neu-button-wrap">
          <button
          type="button"
          onClick={onNext}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          次へ →
        </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: 基本情報 ─────────────────────────────────────────────────────────

function Step2({
  values,
  onChange,
  onNext,
  onBack,
}: {
  values: { title: string; description: string; department: string; planStartDate: string; planEndDate: string };
  onChange: (k: string, v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canNext = values.title.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">基本情報を入力</h3>
        <p className="text-sm text-slate-500">計画の名称・担当課・計画期間を設定します。</p>
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
        <label className="block text-sm font-medium text-slate-300 mb-1.5">担当課名</label>
        <input
          type="text"
          value={values.department}
          onChange={(e) => onChange("department", e.target.value)}
          className={inputClass}
          style={inputStyle}
          placeholder="例: 高齢福祉課"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">計画開始日</label>
          <input
            type="date"
            value={values.planStartDate}
            onChange={(e) => onChange("planStartDate", e.target.value)}
            className={inputClass}
            style={inputStyle}
          />
          {values.planStartDate && (
            <p className="text-xs text-slate-500 mt-1">
              {format(new Date(values.planStartDate), "yyyy年M月d日", { locale: ja })}
            </p>
          )}
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
          {values.planEndDate && (
            <p className="text-xs text-slate-500 mt-1">
              {format(new Date(values.planEndDate), "yyyy年M月d日", { locale: ja })}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "var(--border)" }}
        >
          ← 戻る
        </button>
        <div className="neu-button-wrap">
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            次へ →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface KpiItem {
  indicator_name: string;
  target_value: string;   // 数値だが入力は文字列で管理
  unit: string;
  evaluation_timing: "interim" | "final" | "annual";
  baseline_value: string; // 任意
}

interface GoalItem {
  title: string;
  description: string;
  kpis: KpiItem[];
}

interface AiSuggestedGoal {
  title: string;
  description: string;
  adopted?: boolean;
}

interface AiSuggestedKpi {
  indicator_name: string;
  target_value: number;
  unit: string;
  baseline_description?: string;
  adopted?: boolean;
}

const EMPTY_KPI = (): KpiItem => ({
  indicator_name: "",
  target_value: "",
  unit: "",
  evaluation_timing: "final",
  baseline_value: "",
});

// ─── Step 2.5: 目的の設定（スキップ可）──────────────────────────────────────

function Step2_5({
  goals,
  onGoalsChange,
  planName,
  templateName,
  onNext,
  onSkip,
  onBack,
}: {
  goals: GoalItem[];
  onGoalsChange: (goals: GoalItem[]) => void;
  planName: string;
  templateName?: string;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestedGoal[]>([]);

  // ─ 目的の操作 ─
  const addGoal = () =>
    onGoalsChange([...goals, { title: "", description: "", kpis: [] }]);

  const removeGoal = (idx: number) =>
    onGoalsChange(goals.filter((_, i) => i !== idx));

  const updateGoal = (idx: number, field: keyof GoalItem, val: string) => {
    const next = goals.map((g, i) => (i === idx ? { ...g, [field]: val } : g));
    onGoalsChange(next);
  };

  const moveGoal = (idx: number, dir: -1 | 1) => {
    const next = [...goals];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    const tmp = next[idx]!;
    next[idx] = next[swapIdx]!;
    next[swapIdx] = tmp;
    onGoalsChange(next);
  };

  // ─ AI提案 ─
  const handleAiSuggest = async () => {
    if (!planName.trim()) return;
    setAiLoading(true);
    setAiError(null);
    setAiSuggestions([]);
    try {
      const res = await fetch("/api/ai/suggest-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName, templateName }),
      });
      const json = (await res.json()) as {
        data: { goals: GoalItem[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setAiError(json.error ?? "AI提案の取得に失敗しました");
        return;
      }
      setAiSuggestions(json.data.goals.map((g) => ({ ...g, adopted: false })));
    } catch {
      setAiError("通信エラーが発生しました");
    } finally {
      setAiLoading(false);
    }
  };

  const adoptSuggestion = (idx: number) => {
    const s = aiSuggestions[idx];
    if (!s || s.adopted) return;
    onGoalsChange([...goals, { title: s.title, description: s.description, kpis: [] }]);
    setAiSuggestions((prev) =>
      prev.map((sg, i) => (i === idx ? { ...sg, adopted: true } : sg))
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">目的の設定</h3>
        <p className="text-sm text-slate-500">
          後から編集できます。入力せずにスキップすることもできます。
        </p>
      </div>

      {/* ─ AI提案ボタン ─ */}
      <div>
        <button
          type="button"
          onClick={handleAiSuggest}
          disabled={aiLoading || !planName.trim()}
          className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: "#6366f140",
            background: "#6366f110",
            color: "#a5b4fc",
          }}
        >
          {aiLoading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              AI提案を生成中...
            </>
          ) : (
            "✦ AIで目的を提案"
          )}
        </button>
        {aiError && (
          <p className="text-xs text-red-400 mt-1.5">{aiError}</p>
        )}
      </div>

      {/* ─ AI提案一覧 ─ */}
      {aiSuggestions.length > 0 && (
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "#6366f140", background: "#6366f108" }}>
          <p className="text-xs font-semibold text-indigo-400 mb-2">AI提案（クリックで採用）</p>
          {aiSuggestions.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border p-3 transition-all duration-200"
              style={{
                borderColor: s.adopted ? "#10b98140" : "#6366f130",
                background: s.adopted ? "#10b98110" : "var(--bg-secondary)",
                opacity: s.adopted ? 0.6 : 1,
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200">{s.title}</p>
                {s.description && (
                  <p className="text-xs text-slate-500 mt-0.5">{s.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => adoptSuggestion(i)}
                disabled={s.adopted}
                className="shrink-0 text-xs font-semibold px-3 py-1 rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: s.adopted ? "#10b98120" : "#6366f120",
                  color: s.adopted ? "#10b981" : "#a5b4fc",
                  border: `1px solid ${s.adopted ? "#10b98140" : "#6366f140"}`,
                }}
              >
                {s.adopted ? "採用済み ✓" : "採用"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ─ 基本目標リスト ─ */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-slate-300">目的</label>
          <button
            type="button"
            onClick={addGoal}
            className="text-xs font-medium px-3 py-1 rounded-lg border transition-colors duration-200 hover:border-indigo-400 hover:text-indigo-400"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            ＋ 目的を追加
          </button>
        </div>

        {goals.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500"
            style={{ borderColor: "var(--border)" }}
          >
            「＋ 目的を追加」またはAI提案を採用してください
          </div>
        ) : (
          <div className="space-y-3">
            {goals.map((g, i) => (
              <div
                key={i}
                className="rounded-xl border p-3 space-y-2"
                style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
              >
                {/* 上段: 番号 + タイトル + 操作ボタン */}
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 flex items-center justify-center rounded-full text-xs font-bold text-white px-2 h-6 whitespace-nowrap"
                    style={{ background: "#6366f1" }}
                  >
                    目的{i + 1}
                  </span>
                  <input
                    type="text"
                    value={g.title}
                    onChange={(e) => updateGoal(i, "title", e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                    placeholder={`目的 ${i + 1} のタイトル`}
                  />
                  {/* 並び替え・削除ボタン */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveGoal(i, -1)}
                      disabled={i === 0}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                      title="上へ"
                    >▲</button>
                    <button
                      type="button"
                      onClick={() => moveGoal(i, 1)}
                      disabled={i === goals.length - 1}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                      title="下へ"
                    >▼</button>
                    <button
                      type="button"
                      onClick={() => removeGoal(i)}
                      className="w-6 h-6 flex items-center justify-center rounded text-red-500 hover:text-red-400 transition-colors"
                      title="削除"
                    >✕</button>
                  </div>
                </div>
                {/* 説明（任意） */}
                <textarea
                  value={g.description}
                  onChange={(e) => updateGoal(i, "description", e.target.value)}
                  rows={2}
                  className={inputClass}
                  style={{ ...inputStyle, fontSize: 12 }}
                  placeholder="説明（任意）"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─ フッターボタン ─ */}
      <div className="flex gap-3 pt-2 justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "var(--border)" }}
        >
          ← 戻る
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
            style={{ borderColor: "var(--border)" }}
          >
            スキップ →
          </button>
          <div className="neu-button-wrap">
            <button
              type="button"
              onClick={onNext}
              className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              次へ →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── StepGoals: 目標の設定（スキップ可）─────────────────────────────────────

const TIMING_LABELS: Record<KpiItem["evaluation_timing"], string> = {
  interim: "中間評価",
  final:   "最終評価",
  annual:  "毎年度",
};

function StepGoals({
  goals,
  onGoalsChange,
  planName,
  onNext,
  onSkip,
  onBack,
}: {
  goals: GoalItem[];
  onGoalsChange: (goals: GoalItem[]) => void;
  planName: string;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  // AI提案の状態（目的ごと）
  const [aiLoading, setAiLoading] = useState<Record<number, boolean>>({});
  const [aiError, setAiError] = useState<Record<number, string>>({});
  const [aiKpiSuggestions, setAiKpiSuggestions] = useState<Record<number, AiSuggestedKpi[]>>({});

  // ─ KPI操作 ─
  const addKpi = (gIdx: number) => {
    const next = goals.map((g, i) =>
      i === gIdx ? { ...g, kpis: [...g.kpis, EMPTY_KPI()] } : g
    );
    onGoalsChange(next);
  };

  const removeKpi = (gIdx: number, kIdx: number) => {
    const next = goals.map((g, i) =>
      i === gIdx ? { ...g, kpis: g.kpis.filter((_, ki) => ki !== kIdx) } : g
    );
    onGoalsChange(next);
  };

  const updateKpi = (gIdx: number, kIdx: number, field: keyof KpiItem, val: string) => {
    const next = goals.map((g, i) =>
      i === gIdx
        ? { ...g, kpis: g.kpis.map((k, ki) => (ki === kIdx ? { ...k, [field]: val } : k)) }
        : g
    );
    onGoalsChange(next);
  };

  // ─ AI提案 ─
  const handleAiKpi = async (gIdx: number) => {
    const goal = goals[gIdx];
    if (!goal?.title.trim()) return;
    setAiLoading((p) => ({ ...p, [gIdx]: true }));
    setAiError((p) => ({ ...p, [gIdx]: "" }));
    setAiKpiSuggestions((p) => ({ ...p, [gIdx]: [] }));
    try {
      const res = await fetch("/api/ai/suggest-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "kpi", purposeTitle: goal.title, planName }),
      });
      const json = (await res.json()) as {
        data: { kpis: Array<{ indicator_name: string; target_value: number; unit: string; baseline_description?: string }> } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setAiError((p) => ({ ...p, [gIdx]: json.error ?? "AI提案の取得に失敗しました" }));
        return;
      }
      setAiKpiSuggestions((p) => ({
        ...p,
        [gIdx]: json.data!.kpis.map((k) => ({ ...k, adopted: false })),
      }));
    } catch {
      setAiError((p) => ({ ...p, [gIdx]: "通信エラーが発生しました" }));
    } finally {
      setAiLoading((p) => ({ ...p, [gIdx]: false }));
    }
  };

  const adoptKpi = (gIdx: number, kIdx: number) => {
    const s = aiKpiSuggestions[gIdx]?.[kIdx];
    if (!s || s.adopted) return;
    const newKpi: KpiItem = {
      indicator_name: s.indicator_name,
      target_value: String(s.target_value),
      unit: s.unit,
      evaluation_timing: "final",
      baseline_value: "",
    };
    const next = goals.map((g, i) =>
      i === gIdx ? { ...g, kpis: [...g.kpis, newKpi] } : g
    );
    onGoalsChange(next);
    setAiKpiSuggestions((p) => ({
      ...p,
      [gIdx]: (p[gIdx] ?? []).map((sg, i) => (i === kIdx ? { ...sg, adopted: true } : sg)),
    }));
  };

  if (goals.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold text-slate-100 mb-1">目標の設定</h3>
          <p className="text-sm text-slate-500">目的が設定されていないためスキップします。</p>
        </div>
        <div className="flex gap-3 pt-2 justify-between">
          <button type="button" onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
            style={{ borderColor: "var(--border)" }}>← 戻る</button>
          <div className="flex gap-2">
            <button type="button" onClick={onSkip}
              className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
              style={{ borderColor: "var(--border)" }}>スキップ →</button>
            <div className="neu-button-wrap">
              <button type="button" onClick={onNext}
                className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>次へ →</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">目標の設定</h3>
        <p className="text-sm text-slate-500">
          各目的に対して測定可能な目標指標を設定します。後から編集できます。
        </p>
      </div>

      {goals.map((goal, gIdx) => (
        <div key={gIdx} className="rounded-xl border space-y-3 p-4" style={{ borderColor: "#6366f140", background: "#6366f108" }}>
          {/* 目的ヘッダー */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 flex items-center justify-center rounded-full text-xs font-bold text-white px-2 h-6 whitespace-nowrap"
              style={{ background: "#6366f1" }}>
              目的{gIdx + 1}
            </span>
            <span className="text-sm font-semibold text-slate-200 truncate">
              {goal.title || `（タイトル未入力）`}
            </span>
          </div>

          {/* AI提案ボタン */}
          <div>
            <button type="button" onClick={() => handleAiKpi(gIdx)}
              disabled={aiLoading[gIdx] || !goal.title.trim()}
              className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: "#0891b240", background: "#0891b210", color: "#67e8f9" }}>
              {aiLoading[gIdx] ? (
                <><span className="inline-block w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />AI提案を生成中...</>
              ) : "✦ AIで目標を提案"}
            </button>
            {aiError[gIdx] && <p className="text-xs text-red-400 mt-1">{aiError[gIdx]}</p>}
          </div>

          {/* AI提案一覧 */}
          {(aiKpiSuggestions[gIdx]?.length ?? 0) > 0 && (
            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "#0891b240", background: "#0891b208" }}>
              <p className="text-xs font-semibold text-cyan-400 mb-1">AI提案</p>
              {aiKpiSuggestions[gIdx]!.map((s, kIdx) => (
                <div key={kIdx} className="flex items-start gap-2 rounded p-2 transition-all duration-200"
                  style={{ background: s.adopted ? "#10b98110" : "var(--bg-secondary)", opacity: s.adopted ? 0.6 : 1 }}>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-slate-200">{s.indicator_name}</span>
                    <span className="text-xs text-slate-500 ml-2">目標: {s.target_value}{s.unit}</span>
                    {s.baseline_description && <p className="text-xs text-slate-600 mt-0.5">{s.baseline_description}</p>}
                  </div>
                  <button type="button" onClick={() => adoptKpi(gIdx, kIdx)} disabled={s.adopted}
                    className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded disabled:opacity-40"
                    style={{ background: s.adopted ? "#10b98120" : "#0891b220", color: s.adopted ? "#10b981" : "#67e8f9",
                      border: `1px solid ${s.adopted ? "#10b98140" : "#0891b240"}` }}>
                    {s.adopted ? "採用済み ✓" : "採用"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* KPIリスト */}
          {goal.kpis.length > 0 && (
            <div className="space-y-2">
              {goal.kpis.map((kpi, kIdx) => (
                <div key={kIdx} className="rounded-lg border p-3 space-y-2"
                  style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-cyan-400 shrink-0">目標{kIdx + 1}</span>
                    <input type="text" value={kpi.indicator_name}
                      onChange={(e) => updateKpi(gIdx, kIdx, "indicator_name", e.target.value)}
                      className={inputClass} style={inputStyle}
                      placeholder="指標名（例: 要介護認定率）" />
                    <button type="button" onClick={() => removeKpi(gIdx, kIdx)}
                      className="w-6 h-6 flex items-center justify-center rounded text-red-500 hover:text-red-400 transition-colors shrink-0">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">目標値</label>
                      <input type="number" value={kpi.target_value}
                        onChange={(e) => updateKpi(gIdx, kIdx, "target_value", e.target.value)}
                        className={inputClass} style={inputStyle} placeholder="例: 19.8" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">単位</label>
                      <input type="text" value={kpi.unit}
                        onChange={(e) => updateKpi(gIdx, kIdx, "unit", e.target.value)}
                        className={inputClass} style={inputStyle} placeholder="例: %" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">評価時期</label>
                      <select value={kpi.evaluation_timing}
                        onChange={(e) => updateKpi(gIdx, kIdx, "evaluation_timing", e.target.value as KpiItem["evaluation_timing"])}
                        className={inputClass} style={inputStyle}>
                        {(Object.entries(TIMING_LABELS) as [KpiItem["evaluation_timing"], string][]).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">ベースライン値（現状値・任意）</label>
                    <input type="number" value={kpi.baseline_value}
                      onChange={(e) => updateKpi(gIdx, kIdx, "baseline_value", e.target.value)}
                      className={inputClass} style={inputStyle} placeholder="例: 22.2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ＋ 目標を追加 */}
          <button type="button" onClick={() => addKpi(gIdx)}
            className="w-full text-xs font-medium py-2 rounded-lg border border-dashed transition-colors duration-200 hover:border-cyan-500 hover:text-cyan-400"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            ＋ 目標を追加
          </button>
        </div>
      ))}

      {/* フッター */}
      <div className="flex gap-3 pt-2 justify-between">
        <button type="button" onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "var(--border)" }}>← 戻る</button>
        <div className="flex gap-2">
          <button type="button" onClick={onSkip}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
            style={{ borderColor: "var(--border)" }}>スキップ →</button>
          <div className="neu-button-wrap">
            <button type="button" onClick={onNext}
              className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>次へ →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: モジュール確認 ───────────────────────────────────────────────────

function Step3({
  modules,
  moduleConfig,
  onModuleConfigChange,
  onNext,
  onBack,
}: {
  modules: PlanModule[];
  moduleConfig: Record<string, { enabled: boolean }>;
  onModuleConfigChange: (config: Record<string, { enabled: boolean }>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const toggle = (id: string) => {
    onModuleConfigChange({
      ...moduleConfig,
      [id]: { enabled: !moduleConfig[id]?.enabled },
    });
  };

  const displayModules = modules.length > 0
    ? modules
    : Object.keys(moduleConfig).map((id) => ({ id, name: id, description: null, sort_order: 0 }));

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">モジュール設定を確認</h3>
        <p className="text-sm text-slate-500">
          テンプレートから引き継いだモジュール設定です。個別に変更できます。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {displayModules.map((mod) => {
          const enabled = moduleConfig[mod.id]?.enabled ?? false;
          return (
            <div
              key={mod.id}
              className="rounded-xl border p-4 transition-all duration-200 cursor-pointer"
              style={{
                ...cardStyle,
                borderColor: enabled ? "#6366f160" : "var(--border)",
                background: enabled ? "#6366f108" : "var(--bg-secondary)",
              }}
              onClick={() => toggle(mod.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-semibold text-slate-200">{mod.name}</span>
                  {mod.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{mod.description}</p>
                  )}
                </div>
                <div
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: enabled ? "#6366f1" : "var(--border)",
                    position: "relative",
                    flexShrink: 0,
                    transition: "background 200ms",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      left: enabled ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      background: "#fff",
                      transition: "left 200ms",
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "var(--border)" }}
        >
          ← 戻る
        </button>
        <div className="neu-button-wrap">
          <button
          type="button"
          onClick={onNext}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          次へ →
        </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: スケジュール確認 ─────────────────────────────────────────────────

function Step4({
  template,
  planStartDate,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  template: TemplateWithCycles | null;
  planStartDate: string;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const checkpointRows = useMemo(() => {
    if (!template || !planStartDate) return [];
    const startDate = new Date(planStartDate);
    const rows: Array<{
      cp: PdcaCheckpointDef;
      cycleName: string;
      cyclePhase: string;
      scheduledDate: Date;
    }> = [];
    for (const cycle of template.cycles ?? []) {
      for (const cp of cycle.checkpoints ?? []) {
        rows.push({
          cp,
          cycleName: cycle.name,
          cyclePhase: cycle.phase,
          scheduledDate: calcCheckpointDate(startDate, cp.plan_year, cp.month_start),
        });
      }
    }
    rows.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
    return rows;
  }, [template, planStartDate]);

  const PHASE_COLORS: Record<string, string> = {
    P: "#6366f1", D: "#06b6d4", C: "#f59e0b", A: "#10b981", "P-D": "#8b5cf6", "C-A": "#f97316",
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">スケジュール確認</h3>
        <p className="text-sm text-slate-500">
          計画開始日とテンプレートから生成されるチェックポイント一覧です。
        </p>
      </div>

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm text-red-400"
          style={{ background: "#ef444410", borderColor: "#ef444430" }}
        >
          {error}
        </div>
      )}

      {checkpointRows.length > 0 ? (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: "var(--bg-primary)", borderBottom: "1px solid var(--border)" }}>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2">チェックポイント</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2">サイクル</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2">予定日</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-2">評価層</th>
              </tr>
            </thead>
            <tbody>
              {checkpointRows.map(({ cp, cycleName, cyclePhase, scheduledDate }, idx) => {
                const color = PHASE_COLORS[cyclePhase] ?? "#64748b";
                return (
                  <tr
                    key={cp.id}
                    style={{
                      borderBottom: idx < checkpointRows.length - 1 ? "1px solid #1e2130" : "none",
                      background: idx % 2 === 0 ? "var(--bg-secondary)" : "var(--bg-input)",
                    }}
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-sm text-slate-200">{cp.name}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color,
                            background: color + "20",
                            border: `1px solid ${color}40`,
                            borderRadius: 4,
                            padding: "1px 5px",
                          }}
                        >
                          {cyclePhase}
                        </span>
                        <span className="text-xs text-slate-500">{cycleName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-slate-300 font-mono">
                        {format(scheduledDate, "yyyy年M月", { locale: ja })}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-slate-500">
                        {cp.evaluation_tiers.length > 0
                          ? cp.evaluation_tiers.join(", ")
                          : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="rounded-xl border p-8 text-center text-sm text-slate-500"
          style={{ borderColor: "var(--border)", borderStyle: "dashed" }}
        >
          {!planStartDate
            ? "計画開始日が設定されていないため、スケジュールは生成されません。"
            : "チェックポイントはありません。"}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 border rounded-xl transition-colors duration-200"
          style={{ borderColor: "var(--border)" }}
        >
          ← 戻る
        </button>
        <div className="neu-button-wrap">
          <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="text-white px-8 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {submitting ? "作成中..." : "プロジェクトを作成"}
        </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function NewProjectWizard({
  templates,
  modules,
}: {
  templates: TemplateWithCycles[];
  modules: PlanModule[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  // Step 1
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateWithCycles | null>(null);

  // Step 2: 基本情報
  const [basicInfo, setBasicInfo] = useState({
    title: "",
    description: "",
    department: "",
    planStartDate: "",
    planEndDate: "",
  });

  // Step 3: 目的
  const [goals, setGoals] = useState<GoalItem[]>([]);

  // Step 4 (旧3): moduleConfig
  const [moduleConfig, setModuleConfig] = useState<Record<string, { enabled: boolean }>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSelectTemplate = (t: TemplateWithCycles | null) => {
    setSelectedTemplate(t);
    if (t) {
      setModuleConfig(t.module_config ?? {});
    } else {
      const allOn: Record<string, { enabled: boolean }> = {};
      if (modules.length > 0) {
        for (const m of modules) allOn[m.id] = { enabled: true };
      }
      setModuleConfig(allOn);
    }
  };

  const updateBasicInfo = (k: string, v: string) =>
    setBasicInfo((prev) => ({ ...prev, [k]: v }));


  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      // goals をフィルタして payload 化（空タイトルは除外）
      const filteredGoals = goals.filter((g) => g.title.trim().length > 0);
      const goalsPayload = filteredGoals.map((g, i) => ({
        goal_number: i + 1,
        title: g.title,
        description: g.description,
        sort_order: i,
      }));

      // 各目的の kpis を goal_index 付きでフラットに展開
      const kpisPayload = filteredGoals.flatMap((g, gIdx) =>
        g.kpis
          .filter((k) => k.indicator_name.trim().length > 0)
          .map((k) => ({
            label: k.indicator_name,
            target: parseFloat(k.target_value) || 0,
            unit: k.unit,
            goal_index: gIdx,
            indicator_type: "outcome_initial" as const,
            previous_value: k.baseline_value ? parseFloat(k.baseline_value) : null,
          }))
      );

      const payload = {
        title: basicInfo.title,
        description: basicInfo.description,
        department: basicInfo.department,
        status: "draft",
        template_id: selectedTemplate?.id ?? null,
        plan_start_date: basicInfo.planStartDate || null,
        plan_end_date: basicInfo.planEndDate || null,
        module_overrides: moduleConfig,
        goals: goalsPayload,
        kpis: kpisPayload,
      };

      const res = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as { data: { projectId: string } | null; error: string | null };
      if (!res.ok) {
        setSubmitError(json.error ?? "登録に失敗しました");
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
    <div className="max-w-2xl">
      <h2
        className="text-2xl font-bold tracking-tight mb-6 bg-clip-text text-transparent"
        style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
      >
        新規計画を登録
      </h2>

      <div
        className="rounded-2xl border p-6"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
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
          <Step2_5
            goals={goals}
            onGoalsChange={setGoals}
            planName={basicInfo.title}
            templateName={selectedTemplate?.name ?? ""}
            onNext={() => setStep(4)}
            onSkip={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <StepGoals
            goals={goals}
            onGoalsChange={setGoals}
            planName={basicInfo.title}
            onNext={() => setStep(5)}
            onSkip={() => setStep(5)}
            onBack={() => setStep(3)}
          />
        )}
        {step === 5 && (
          <Step3
            modules={modules}
            moduleConfig={moduleConfig}
            onModuleConfigChange={setModuleConfig}
            onNext={() => setStep(6)}
            onBack={() => setStep(4)}
          />
        )}
        {step === 6 && (
          <Step4
            template={selectedTemplate}
            planStartDate={basicInfo.planStartDate}
            onBack={() => setStep(5)}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
          />
        )}
      </div>
    </div>
  );
}
