"use client";

import { useState, useMemo } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import { calcOaxacaBlinder } from "@/lib/stats/oaxaca-blinder";
import { calcDemandForecast } from "@/lib/stats/demand-forecast";

// ---- 型定義 ----

interface ServiceVolumePlan {
  id: string;
  project_id: string;
  checkpoint_id: string | null;
  service_name: string;
  service_category: string | null;
  fiscal_year: number;
  planned_cert_rate: number | null;
  planned_recep_rate: number | null;
  planned_unit_benefit: number | null;
  planned_users: number | null;
  planned_benefit: number | null;
  actual_cert_rate: number | null;
  actual_recep_rate: number | null;
  actual_unit_benefit: number | null;
  actual_users: number | null;
  actual_benefit: number | null;
  cert_deviation_pct: number | null;
  deviation_analysis: unknown;
  deviation_notes: string | null;
  ai_deviation_analysis: string | null;
  created_at: string;
}

interface CheckpointRow {
  id: string;
  name: string;
}

interface Props {
  project: { id: string; title: string };
  plans: ServiceVolumePlan[];
  checkpoints: CheckpointRow[];
}

// ---- 定数 ----

const TABS = ["乖離テーブル", "要因分解", "需要予測"] as const;
type Tab = (typeof TABS)[number];

const cardStyle: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };

function deviationColor(pct: number | null): string {
  if (pct == null) return "#64748b";
  const abs = Math.abs(pct);
  if (abs <= 5) return "#10b981";
  if (abs <= 15) return "#f59e0b";
  return "#ef4444";
}

// ---- モーダルフォーム初期値 ----

const emptyForm = () => ({
  service_name: "",
  service_category: "",
  fiscal_year: String(new Date().getFullYear()),
  planned_cert_rate: "",
  planned_recep_rate: "",
  planned_unit_benefit: "",
  planned_users: "",
  planned_benefit: "",
  actual_cert_rate: "",
  actual_recep_rate: "",
  actual_unit_benefit: "",
  actual_users: "",
  actual_benefit: "",
  deviation_notes: "",
  checkpoint_id: "",
});

// ---- コンポーネント ----

