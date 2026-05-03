"use client";

import { useState } from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";

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
  shared_by_municipality_id: string | null;
  kpi_suggestions: KpiSuggestion[];
}

interface KpiFormRow {
  label: string;
  unit: string;
  indicator_type: string;
  sort_order: number;
}

interface FormState {
  name: string;
  category: string;
  legal_basis: string;
  plan_period_years: string;
  is_composite: boolean;
  description: string;
  share: boolean;
  kpi_suggestions: KpiFormRow[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "elderly_care", label: "高齢者介護" },
  { value: "disability",   label: "障害福祉" },
  { value: "child",        label: "子育て・教育" },
  { value: "health",       label: "健康増進" },
  { value: "urban",        label: "都市計画" },
  { value: "disaster",     label: "防災" },
  { value: "environment",  label: "環境" },
  { value: "education",    label: "教育" },
  { value: "other",        label: "その他" },
];

const INDICATOR_TYPE_OPTIONS = [
  { value: "process",          label: "プロセス" },
  { value: "outcome_initial",  label: "初期アウトカム" },
  { value: "outcome_mid",      label: "中期アウトカム" },
  { value: "outcome_long",     label: "長期アウトカム" },
  { value: "efficiency",       label: "効率性" },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.value, c.label]),
);

const INDICATOR_LABELS: Record<string, string> = Object.fromEntries(
  INDICATOR_TYPE_OPTIONS.map((c) => [c.value, c.label]),
);

const cardStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "#161922", borderColor: "#2a2d3a" };

