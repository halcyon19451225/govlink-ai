"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "@/components/BackButton";

interface KpiRow {
  label: string;
  target: string;
  unit: string;
}

const STATUS_OPTIONS = [
  { value: "draft", label: "計画中" },
  { value: "active", label: "実施中" },
  { value: "completed", label: "完了" },
] as const;

type Status = (typeof STATUS_OPTIONS)[number]["value"];

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "#1a1d27", borderColor: "#2a2d3a" };

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState<Status>("draft");
  const [kpis, setKpis] = useState<KpiRow[]>([{ label: "", target: "", unit: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addKpi = () => {
    if (kpis.length < 5) setKpis([...kpis, { label: "", target: "", unit: "" }]);
  };

  const removeKpi = (index: number) => setKpis(kpis.filter((_, i) => i !== index));

  const updateKpi = (index: number, field: keyof KpiRow, value: string) =>
    setKpis(kpis.map((kpi, i) => (i === index ? { ...kpi, [field]: value } : kpi)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          department,
          status,
          kpis: kpis.filter((k) => k.label.trim()),
        }),
      });

      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "登録に失敗しました");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("通信エラーが発生しました");
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
        新規政策を登録
      </h2>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border p-6 space-y-5"
        style={{
          background: "#1a1d27",
          borderColor: "#2a2d3a",
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        {error && (
          <div
            className="rounded-lg border px-4 py-3 text-sm text-red-400"
            style={{ background: "#ef444410", borderColor: "#ef444430" }}
          >
            {error}
          </div>
        )}

        {/* 政策名 */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            政策名 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            style={inputStyle}
            placeholder="例: 待機児童ゼロ推進プロジェクト"
          />
        </div>

        {/* 概要 */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">概要</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass}
            style={inputStyle}
            placeholder="政策の概要を入力してください"
          />
        </div>

        {/* 担当課 */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            担当課 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            required
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={inputClass}
            style={inputStyle}
            placeholder="例: 子ども家庭支援課"
          />
        </div>

        {/* ステータス */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">ステータス</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
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

        {/* KPI */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-300">
              KPI{" "}
              <span className="text-xs text-slate-500 font-normal">（最大 5 件）</span>
            </label>
            {kpis.length < 5 && (
              <button
                type="button"
                onClick={addKpi}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors duration-200 border rounded-lg px-3 py-1"
                style={{ borderColor: "#06b6d430", background: "#06b6d410" }}
              >
                ＋ 追加
              </button>
            )}
          </div>
          <div className="space-y-2">
            {kpis.map((kpi, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={kpi.label}
                  onChange={(e) => updateKpi(i, "label", e.target.value)}
                  className={`flex-1 ${inputClass}`}
                  style={inputStyle}
                  placeholder="ラベル（例: 待機児童数）"
                />
                <input
                  type="number"
                  value={kpi.target}
                  onChange={(e) => updateKpi(i, "target", e.target.value)}
                  className={`w-28 ${inputClass}`}
                  style={inputStyle}
                  placeholder="目標値"
                  min="0"
                  step="any"
                />
                <input
                  type="text"
                  value={kpi.unit}
                  onChange={(e) => updateKpi(i, "unit", e.target.value)}
                  className={`w-20 ${inputClass}`}
                  style={inputStyle}
                  placeholder="単位"
                />
                {kpis.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeKpi(i)}
                    className="text-slate-500 hover:text-red-400 transition-colors duration-200 text-xl leading-none"
                    aria-label="削除"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 送信 */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {submitting ? "登録中..." : "登録する"}
          </button>
          <a
            href="/dashboard"
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 inline-flex items-center transition-colors duration-200"
          >
            キャンセル
          </a>
        </div>
      </form>
    </div>
  );
}