export default function ServiceVolumeClient({ project, plans: initialPlans, checkpoints }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(TABS[0]);
  const [plans, setPlans] = useState<ServiceVolumePlan[]>(initialPlans);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string>("");
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<string, boolean>>({});

  const serviceNames = useMemo(() => {
    const names = new Set(plans.map((p) => p.service_name));
    return Array.from(names).sort();
  }, [plans]);

  const setField = (f: keyof ReturnType<typeof emptyForm>, v: string) =>
    setForm((p) => ({ ...p, [f]: v }));

  const handleSave = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        service_name: form.service_name,
        fiscal_year: parseInt(form.fiscal_year, 10),
      };
      if (form.service_category) body.service_category = form.service_category;
      if (form.planned_cert_rate) body.planned_cert_rate = parseFloat(form.planned_cert_rate);
      if (form.planned_recep_rate) body.planned_recep_rate = parseFloat(form.planned_recep_rate);
      if (form.planned_unit_benefit)
        body.planned_unit_benefit = parseFloat(form.planned_unit_benefit);
      if (form.planned_users) body.planned_users = parseInt(form.planned_users, 10);
      if (form.planned_benefit) body.planned_benefit = parseFloat(form.planned_benefit);
      if (form.actual_cert_rate) body.actual_cert_rate = parseFloat(form.actual_cert_rate);
      if (form.actual_recep_rate) body.actual_recep_rate = parseFloat(form.actual_recep_rate);
      if (form.actual_unit_benefit)
        body.actual_unit_benefit = parseFloat(form.actual_unit_benefit);
      if (form.actual_users) body.actual_users = parseInt(form.actual_users, 10);
      if (form.actual_benefit) body.actual_benefit = parseFloat(form.actual_benefit);
      if (form.deviation_notes) body.deviation_notes = form.deviation_notes;
      if (form.checkpoint_id) body.checkpoint_id = form.checkpoint_id;

      const res = await fetch(`/api/admin/projects/${project.id}/service-volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || json.error) {
        setFormError(json.error ?? "保存に失敗しました");
        return;
      }

      // 一覧を再フェッチ
      const listRes = await fetch(`/api/admin/projects/${project.id}/service-volume`);
      const listJson = (await listRes.json()) as {
        data: ServiceVolumePlan[] | null;
        error: string | null;
      };
      if (listJson.data) setPlans(listJson.data);
      setModalOpen(false);
      setForm(emptyForm());
    } catch {
      setFormError("ネットワークエラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNoteSave = async (planId: string) => {
    setNoteSaving((p) => ({ ...p, [planId]: true }));
    try {
      await fetch(`/api/admin/projects/${project.id}/service-volume/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviation_notes: noteEdits[planId] ?? "" }),
      });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === planId ? { ...p, deviation_notes: noteEdits[planId] ?? null } : p,
        ),
      );
    } finally {
      setNoteSaving((p) => ({ ...p, [planId]: false }));
    }
  };

  // ---- Oaxaca分解 ----
  const oaxacaResult = useMemo(() => {
    if (!selectedService) return null;
    const sv = plans.find((p) => p.service_name === selectedService);
    if (!sv) return null;

    const planned_cr = sv.planned_cert_rate ?? 1;
    const actual_cr = sv.actual_cert_rate ?? planned_cr;
    const planned_rr = sv.planned_recep_rate ?? 1;
    const actual_rr = sv.actual_recep_rate ?? planned_rr;
    const planned_ub = sv.planned_unit_benefit ?? 1;
    const actual_ub = sv.actual_unit_benefit ?? planned_ub;

    return calcOaxacaBlinder({
      insured_n: sv.planned_users ?? 100,
      planned_cert_rate: planned_cr / 100,
      planned_recep_rate: planned_rr / 100,
      planned_unit_benefit: planned_ub,
      actual_cert_rate: actual_cr / 100,
      actual_recep_rate: actual_rr / 100,
      actual_unit_benefit: actual_ub,
    });
  }, [selectedService, plans]);

  // ---- 需要予測 ----
  const forecastResult = useMemo(() => {
    if (!selectedService) return null;
    const historical = plans
      .filter(
        (p) => p.service_name === selectedService && p.actual_benefit != null && p.fiscal_year != null,
      )
      .map((p) => ({ year: p.fiscal_year, value: p.actual_benefit! }))
      .sort((a, b) => a.year - b.year);
    if (historical.length < 2) return null;
    try {
      return calcDemandForecast(historical);
    } catch {
      return null;
    }
  }, [selectedService, plans]);

  return (
    <div>
      {/* タブ */}
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: "var(--border)" }}>
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

      {/* タブ1: 乖離テーブル */}
      {activeTab === "乖離テーブル" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="text-sm font-semibold px-4 py-2 rounded-xl text-white neu-button-primary"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              新規登録
            </button>
          </div>

          {plans.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed p-12 text-center"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-sm text-slate-500">まだデータがありません</p>
            </div>
          ) : (
            <div className="rounded-2xl border overflow-x-auto" style={cardStyle}>
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-input)" }}>
                    {[
                      "サービス名",
                      "年度",
                      "計画認定率(%)",
                      "実績認定率(%)",
                      "認定率乖離%",
                      "計画受給率(%)",
                      "実績受給率(%)",
                      "計画給付費",
                      "実績給付費",
                      "乖離メモ",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-3 text-xs font-medium text-slate-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr
                      key={plan.id}
                      style={{ borderBottom: "1px solid var(--border)" }}
                      className="hover:bg-white/2 transition-colors"
                    >
                      <td className="px-3 py-3 text-slate-300 font-medium">{plan.service_name}</td>
                      <td className="px-3 py-3 text-slate-400">{plan.fiscal_year}年度</td>
                      <td className="px-3 py-3 text-slate-400 font-mono">
                        {plan.planned_cert_rate?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-400 font-mono">
                        {plan.actual_cert_rate?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {plan.cert_deviation_pct != null ? (
                          <span
                            className="font-mono font-semibold text-sm"
                            style={{ color: deviationColor(plan.cert_deviation_pct) }}
                          >
                            {plan.cert_deviation_pct > 0 ? "+" : ""}
                            {plan.cert_deviation_pct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-400 font-mono">
                        {plan.planned_recep_rate?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-400 font-mono">
                        {plan.actual_recep_rate?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-400 font-mono">
                        {plan.planned_benefit != null
                          ? `${plan.planned_benefit.toLocaleString()}万`
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-400 font-mono">
                        {plan.actual_benefit != null
                          ? `${plan.actual_benefit.toLocaleString()}万`
                          : "—"}
                      </td>
                      <td className="px-3 py-3 min-w-[200px]">
                        <textarea
                          className="w-full rounded-lg border px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none"
                          style={{ background: "var(--bg-input)", borderColor: "var(--border)" }}
                          rows={2}
                          value={noteEdits[plan.id] ?? plan.deviation_notes ?? ""}
                          onChange={(e) =>
                            setNoteEdits((p) => ({ ...p, [plan.id]: e.target.value }))
                          }
                          placeholder="乖離の理由・メモ"
                        />
                      </td>
                      <td className="px-3 py-3">
                        {noteEdits[plan.id] !== undefined &&
                          noteEdits[plan.id] !== (plan.deviation_notes ?? "") && (
                            <button
                              type="button"
                              onClick={() => void handleNoteSave(plan.id)}
                              disabled={noteSaving[plan.id]}
                              className="text-xs px-2 py-1 rounded-lg text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
                            >
                              {noteSaving[plan.id] ? "保存中" : "保存"}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* タブ2: 要因分解 */}
      {activeTab === "要因分解" && (
        <div className="space-y-6">
          <div className="rounded-2xl border p-5" style={cardStyle}>
            <h3 className="text-sm font-semibold text-slate-200 mb-3">
              Oaxaca-Blinder 要因分解
            </h3>
            <div className="mb-4">
              <label className="text-xs text-slate-400 mb-1 block">サービスを選択</label>
              <select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">-- サービスを選択 --</option>
                {serviceNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {selectedService && oaxacaResult && (
              <div className="space-y-4">
                <div
                  className="rounded-xl border p-4"
                  style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}
                >
                  <p className="text-xs text-slate-400 mb-1">給付費乖離（実績－計画）</p>
                  <p
                    className="text-2xl font-bold font-mono"
                    style={{
                      color: oaxacaResult.total_gap >= 0 ? "#10b981" : "#ef4444",
                    }}
                  >
                    {oaxacaResult.total_gap >= 0 ? "+" : ""}
                    {oaxacaResult.total_gap.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      label: "認定率要因",
                      value: oaxacaResult.cert_contribution,
                      pct: oaxacaResult.cert_pct,
                      color: "#6366f1",
                    },
                    {
                      label: "受給率要因",
                      value: oaxacaResult.recep_contribution,
                      pct: oaxacaResult.recep_pct,
                      color: "#06b6d4",
                    },
                    {
                      label: "単位給付費要因",
                      value: oaxacaResult.unit_contribution,
                      pct: oaxacaResult.unit_pct,
                      color: "#10b981",
                    },
                    {
                      label: "交差項",
                      value: oaxacaResult.interaction,
                      pct: oaxacaResult.interaction_pct,
                      color: "#f59e0b",
                    },
                  ].map(({ label, value, pct, color }) => {
                    const barWidth = Math.min(100, Math.abs(pct));
                    return (
                      <div key={label}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-slate-400">{label}</span>
                          <div className="flex items-center gap-3">
                            <span
                              className="text-xs font-mono font-medium"
                              style={{ color }}
                            >
                              {value >= 0 ? "+" : ""}
                              {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-xs text-slate-500 font-mono w-16 text-right">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div
                          className="h-4 rounded-full overflow-hidden"
                          style={{ background: "var(--border)" }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%`, background: color, opacity: 0.8 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedService && !oaxacaResult && (
              <p className="text-sm text-slate-500">
                このサービスの計画・実績データが不足しているため分解できません。
              </p>
            )}

            {!selectedService && (
              <p className="text-sm text-slate-500">上のセレクトでサービスを選択してください。</p>
            )}
          </div>
        </div>
      )}

      {/* タブ3: 需要予測 */}
      {activeTab === "需要予測" && (
        <div className="space-y-6">
          <div className="rounded-2xl border p-5" style={cardStyle}>
            <h3 className="text-sm font-semibold text-slate-200 mb-3">需要予測（OLS回帰）</h3>
            <div className="mb-4">
              <label className="text-xs text-slate-400 mb-1 block">サービスを選択</label>
              <select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">-- サービスを選択 --</option>
                {serviceNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {selectedService && forecastResult && (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={forecastResult.points} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
                    <defs>
                      <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-secondary)",
                        borderColor: "var(--border)",
                        borderRadius: 8,
                      }}
                      labelStyle={{ color: "#94a3b8" }}
                    />
                    <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="upper95"
                      stroke="none"
                      fill="url(#ciGrad)"
                      name="95%信頼区間(上限)"
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="lower95"
                      stroke="none"
                      fill="var(--bg-primary)"
                      name="95%信頼区間(下限)"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={{ fill: "#06b6d4", r: 4 }}
                      name="実績給付費"
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      stroke="#6366f1"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={{ fill: "#6366f1", r: 3 }}
                      name="予測値"
                    />
                  </AreaChart>
                </ResponsiveContainer>

                <div
                  className="rounded-xl border p-4 space-y-2"
                  style={{ borderColor: "#6366f140", background: "#6366f108" }}
                >
                  <p className="text-xs font-semibold text-indigo-300">解釈</p>
                  <p className="text-sm text-slate-400">{forecastResult.interpretation}</p>
                  <div className="flex gap-4 mt-1">
                    <span className="text-xs text-slate-500">
                      傾き: <span className="font-mono text-slate-300">{forecastResult.slope}</span>
                    </span>
                    <span className="text-xs text-slate-500">
                      R²:{" "}
                      <span className="font-mono text-slate-300">
                        {forecastResult.rSquared.toFixed(3)}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {selectedService && !forecastResult && (
              <p className="text-sm text-slate-500">
                需要予測には2年以上の実績給付費データが必要です。
              </p>
            )}

            {!selectedService && (
              <p className="text-sm text-slate-500">上のセレクトでサービスを選択してください。</p>
            )}
          </div>
        </div>
      )}

      {/* 新規登録モーダル */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="rounded-2xl border w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4 neu-card"
            style={cardStyle}
          >
            <h3 className="text-base font-semibold text-slate-100">サービス見込量を登録</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1 block">サービス名 *</label>
                <input
                  type="text"
                  value={form.service_name}
                  onChange={(e) => setField("service_name", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="例: 訪問介護"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">カテゴリ</label>
                <input
                  type="text"
                  value={form.service_category}
                  onChange={(e) => setField("service_category", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="居宅サービス等"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">年度 *</label>
                <input
                  type="number"
                  value={form.fiscal_year}
                  onChange={(e) => setField("fiscal_year", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">計画チェックポイント</label>
                <select
                  value={form.checkpoint_id}
                  onChange={(e) => setField("checkpoint_id", e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="">なし</option>
                  {checkpoints.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              計画値
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { f: "planned_cert_rate" as const, label: "認定率 (%)" },
                { f: "planned_recep_rate" as const, label: "受給率 (%)" },
                { f: "planned_unit_benefit" as const, label: "単位給付費 (万円)" },
                { f: "planned_users" as const, label: "利用者数 (人)" },
                { f: "planned_benefit" as const, label: "給付費 (万円)" },
              ].map(({ f, label }) => (
                <div key={f}>
                  <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                  <input
                    type="number"
                    value={form[f]}
                    onChange={(e) => setField(f, e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>

            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              実績値
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { f: "actual_cert_rate" as const, label: "認定率 (%)" },
                { f: "actual_recep_rate" as const, label: "受給率 (%)" },
                { f: "actual_unit_benefit" as const, label: "単位給付費 (万円)" },
                { f: "actual_users" as const, label: "利用者数 (人)" },
                { f: "actual_benefit" as const, label: "給付費 (万円)" },
              ].map(({ f, label }) => (
                <div key={f}>
                  <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                  <input
                    type="number"
                    value={form[f]}
                    onChange={(e) => setField(f, e.target.value)}
                    className={inputClass}
                    style={inputStyle}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">乖離メモ</label>
              <textarea
                value={form.deviation_notes}
                onChange={(e) => setField("deviation_notes", e.target.value)}
                className={inputClass}
                style={inputStyle}
                rows={2}
              />
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setFormError(null);
                  setForm(emptyForm());
                }}
                className="text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-300 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={submitting || !form.service_name || !form.fiscal_year}
                className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {submitting ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
