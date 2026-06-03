"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import BackButton from "@/components/BackButton";
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

const STEP_LABELS = ["テンプレート選択", "基本情報", "モジュール確認", "スケジュール確認"];

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
  values: { title: string; description: string; department: string; planStartDate: string };
  onChange: (k: string, v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const canNext = values.title.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">基本情報を入力</h3>
        <p className="text-sm text-slate-500">計画の名称・担当課・開始日を設定します。</p>
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

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">計画開始日</label>
        <input
          type="date"
          value={values.planStartDate}
          onChange={(e) => onChange("planStartDate", e.target.value)}
          className={inputClass}
          style={{ ...inputStyle, width: 200 }}
        />
        {values.planStartDate && (
          <p className="text-xs text-slate-500 mt-1">
            {format(new Date(values.planStartDate), "yyyy年M月d日", { locale: ja })}
          </p>
        )}
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
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateWithCycles | null>(null);

  // Step 2
  const [basicInfo, setBasicInfo] = useState({
    title: "",
    description: "",
    department: "",
    planStartDate: "",
  });

  // Step 3: moduleConfig — テンプレート選択時はテンプレートのもの、なしは全ON
  const [moduleConfig, setModuleConfig] = useState<Record<string, { enabled: boolean }>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSelectTemplate = (t: TemplateWithCycles | null) => {
    setSelectedTemplate(t);
    if (t) {
      setModuleConfig(t.module_config ?? {});
    } else {
      // テンプレートなし: 利用可能なモジュールをすべてON
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
      const payload = {
        title: basicInfo.title,
        description: basicInfo.description,
        department: basicInfo.department,
        status: "draft",
        template_id: selectedTemplate?.id ?? null,
        plan_start_date: basicInfo.planStartDate || null,
        module_overrides: moduleConfig,
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
          <Step3
            modules={modules}
            moduleConfig={moduleConfig}
            onModuleConfigChange={setModuleConfig}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <Step4
            template={selectedTemplate}
            planStartDate={basicInfo.planStartDate}
            onBack={() => setStep(3)}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
          />
        )}
      </div>
    </div>
  );
}
