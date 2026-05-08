"use client";

import { useState } from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import type { PlanModule, PlanTemplate } from "./page";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAN_TYPE_LABELS: Record<string, string> = {
  kaigo_hoken:    "介護保険",
  shougai_fukushi:"障害福祉",
  kenko_zoshin:   "健康増進",
  chiiki_fukushi: "地域福祉",
  custom:         "カスタム",
};

const PLAN_TYPE_OPTIONS = Object.entries(PLAN_TYPE_LABELS).map(([value, label]) => ({ value, label }));

const PHASE_COLORS: Record<string, string> = {
  P: "#6366f1", D: "#06b6d4", C: "#f59e0b", A: "#10b981",
  "P-D": "#8b5cf6", "C-A": "#f97316",
};

const MODULE_ICONS: Record<string, string> = {
  dataset_manager:    "🗄",
  gap_analysis:       "📊",
  issue_hypothesis:   "🔬",
  logic_model:        "🔗",
  program_evaluation: "📋",
  cost_efficiency:    "💴",
  service_volume:     "📈",
  self_evaluation:    "✅",
};

const cardStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "#161922", borderColor: "#2a2d3a" };

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  plan_type: string;
  description: string;
  plan_period_years: string;
  module_config: Record<string, boolean>;
}

const EMPTY_FORM = (modules: PlanModule[]): FormState => ({
  name: "",
  plan_type: "kaigo_hoken",
  description: "",
  plan_period_years: "3",
  module_config: Object.fromEntries(modules.map((m) => [m.id, false])),
});

// ─── Module Chips ─────────────────────────────────────────────────────────────

function ModuleChips({
  moduleConfig,
  modules,
}: {
  moduleConfig: Record<string, { enabled: boolean }>;
  modules: PlanModule[];
}) {
  const enabled = modules.filter((m) => moduleConfig[m.id]?.enabled);
  if (enabled.length === 0) return <span className="text-xs text-slate-600">モジュールなし</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {enabled.map((m) => (
        <span
          key={m.id}
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: "#6366f112", color: "#a5b4fc", border: "1px solid #6366f125" }}
          title={m.description ?? m.display_name}
        >
          {MODULE_ICONS[m.id] ?? "•"} {m.display_name}
        </span>
      ))}
    </div>
  );
}

// ─── PDCA Mini-Timeline ───────────────────────────────────────────────────────

