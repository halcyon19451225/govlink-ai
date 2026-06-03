"use client";

import { useState, useEffect } from "react";
import UpgradeModal from "../../../../../components/UpgradeModal";

interface KpiRow {
  id: string;
  label: string;
}

interface DocumentRow {
  id: string;
  title: string;
}

interface EvidenceRow {
  id: string;
  output_kpi_id: string | null;
  outcome_kpi_id: string | null;
  output_kpi_label: string | null;
  outcome_kpi_label: string | null;
  evidence_type: string;
  strength: number;
  title: string;
  description: string | null;
  source_url: string | null;
  document_id: string | null;
  ai_validity: string | null;
  created_at: string;
}

const EVIDENCE_TYPE_OPTIONS = [
  { value: "rct", label: "RCT（ランダム化比較試験）" },
  { value: "observational", label: "観察研究" },
  { value: "case_study", label: "事例研究" },
  { value: "expert", label: "専門家意見" },
  { value: "statistics", label: "統計データ" },
  { value: "other", label: "その他" },
];

const STRENGTH_BADGE = ["", "bg-red-500/20 text-red-300", "bg-amber-500/20 text-amber-300", "bg-yellow-500/20 text-yellow-300", "bg-cyan-500/20 text-cyan-300", "bg-emerald-500/20 text-emerald-300"];

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const cardStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

