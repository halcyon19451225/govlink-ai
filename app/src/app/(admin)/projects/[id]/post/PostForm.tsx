"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UpgradeModal from "../../../../../components/UpgradeModal";

export interface KpiForForm {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
}

interface Props {
  projectId: string;
  projectTitle: string;
  kpis: KpiForForm[];
}

const POST_TYPE_OPTIONS = [
  { value: "plan", label: "計画" },
  { value: "progress", label: "進捗" },
  { value: "result", label: "成果" },
] as const;

type PostType = (typeof POST_TYPE_OPTIONS)[number]["value"];

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

export default function PostForm({ projectId, projectTitle, kpis }: Props) {
  const router = useRouter();
  const [postType, setPostType] = useState<PostType>("progress");
  const [body, setBody] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);
  const [kpiUpdates, setKpiUpdates] = useState<Record<string, string>>(
    Object.fromEntries(kpis.map((k) => [k.id, String(k.current)])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateSummary = async () => {
    if (!body.trim()) {
      setSummaryError("先に本文を入力してください");
      return;
    }
    setGeneratingSummary(true);
    setSummaryError(null);
    setAiSummary("");

    const kpiContext = kpis.map((k) => ({
      label: k.label,
      target: Number(k.target),
      current: Number(kpiUpdates[k.id] ?? k.current),
      unit: k.unit,
    }));

    try {
      const res = await fetch("/api/ai/generate-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectTitle, postType, body, kpiUpdates: kpiContext }),
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({ error: null }))) as {
          error: string | null; upgrade_url?: string;
        };
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "AI生成回数の上限に達しました");
        } else {
          setSummaryError(json.error ?? "サマリー生成に失敗しました");
        }
        setGeneratingSummary(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__ERROR__:")) {
          setSummaryError(chunk.replace("__ERROR__:", "").trim());
          setGeneratingSummary(false);
          return;
        }
        accumulated += chunk;
        setAiSummary(accumulated);
      }
    } catch {
      setSummaryError("通信エラーが発生しました");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setError("本文を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);

    const updates = kpis
      .map((k) => ({ id: k.id, current: Number(kpiUpdates[k.id] ?? k.current) }))
      .filter((u) => !isNaN(u.current));

    try {
      const res = await fetch("/api/admin/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type: postType,
          body,
          aiSummary: aiSummary.trim() || undefined,
          kpiUpdates: updates,
        }),
      });

      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "投稿に失敗しました");
        return;
      }
      router.push(`/projects/${projectId}`);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
    {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
    <div className="max-w-2xl">
      <div className="mb-6">
        <a
          href={`/projects/${projectId}`}
          className="text-sm text-slate-500 hover:text-slate-300 transition-colors duration-200"
        >
          ← {projectTitle}
        </a>
        <h2 className="text-2xl font-bold text-slate-100 mt-2">進捗を報告する</h2>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border p-6 space-y-5"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
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

        {/* 投稿タイプ */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">投稿タイプ</label>
          <div className="flex gap-4">
            {POST_TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="postType"
                  value={opt.value}
                  checked={postType === opt.value}
                  onChange={() => setPostType(opt.value)}
                  className="accent-indigo-500"
                />
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors duration-200">
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* 本文 */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            本文 <span className="text-red-400">*</span>
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            required
            className={inputClass}
            style={inputStyle}
            placeholder="進捗内容を入力してください"
          />
        </div>

        {/* AIサマリー生成 */}
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ background: "#06b6d408", borderColor: "#06b6d420" }}
        >
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300">
              AIサマリー
              <span className="ml-2 text-xs text-slate-500 font-normal">（住民向け要約・任意）</span>
            </label>
            <button
              type="button"
              onClick={handleGenerateSummary}
              disabled={generatingSummary || !body.trim()}
              className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
              style={{ background: "#06b6d4" }}
            >
              {generatingSummary ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  生成中...
                </>
              ) : (
                "AIサマリーを生成"
              )}
            </button>
          </div>

          {summaryError && (
            <p className="text-xs text-red-400">{summaryError}</p>
          )}

          <textarea
            value={aiSummary}
            onChange={(e) => setAiSummary(e.target.value)}
            rows={3}
            className={inputClass}
            style={{ background: "#12151f", borderColor: "var(--border)" }}
            placeholder="「AIサマリーを生成」ボタンで自動生成、または手動で入力できます"
          />
        </div>

        {/* KPI 現在値 */}
        {kpis.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              KPI 現在値を更新
            </label>
            <div className="space-y-2">
              {kpis.map((kpi) => (
                <div key={kpi.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-slate-400">
                    {kpi.label}
                    <span className="ml-1 text-xs text-slate-600">
                      （目標: {kpi.target}{kpi.unit}）
                    </span>
                  </span>
                  <input
                    type="number"
                    value={kpiUpdates[kpi.id] ?? kpi.current}
                    onChange={(e) =>
                      setKpiUpdates((prev) => ({ ...prev, [kpi.id]: e.target.value }))
                    }
                    step="any"
                    className="w-32 rounded-lg border px-3 py-2 text-sm text-slate-100 text-right focus:outline-none focus:border-indigo-500 transition-colors duration-200"
                    style={inputStyle}
                  />
                  {kpi.unit && (
                    <span className="text-sm text-slate-500 w-10">{kpi.unit}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 送信 */}
        <div className="flex gap-3 pt-2">
          <div className="neu-button-wrap">
            <button
            type="submit"
            disabled={submitting}
            className="text-white px-6 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {submitting ? "投稿中..." : "投稿する"}
          </button>
          </div>
          <a
            href={`/projects/${projectId}`}
            className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 inline-flex items-center transition-colors duration-200"
          >
            キャンセル
          </a>
        </div>
      </form>
    </div>
    </>
  );
}