function PdcaMiniTimeline({ cycles }: { cycles: PlanTemplate["cycles"] }) {
  if (cycles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {cycles.map((c) => (
        <span
          key={c.id}
          className="text-xs px-2 py-0.5 rounded font-mono font-bold"
          style={{
            background: `${PHASE_COLORS[c.phase] ?? "#64748b"}18`,
            color: PHASE_COLORS[c.phase] ?? "#94a3b8",
            border: `1px solid ${PHASE_COLORS[c.phase] ?? "#64748b"}30`,
          }}
          title={`${c.name}（${c.recurrence}）`}
        >
          {c.phase}
        </span>
      ))}
    </div>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({
  tmpl,
  modules,
  municipalityId,
  onDelete,
}: {
  tmpl: PlanTemplate;
  modules: PlanModule[];
  municipalityId: string | null;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOwned = !tmpl.is_system_template;

  return (
    <div className="rounded-xl border overflow-hidden" style={cardStyle}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: "#6366f115", color: "#818cf8", border: "1px solid #6366f130" }}
              >
                {PLAN_TYPE_LABELS[tmpl.plan_type] ?? tmpl.plan_type}
              </span>
              {tmpl.is_system_template && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "#10b98115", color: "#34d399", border: "1px solid #10b98130" }}
                >
                  システム標準
                </span>
              )}
              {tmpl.is_public && !tmpl.is_system_template && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "#06b6d415", color: "#22d3ee", border: "1px solid #06b6d430" }}
                >
                  公開中
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-slate-200 leading-snug">{tmpl.name}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isOwned && municipalityId && (
              <button
                onClick={() => onDelete(tmpl.id)}
                className="text-xs px-2 py-1 rounded-lg border text-red-500 hover:text-red-400 hover:border-red-500/50 transition-colors duration-200"
                style={{ borderColor: "#2a2d3a" }}
              >
                削除
              </button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors duration-200"
            >
              {expanded ? "▲" : "▼"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500 mb-2">
          <span>{tmpl.plan_period_years}年計画</span>
          <span>
            {Object.values(tmpl.module_config).filter((c) => c.enabled).length}モジュール
          </span>
        </div>

        <ModuleChips moduleConfig={tmpl.module_config} modules={modules} />
        <PdcaMiniTimeline cycles={tmpl.cycles} />

        {tmpl.description && (
          <p className="text-xs text-slate-500 mt-2 leading-relaxed line-clamp-2">{tmpl.description}</p>
        )}
      </div>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "#2a2d3a" }}>
          <p className="text-xs font-semibold text-slate-500 mb-2">PDCAサイクル</p>
          {tmpl.cycles.length === 0 ? (
            <p className="text-xs text-slate-600">サイクル定義なし</p>
          ) : (
            <div className="space-y-1.5">
              {tmpl.cycles.map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-mono font-bold shrink-0"
                    style={{
                      background: `${PHASE_COLORS[c.phase] ?? "#64748b"}18`,
                      color: PHASE_COLORS[c.phase] ?? "#94a3b8",
                    }}
                  >
                    {c.phase}
                  </span>
                  <span className="text-xs text-slate-300 flex-1">{c.name}</span>
                  <span className="text-xs text-slate-600">{c.recurrence}</span>
                </div>
              ))}
            </div>
          )}

          {tmpl.description && (
            <>
              <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">説明</p>
              <p className="text-xs text-slate-400 leading-relaxed">{tmpl.description}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Template Form Modal ──────────────────────────────────────────────────────

function TemplateFormModal({
  form,
  modules,
  onFormChange,
  onToggleModule,
  onSubmit,
  onClose,
  submitting,
  error,
}: {
  form: FormState;
  modules: PlanModule[];
  onFormChange: (k: keyof FormState, v: string) => void;
  onToggleModule: (moduleId: string, enabled: boolean) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#2a2d3a" }}>
          <h3 className="text-base font-bold text-slate-100">新規テンプレートを作成</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
              style={{ background: "#ef444410", borderColor: "#ef444430" }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              テンプレート名 <span className="text-red-400">*</span>
            </label>
            <input type="text" value={form.name}
              onChange={(e) => onFormChange("name", e.target.value)}
              className={inputClass} style={inputStyle}
              placeholder="例: 独自介護保険計画" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">計画種別</label>
              <select value={form.plan_type}
                onChange={(e) => onFormChange("plan_type", e.target.value)}
                className={inputClass} style={inputStyle}>
                {PLAN_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} style={{ background: "#161922" }}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">計画期間（年）</label>
              <input type="number" value={form.plan_period_years}
                onChange={(e) => onFormChange("plan_period_years", e.target.value)}
                className={inputClass} style={inputStyle} min="1" max="10" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">説明</label>
            <textarea value={form.description} rows={2}
              onChange={(e) => onFormChange("description", e.target.value)}
              className={inputClass} style={inputStyle}
              placeholder="テンプレートの説明（任意）" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">使用モジュール</label>
            <div className="space-y-2">
              {modules.map((m) => (
                <label key={m.id} className="flex items-start gap-3 cursor-pointer group">
                  <input type="checkbox"
                    checked={form.module_config[m.id] ?? false}
                    onChange={(e) => onToggleModule(m.id, e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded accent-indigo-500 shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-slate-300 group-hover:text-slate-100 transition-colors duration-200">
                      {MODULE_ICONS[m.id] ?? "•"} {m.display_name}
                    </div>
                    {m.description && (
                      <div className="text-xs text-slate-600">{m.description}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t" style={{ borderColor: "#2a2d3a" }}>
          <button type="button" onClick={onSubmit} disabled={submitting || !form.name.trim()}
            className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            {submitting ? "作成中..." : "作成する"}
          </button>
          <button type="button" onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 transition-colors duration-200">
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TemplatesClient({
  modules,
  templates: initialTemplates,
  municipalityId,
}: {
  modules: PlanModule[];
  templates: PlanTemplate[];
  municipalityId: string | null;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(() => EMPTY_FORM(modules));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFormChange = (k: keyof FormState, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleToggleModule = (moduleId: string, enabled: boolean) =>
    setForm((prev) => ({
      ...prev,
      module_config: { ...prev.module_config, [moduleId]: enabled },
    }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const moduleConfig = Object.fromEntries(
        Object.entries(form.module_config).map(([id, enabled]) => [id, { enabled }]),
      );
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          plan_type: form.plan_type,
          description: form.description || null,
          plan_period_years: parseInt(form.plan_period_years) || 3,
          module_config: moduleConfig,
        }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) { setError(json.error ?? "作成に失敗しました"); return; }
      window.location.reload();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このテンプレートを削除しますか？")) return;
    const res = await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
  };

  const systemTemplates = templates.filter((t) => t.is_system_template);
  const ownTemplates = templates.filter((t) => !t.is_system_template);

  return (
    <div className="max-w-4xl space-y-8">
      {showForm && (
        <TemplateFormModal
          form={form}
          modules={modules}
          onFormChange={handleFormChange}
          onToggleModule={handleToggleModule}
          onSubmit={handleSubmit}
          onClose={() => setShowForm(false)}
          submitting={submitting}
          error={error}
        />
      )}

      <div className="mb-4">
        <BackButton />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-2xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            計画テンプレート管理
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            モジュール構成とPDCAサイクルを定義したテンプレートを管理します。
          </p>
        </div>
        {municipalityId && (
          <button
            onClick={() => { setForm(EMPTY_FORM(modules)); setError(null); setShowForm(true); }}
            className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            ＋ 新規作成
          </button>
        )}
      </div>

      {ownTemplates.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            自治体独自テンプレート
          </h3>
          <div className="space-y-3">
            {ownTemplates.map((t) => (
              <TemplateCard key={t.id} tmpl={t} modules={modules}
                municipalityId={municipalityId} onDelete={handleDelete} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          システム標準テンプレート
        </h3>
        {systemTemplates.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "#2a2d3a" }}>
            <p className="text-sm text-slate-500">
              システムテンプレートが見つかりません。
              <br />DBマイグレーション（011_system_templates.sql）が未適用の可能性があります。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {systemTemplates.map((t) => (
              <TemplateCard key={t.id} tmpl={t} modules={modules}
                municipalityId={municipalityId} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </section>

      <div className="pt-4">
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
        >
          → 新規計画でテンプレートを使う
        </Link>
      </div>
    </div>
  );
}