export default function EvidencesClient({
  projectId,
  kpis,
  documents,
}: {
  projectId: string;
  kpis: KpiRow[];
  documents: DocumentRow[];
}) {
  const [evidences, setEvidences] = useState<EvidenceRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);

  const [outputKpiId, setOutputKpiId] = useState("");
  const [outcomeKpiId, setOutcomeKpiId] = useState("");
  const [evidenceType, setEvidenceType] = useState("other");
  const [strength, setStrength] = useState(3);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [documentId, setDocumentId] = useState("");

  const load = async () => {
    const res = await fetch(`/api/admin/evidences?projectId=${projectId}`);
    const json = (await res.json()) as { data: EvidenceRow[]; error: string | null };
    if (json.data) setEvidences(json.data);
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/evidences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          outputKpiId: outputKpiId || null,
          outcomeKpiId: outcomeKpiId || null,
          evidenceType,
          strength,
          title,
          description,
          sourceUrl,
          documentId: documentId || null,
        }),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok) { setError(json.error ?? "登録に失敗しました"); return; }
      setTitle(""); setDescription(""); setSourceUrl("");
      setOutputKpiId(""); setOutcomeKpiId(""); setDocumentId("");
      setStrength(3); setEvidenceType("other");
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEvaluate = async (ev: EvidenceRow) => {
    if (!ev.description) { setError("説明を入力してからAI評価を実行してください"); return; }
    setEvaluating(ev.id);
    setError(null);
    try {
      const res = await fetch("/api/ai/evaluate-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceId: ev.id,
          description: ev.description,
          evidenceType: ev.evidence_type,
          strength: ev.strength,
        }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null; upgrade_url?: string };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "AI生成回数の上限に達しました");
        } else {
          setError(json.error ?? "評価に失敗しました");
        }
        return;
      }
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setEvaluating(null);
    }
  };

  return (
    <>
    {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
    <div className="space-y-8">
      {/* 登録フォーム */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border p-6 space-y-4"
        style={cardStyle}
      >
        <h3 className="text-sm font-semibold text-slate-300">エビデンスを登録</h3>

        {error && (
          <div
            className="rounded-lg border px-4 py-3 text-sm text-red-400"
            style={{ background: "#ef444410", borderColor: "#ef444430" }}
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              タイトル <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例: 子育て支援策の効果に関するRCT"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">エビデンス種別</label>
            <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} className={inputClass} style={inputStyle}>
              {EVIDENCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "var(--bg-secondary)" }}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">アウトプット指標</label>
            <select value={outputKpiId} onChange={(e) => setOutputKpiId(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="" style={{ background: "var(--bg-secondary)" }}>なし</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id} style={{ background: "var(--bg-secondary)" }}>{k.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">アウトカム指標</label>
            <select value={outcomeKpiId} onChange={(e) => setOutcomeKpiId(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="" style={{ background: "var(--bg-secondary)" }}>なし</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id} style={{ background: "var(--bg-secondary)" }}>{k.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 強度スライダー */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
            強度評価: <span className="text-slate-200">★{strength}</span>
          </label>
          <input
            type="range"
            min={1}
            max={5}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>★1 弱い</span><span>★3 中程度</span><span>★5 強い</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">説明</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={inputClass}
            style={inputStyle}
            placeholder="エビデンスの内容・方法・結果を記述してください"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">参照URL（任意）</label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">関連ドキュメント（任意）</label>
            <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="" style={{ background: "var(--bg-secondary)" }}>なし</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id} style={{ background: "var(--bg-secondary)" }}>{d.title}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="text-white px-5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {submitting ? "登録中..." : "登録する"}
        </button>
      </form>

      {/* 因果関係マップ + 一覧 */}
      {evidences.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            因果関係マップ
          </h3>
          <div className="space-y-3">
            {evidences.map((ev) => (
              <div key={ev.id} className="rounded-xl border p-5 space-y-3" style={cardStyle}>
                {/* 因果フロー */}
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  {ev.output_kpi_label ? (
                    <span className="px-2.5 py-1 rounded-lg border text-slate-300" style={{ borderColor: "#6366f130", background: "#6366f110" }}>
                      {ev.output_kpi_label}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg border text-slate-500" style={{ borderColor: "var(--border)" }}>指標未設定</span>
                  )}
                  <span className="text-slate-500 flex items-center gap-1">
                    →
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STRENGTH_BADGE[ev.strength] ?? ""}`}>
                      ★{ev.strength}
                    </span>
                    →
                  </span>
                  {ev.outcome_kpi_label ? (
                    <span className="px-2.5 py-1 rounded-lg border text-slate-300" style={{ borderColor: "#06b6d430", background: "#06b6d410" }}>
                      {ev.outcome_kpi_label}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg border text-slate-500" style={{ borderColor: "var(--border)" }}>指標未設定</span>
                  )}
                </div>

                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs text-slate-500">
                        {EVIDENCE_TYPE_OPTIONS.find((o) => o.value === ev.evidence_type)?.label ?? ev.evidence_type}
                      </span>
                      <span className="text-xs text-slate-600">
                        {new Date(ev.created_at).toLocaleDateString("ja-JP")}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-100">{ev.title}</p>
                    {ev.description && (
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{ev.description}</p>
                    )}
                    {ev.source_url && (
                      <a
                        href={ev.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-indigo-400 hover:text-indigo-300 mt-1 inline-block"
                      >
                        参照元 ↗
                      </a>
                    )}
                  </div>
                  {!ev.ai_validity && (
                    <button
                      onClick={() => handleEvaluate(ev)}
                      disabled={evaluating === ev.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors duration-200 text-cyan-400 hover:text-cyan-300 disabled:opacity-40 shrink-0"
                      style={{ borderColor: "#06b6d430", background: "#06b6d410" }}
                    >
                      {evaluating === ev.id ? "評価中..." : "AIで妥当性を評価"}
                    </button>
                  )}
                </div>

                {ev.ai_validity && (
                  <div
                    className="rounded-lg px-3 py-2.5 border-l-2"
                    style={{ background: "#6366f110", borderLeftColor: "#6366f1" }}
                  >
                    <p className="text-xs font-semibold text-indigo-400 mb-1">AI妥当性評価</p>
                    <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                      {ev.ai_validity}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {evidences.length === 0 && (
        <div
          className="rounded-2xl border border-dashed p-10 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm text-slate-500">エビデンスがまだ登録されていません</p>
        </div>
      )}
    </div>
    </>
  );
}