const EMPTY_FORM: FormState = {
  name: "", category: "other", legal_basis: "",
  plan_period_years: "", is_composite: false, description: "",
  share: false, kpi_suggestions: [],
};

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({
  tmpl,
  municipalityId,
  onEdit,
  onDelete,
  onToggleShare,
}: {
  tmpl: Template;
  municipalityId: string | null;
  onEdit: (t: Template) => void;
  onDelete: (id: string) => void;
  onToggleShare: (id: string, share: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOwned = !tmpl.is_system;
  const isShared = tmpl.shared_by_municipality_id != null;

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
                {CATEGORY_LABELS[tmpl.category] ?? tmpl.category}
              </span>
              {tmpl.is_system && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "#10b98115", color: "#34d399", border: "1px solid #10b98130" }}>
                  システム標準
                </span>
              )}
              {isShared && !tmpl.is_system && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "#06b6d415", color: "#22d3ee", border: "1px solid #06b6d430" }}>
                  共有中
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-slate-200 leading-snug">{tmpl.name}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isOwned && municipalityId && (
              <>
                <button
                  onClick={() => onToggleShare(tmpl.id, !isShared)}
                  className="text-xs px-2 py-1 rounded-lg border transition-colors duration-200"
                  style={{
                    borderColor: isShared ? "#06b6d440" : "#2a2d3a",
                    color: isShared ? "#22d3ee" : "#64748b",
                    background: isShared ? "#06b6d410" : "transparent",
                  }}
                >
                  {isShared ? "共有解除" : "共有する"}
                </button>
                <button
                  onClick={() => onEdit(tmpl)}
                  className="text-xs px-2 py-1 rounded-lg border text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors duration-200"
                  style={{ borderColor: "#2a2d3a" }}
                >
                  編集
                </button>
                <button
                  onClick={() => onDelete(tmpl.id)}
                  className="text-xs px-2 py-1 rounded-lg border text-red-500 hover:text-red-400 hover:border-red-500/50 transition-colors duration-200"
                  style={{ borderColor: "#2a2d3a" }}
                >
                  削除
                </button>
              </>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors duration-200"
            >
              {expanded ? "▲" : "▼"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          {tmpl.legal_basis && <span>根拠法: {tmpl.legal_basis}</span>}
          {tmpl.plan_period_years != null && tmpl.plan_period_years > 0 && (
            <span>{tmpl.plan_period_years}年計画</span>
          )}
          {tmpl.is_composite && <span>複合計画</span>}
          <span>推奨KPI {tmpl.kpi_suggestions.length}件</span>
        </div>

        {tmpl.description && (
          <p className="text-xs text-slate-500 mt-2 leading-relaxed line-clamp-2">{tmpl.description}</p>
        )}
      </div>

      {expanded && tmpl.kpi_suggestions.length > 0 && (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "#2a2d3a" }}>
          <p className="text-xs font-semibold text-slate-500 mb-2">推奨KPI一覧</p>
          <div className="space-y-1.5">
            {tmpl.kpi_suggestions.map((k) => (
              <div key={k.id} className="flex items-center gap-3">
                <span
                  className="text-xs px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: "#1e2133", color: "#64748b", border: "1px solid #2a2d3a" }}
                >
                  {INDICATOR_LABELS[k.indicator_type] ?? k.indicator_type}
                </span>
                <span className="text-xs text-slate-300 flex-1">{k.label}</span>
                {k.unit && <span className="text-xs text-slate-600">{k.unit}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Template Form Modal ──────────────────────────────────────────────────────

function TemplateFormModal({
  form,
  editId,
  onFormChange,
  onSubmit,
  onClose,
  submitting,
  error,
}: {
  form: FormState;
  editId: string | null;
  onFormChange: (k: string, v: unknown) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const addKpi = () =>
    onFormChange("kpi_suggestions", [
      ...form.kpi_suggestions,
      { label: "", unit: "", indicator_type: "process", sort_order: form.kpi_suggestions.length },
    ]);
  const removeKpi = (i: number) =>
    onFormChange("kpi_suggestions", form.kpi_suggestions.filter((_, idx) => idx !== i));
  const updateKpi = (i: number, k: keyof KpiFormRow, v: string | number) =>
    onFormChange(
      "kpi_suggestions",
      form.kpi_suggestions.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)),
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: "#1a1d27", borderColor: "#2a2d3a" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "#2a2d3a" }}>
          <h3 className="text-base font-bold text-slate-100">
            {editId ? "テンプレートを編集" : "新規テンプレートを作成"}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border px-4 py-3 text-sm text-red-400"
              style={{ background: "#ef444410", borderColor: "#ef444430" }}>
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                テンプレート名 <span className="text-red-400">*</span>
              </label>
              <input type="text" value={form.name}
                onChange={(e) => onFormChange("name", e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: 独自の高齢者支援計画" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">カテゴリ</label>
              <select value={form.category}
                onChange={(e) => onFormChange("category", e.target.value)}
                className={inputClass} style={inputStyle}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value} style={{ background: "#161922" }}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">計画期間（年）</label>
              <input type="number" value={form.plan_period_years}
                onChange={(e) => onFormChange("plan_period_years", e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: 3" min="0" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">根拠法令</label>
              <input type="text" value={form.legal_basis}
                onChange={(e) => onFormChange("legal_basis", e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="例: 介護保険法第117条" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">説明</label>
              <textarea value={form.description} rows={3}
                onChange={(e) => onFormChange("description", e.target.value)}
                className={inputClass} style={inputStyle}
                placeholder="テンプレートの説明" />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={form.is_composite}
                  onChange={(e) => onFormChange("is_composite", e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-500" />
                複合計画
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={form.share}
                  onChange={(e) => onFormChange("share", e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-500" />
                他自治体と共有する
              </label>
            </div>
          </div>

          {/* KPI suggestions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-400">推奨KPI</label>
              <button type="button" onClick={addKpi}
                className="text-xs font-semibold text-cyan-400 border rounded-lg px-3 py-1 transition-colors duration-200"
                style={{ borderColor: "#06b6d430", background: "#06b6d408" }}>
                ＋ 追加
              </button>
            </div>
            <div className="space-y-2">
              {form.kpi_suggestions.map((kpi, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="text" value={kpi.label}
                    onChange={(e) => updateKpi(i, "label", e.target.value)}
                    className="flex-1 rounded-lg border px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    style={inputStyle} placeholder="KPIラベル" />
                  <input type="text" value={kpi.unit}
                    onChange={(e) => updateKpi(i, "unit", e.target.value)}
                    className="w-20 rounded-lg border px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    style={inputStyle} placeholder="単位" />
                  <select value={kpi.indicator_type}
                    onChange={(e) => updateKpi(i, "indicator_type", e.target.value)}
                    className="w-32 rounded-lg border px-2 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    style={inputStyle}>
                    {INDICATOR_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} style={{ background: "#161922" }}>{o.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeKpi(i)}
                    className="text-slate-600 hover:text-red-400 text-lg leading-none transition-colors duration-200">×</button>
                </div>
              ))}
              {form.kpi_suggestions.length === 0 && (
                <p className="text-xs text-slate-600 py-2">推奨KPIなし（追加で設定できます）</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t" style={{ borderColor: "#2a2d3a" }}>
          <button type="button" onClick={onSubmit} disabled={submitting || !form.name.trim()}
            className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            {submitting ? "保存中..." : editId ? "更新する" : "作成する"}
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
  templates: initialTemplates,
  municipalityId,
}: {
  templates: Template[];
  municipalityId: string | null;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (tmpl: Template) => {
    setForm({
      name: tmpl.name,
      category: tmpl.category,
      legal_basis: tmpl.legal_basis ?? "",
      plan_period_years: tmpl.plan_period_years != null ? String(tmpl.plan_period_years) : "",
      is_composite: tmpl.is_composite,
      description: tmpl.description ?? "",
      share: tmpl.shared_by_municipality_id != null,
      kpi_suggestions: tmpl.kpi_suggestions.map((k) => ({
        label: k.label, unit: k.unit ?? "", indicator_type: k.indicator_type, sort_order: k.sort_order,
      })),
    });
    setEditId(tmpl.id);
    setError(null);
    setShowForm(true);
  };

  const handleFormChange = (k: string, v: unknown) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        category: form.category,
        legal_basis: form.legal_basis || null,
        plan_period_years: form.plan_period_years ? parseInt(form.plan_period_years) : null,
        is_composite: form.is_composite,
        description: form.description || null,
        share: form.share,
        kpi_suggestions: form.kpi_suggestions
          .filter((k) => k.label.trim())
          .map((k, i) => ({ ...k, label: k.label.trim(), sort_order: i })),
      };

      let res: Response;
      if (editId) {
        res = await fetch(`/api/admin/templates/${editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/admin/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) { setError(json.error ?? "保存に失敗しました"); return; }

      // ページをリロードして最新データを反映
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

  const handleToggleShare = async (id: string, share: boolean) => {
    const res = await fetch(`/api/admin/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share }),
    });
    if (res.ok) {
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, shared_by_municipality_id: share ? municipalityId : null }
            : t,
        ),
      );
    }
  };

  const systemTemplates = templates.filter((t) => t.is_system);
  const ownTemplates = templates.filter((t) => !t.is_system);

  return (
    <div className="max-w-4xl space-y-8">
      {showForm && (
        <TemplateFormModal
          form={form}
          editId={editId}
          onFormChange={handleFormChange}
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
            計画作成時に使用するテンプレートを管理します。
          </p>
        </div>
        {municipalityId && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            ＋ 新規作成
          </button>
        )}
      </div>

      {/* 自治体独自テンプレート */}
      {ownTemplates.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            自治体独自テンプレート
          </h3>
          <div className="space-y-3">
            {ownTemplates.map((t) => (
              <TemplateCard
                key={t.id} tmpl={t} municipalityId={municipalityId}
                onEdit={openEdit} onDelete={handleDelete} onToggleShare={handleToggleShare}
              />
            ))}
          </div>
        </section>
      )}

      {/* システム標準テンプレート */}
      <section>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          システム標準テンプレート
        </h3>
        <div className="space-y-3">
          {systemTemplates.map((t) => (
            <TemplateCard
              key={t.id} tmpl={t} municipalityId={municipalityId}
              onEdit={openEdit} onDelete={handleDelete} onToggleShare={handleToggleShare}
            />
          ))}
        </div>
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
