"use client";

import { useState, useMemo } from "react";
import BackButton from "@/components/BackButton";
import CycleDesigner from "@/components/pdca/CycleDesigner";
import type { TemplateWithCycles } from "@/lib/templates";
import { checkModuleCompatibility } from "@/lib/modules/compatibility-checker";

// ─── 定数 ────────────────────────────────────────────────────────────────────

const PLAN_TYPES = [
  { value: "kaigo_hoken",     label: "介護保険事業計画" },
  { value: "shougai_fukushi", label: "障害福祉計画" },
  { value: "kenko_zoshin",    label: "健康増進計画" },
  { value: "chiiki_fukushi",  label: "地域福祉計画" },
  { value: "custom",          label: "カスタム" },
];

const ALL_MODULES = [
  { id: "kpi",           label: "KPI管理",           description: "成果指標の設定・追跡" },
  { id: "logic_model",   label: "ロジックモデル",     description: "AIロジックモデル自動生成" },
  { id: "schedule",      label: "スケジュール管理",   description: "PDCA日程管理" },
  { id: "evidence",      label: "エビデンス管理",     description: "根拠資料の管理・評価" },
  { id: "ebpm",          label: "EBPM分析",           description: "統計データ連携・分析" },
  { id: "documents",     label: "文書管理",           description: "計画書・報告書の管理" },
  { id: "post",          label: "投稿・公開",         description: "SNS・広報フィード" },
  { id: "resources",     label: "リソース管理",       description: "事業費・人員管理" },
];

// テンプレート固有の依存関係（CAUSAL_EDGES に存在しないテンプレート専用モジュール用）
// CAUSAL_EDGES に含まれるモジュール（logic_model など）は checkModuleCompatibility でチェック
const TEMPLATE_ONLY_DEPS: Record<string, string[]> = {
  ebpm: ["kpi"],
};

// ─── スタイル ─────────────────────────────────────────────────────────────────

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };
const cardStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

// ─── タブ ──────────────────────────────────────────────────────────────────────

type TabId = "basic" | "modules" | "pdca";

const TABS: { id: TabId; label: string }[] = [
  { id: "basic",   label: "基本情報" },
  { id: "modules", label: "モジュール設定" },
  { id: "pdca",    label: "PDCAデザイナー" },
];

// ─── Tab1: 基本情報 ───────────────────────────────────────────────────────────

function BasicInfoTab({
  template,
  readOnly,
}: {
  template: TemplateWithCycles;
  readOnly: boolean;
}) {
  const [form, setForm] = useState({
    name: template.name,
    plan_type: template.plan_type,
    description: template.description ?? "",
    plan_period_years: template.plan_period_years,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/admin/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          plan_type: form.plan_type,
          description: form.description || null,
          plan_period_years: form.plan_period_years,
        }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {readOnly && (
        <div
          style={{
            background: "#f59e0b10",
            border: "1px solid #f59e0b30",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "#fbbf24",
          }}
        >
          システムテンプレートは閲覧のみ可能です。
        </div>
      )}

      {error && (
        <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#10b98110", border: "1px solid #10b98130", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#34d399" }}>
          保存しました
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          テンプレート名 <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          disabled={readOnly}
          className={inputClass}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">計画種別</label>
        <select
          value={form.plan_type}
          onChange={(e) => update("plan_type", e.target.value)}
          disabled={readOnly}
          className={inputClass}
          style={inputStyle}
        >
          {PLAN_TYPES.map((pt) => (
            <option key={pt.value} value={pt.value} style={{ background: "var(--bg-input)" }}>
              {pt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">説明</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          disabled={readOnly}
          rows={3}
          className={inputClass}
          style={inputStyle}
          placeholder="テンプレートの説明を入力してください"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">計画期間（年）</label>
        <input
          type="number"
          min={1}
          max={10}
          value={form.plan_period_years}
          onChange={(e) => update("plan_period_years", parseInt(e.target.value) || 1)}
          disabled={readOnly}
          className={inputClass}
          style={{ ...inputStyle, width: 120 }}
        />
      </div>

      {!readOnly && (
        <div className="neu-button-wrap">
          <button
          onClick={handleSave}
          disabled={saving}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab2: モジュール設定 ─────────────────────────────────────────────────────

function ModulesTab({
  template,
  readOnly,
}: {
  template: TemplateWithCycles;
  readOnly: boolean;
}) {
  const [config, setConfig] = useState<Record<string, { enabled: boolean }>>(
    template.module_config,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isEnabled = (id: string) => config[id]?.enabled ?? false;

  const toggleModule = (id: string) => {
    if (readOnly) return;
    setConfig((prev) => ({
      ...prev,
      [id]: { enabled: !prev[id]?.enabled },
    }));
  };

  // 有効モジュールIDを取得
  const enabledIds = ALL_MODULES.filter((m) => isEnabled(m.id)).map((m) => m.id);

  // causal-graph.ts の CAUSAL_EDGES ベースの互換チェック
  const compatResult = useMemo(
    () => checkModuleCompatibility(enabledIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config],
  );

  // テンプレート専用依存チェック（TEMPLATE_ONLY_DEPS）
  const getDepsWarning = (id: string): string | null => {
    // causal-graph の依存欠落
    const causalMissing = compatResult.missingDeps
      .filter((d) => d.module === id)
      .map((d) => d.requires);
    // テンプレート専用依存
    const tmplDeps = TEMPLATE_ONLY_DEPS[id] ?? [];
    const tmplMissing = tmplDeps.filter((d) => !isEnabled(d));
    const allMissing = [...causalMissing, ...tmplMissing];
    if (allMissing.length === 0) return null;
    return `依存モジュールが無効: ${allMissing.join(", ")}`;
  };

  // ブロッキングエラーがある場合は保存を禁止
  const hasBlockingError = compatResult.incompatWarnings.some((w) => w.isBlocking);

  const handleSave = async () => {
    if (hasBlockingError) {
      setError("非互換のモジュール設定があります。保存できません。");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/admin/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module_config: config }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {readOnly && (
        <div style={{ background: "#f59e0b10", border: "1px solid #f59e0b30", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#fbbf24" }}>
          システムテンプレートは閲覧のみ可能です。
        </div>
      )}

      {error && (
        <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#10b98110", border: "1px solid #10b98130", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#34d399" }}>
          保存しました
        </div>
      )}

      {/* causal-graph.ts による互換チェック警告 */}
      {compatResult.incompatWarnings.map((w) => (
        <div
          key={`${w.moduleA}-${w.moduleB}`}
          style={
            w.isBlocking
              ? { background: "#ef444410", border: "1px solid #ef444430", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }
              : { background: "#f59e0b10", border: "1px solid #f59e0b30", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#fbbf24" }
          }
        >
          {w.isBlocking ? "⛔" : "⚠"} {w.warningMessage}
        </div>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        {ALL_MODULES.map((mod) => {
          const enabled = isEnabled(mod.id);
          const warning = getDepsWarning(mod.id);
          return (
            <div
              key={mod.id}
              className="rounded-xl border p-4 transition-all duration-200"
              style={{
                ...cardStyle,
                borderColor: enabled ? "#6366f160" : "var(--border)",
                background: enabled ? "#6366f108" : "var(--bg-secondary)",
                cursor: readOnly ? "default" : "pointer",
              }}
              onClick={() => toggleModule(mod.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-200">{mod.label}</span>
                    {warning && enabled && (
                      <span
                        style={{
                          fontSize: 10,
                          background: "#f59e0b20",
                          border: "1px solid #f59e0b40",
                          color: "#fbbf24",
                          borderRadius: 4,
                          padding: "1px 6px",
                        }}
                      >
                        警告
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{mod.description}</p>
                  {warning && enabled && (
                    <p className="text-xs text-amber-500 mt-1">{warning}</p>
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

      {!readOnly && (
        <div className="neu-button-wrap">
          <button
          onClick={handleSave}
          disabled={saving}
          className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {saving ? "保存中..." : "保存"}
        </button>
        </div>
      )}
    </div>
  );
}

// ─── TemplateEditorClient ─────────────────────────────────────────────────────

export default function TemplateEditorClient({ template }: { template: TemplateWithCycles }) {
  const [activeTab, setActiveTab] = useState<TabId>("basic");
  const readOnly = template.is_system_template;

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <BackButton />
      </div>

      <div className="flex items-center gap-3 mb-6">
        <h2
          className="text-2xl font-bold tracking-tight bg-clip-text text-transparent"
          style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {template.name}
        </h2>
        {readOnly && (
          <span
            style={{
              fontSize: 11,
              background: "#f59e0b20",
              border: "1px solid #f59e0b40",
              color: "#fbbf24",
              borderRadius: 6,
              padding: "3px 8px",
              fontWeight: 600,
            }}
          >
            システムテンプレート（閲覧のみ）
          </span>
        )}
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              color: activeTab === tab.id ? "#e2e8f0" : "#64748b",
              borderBottom: activeTab === tab.id ? "2px solid #6366f1" : "2px solid transparent",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              transition: "color 150ms",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      {activeTab === "basic" && (
        <BasicInfoTab template={template} readOnly={readOnly} />
      )}
      {activeTab === "modules" && (
        <ModulesTab template={template} readOnly={readOnly} />
      )}
      {activeTab === "pdca" && (
        <CycleDesigner template={template} readOnly={readOnly} />
      )}
    </div>
  );
}
