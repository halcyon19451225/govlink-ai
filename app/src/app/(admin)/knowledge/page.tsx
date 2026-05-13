"use client";

import { useState, useEffect, useRef } from "react";

interface DictSection {
  id: string;
  title: string;
  category: string;
  summary: string;
  key_points: string[];
  planning_implications: string[];
  terms?: Record<string, string>;
}

interface MergedDict {
  tier1_version: number;
  tier2_id: string | null;
  sections: DictSection[];
  global_terms: Record<string, string>;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  file_name: string;
  file_type: string;
  document_category: string | null;
  status: "pending" | "processing" | "compiled" | "error";
  created_at: string;
}

const FALLBACK_BADGE = { label: "未処理", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", blink: false };
const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; blink?: boolean }> = {
  pending: { label: "未処理", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  processing: { label: "処理中", color: "#60a5fa", bg: "rgba(96,165,250,0.12)", blink: true },
  compiled: { label: "完了", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  error: { label: "エラー", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const CATEGORY_LABEL: Record<string, string> = {
  law: "法令", guideline: "基本指針・通知", research: "調査研究",
  plan: "計画書", policy: "策定方針", ordinance: "条例", other: "その他",
};

const CATEGORY_COLOR: Record<string, string> = {
  law: "#6366f1", guideline: "#06b6d4", research: "#10b981",
  plan: "#f59e0b", policy: "#a855f7", ordinance: "#ef4444", other: "#64748b",
};

export default function KnowledgePage() {
  const [dict, setDict] = useState<MergedDict | null>(null);
  const [tier2Docs, setTier2Docs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [uploadModal, setUploadModal] = useState(false);
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    const [dictRes, docsRes] = await Promise.all([
      fetch("/api/admin/knowledge/dict").then((r) => r.json()) as Promise<{ data: MergedDict | null }>,
      fetch("/api/admin/knowledge/documents").then((r) => r.json()) as Promise<{ data: KnowledgeDocument[] | null }>,
    ]);
    if (dictRes.data) setDict(dictRes.data);
    setTier2Docs(docsRes.data ?? []);
  };

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (id: string) => {
    setExpandedSections((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  const startCompile = async (docId: string) => {
    setProcessing((s) => new Set(s).add(docId));
    setTier2Docs((prev) => prev.map((d) => d.id === docId ? { ...d, status: "processing" } : d));
    try {
      await fetch(`/api/admin/knowledge/compile/${docId}`, { method: "POST" });
      await fetchData();
    } finally {
      setProcessing((s) => { const n = new Set(s); n.delete(docId); return n; });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
      </div>
    );
  }

  const allSections = dict?.sections ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>ナレッジ管理</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          行政計画策定に活用できるナレッジ辞書の閲覧・管理
        </p>
      </div>

      {/* Tier1ナレッジ閲覧 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Ordoシステムナレッジ（Tier 1）
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              v{dict?.tier1_version ?? 0} · {allSections.length}セクション
            </p>
          </div>
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          {allSections.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              ナレッジデータがありません（運営側が登録予定）
            </div>
          ) : (
            allSections.map((section) => {
              const expanded = expandedSections.has(section.id);
              const catColor = CATEGORY_COLOR[section.category] ?? "#64748b";
              return (
                <div key={section.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/3 transition-colors text-left"
                  >
                    <span className="text-sm" style={{ color: expanded ? catColor : "var(--text-secondary)" }}>
                      {expanded ? "▼" : "▶"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
                        {section.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: `${catColor}20`, color: catColor }}>
                          {CATEGORY_LABEL[section.category] ?? section.category}
                        </span>
                        {section.key_points.length > 0 && (
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                            要点 {section.key_points.length}件
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  {expanded && (
                    <div className="px-4 pb-4 space-y-3" style={{ background: "rgba(0,0,0,0.12)" }}>
                      {section.summary && (
                        <div>
                          <p className="text-xs font-semibold mb-1 mt-2" style={{ color: "var(--text-secondary)" }}>要約</p>
                          <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                            {section.summary}
                          </p>
                        </div>
                      )}
                      {section.key_points.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>キーポイント</p>
                          <ul className="space-y-1">
                            {section.key_points.map((kp, i) => (
                              <li key={i} className="text-sm flex gap-2" style={{ color: "var(--text-primary)" }}>
                                <span style={{ color: catColor, flexShrink: 0 }}>•</span>{kp}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {section.planning_implications.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>計画策定上の含意</p>
                          <ul className="space-y-1">
                            {section.planning_implications.map((pi, i) => (
                              <li key={i} className="text-sm flex gap-2" style={{ color: "var(--text-primary)" }}>
                                <span style={{ color: "#10b981", flexShrink: 0 }}>→</span>{pi}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {section.terms && Object.keys(section.terms).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>用語集</p>
                          <div className="space-y-1">
                            {Object.entries(section.terms).map(([term, def]) => (
                              <div key={term} className="text-xs">
                                <span className="font-medium" style={{ color: catColor }}>{term}</span>
                                <span style={{ color: "var(--text-secondary)" }}>: {def}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Tier2: 自自治体ナレッジ */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              自治体独自ナレッジ（Tier 2）
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              自治体固有の文書・条例・計画をアップロードしてAI辞書化
            </p>
          </div>
          <button
            onClick={() => setUploadModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            + ドキュメントをアップロード
          </button>
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          {tier2Docs.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              ドキュメントがありません
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["タイトル", "カテゴリ", "ステータス", "アップロード日", "操作"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold"
                      style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tier2Docs.map((doc) => {
                  const badge = STATUS_BADGE[doc.status] ?? FALLBACK_BADGE;
                  return (
                    <tr key={doc.id} className="hover:bg-white/3"
                      style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium" style={{ color: "var(--text-primary)" }}>{doc.title}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{doc.file_name}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {doc.document_category ? CATEGORY_LABEL[doc.document_category] ?? doc.document_category : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${badge.blink ? "animate-pulse" : ""}`}
                          style={{ background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {new Date(doc.created_at).toLocaleDateString("ja-JP")}
                      </td>
                      <td className="px-4 py-2.5">
                        {(doc.status === "pending" || doc.status === "error") && (
                          <button
                            onClick={() => void startCompile(doc.id)}
                            disabled={processing.has(doc.id)}
                            className="text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                            style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}
                          >
                            AI処理
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {uploadModal && (
        <UploadModal
          onClose={() => setUploadModal(false)}
          onUploaded={async () => {
            setUploadModal(false);
            await fetchData();
          }}
        />
      )}
    </div>
  );
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !file) { setError("タイトルとファイルは必須です"); return; }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("description", description);
      form.append("file", file);
      const res = await fetch("/api/admin/knowledge/upload", { method: "POST", body: form });
      const json = await res.json() as { error?: string | null };
      if (json.error) { setError(json.error); return; }
      await onUploaded();
    } catch {
      setError("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            ドキュメントをアップロード
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              タイトル <span className="text-red-400">*</span>
            </label>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="文書タイトル"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>説明</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="概要（任意）"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              ファイル <span className="text-red-400">*</span>
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="rounded-xl px-3 py-4 text-sm text-center cursor-pointer hover:bg-white/5 transition-colors"
              style={{ border: "1px dashed var(--border)", color: "var(--text-secondary)" }}
            >
              {file ? <span style={{ color: "var(--text-primary)" }}>{file.name}</span> : "PDF / Word ファイルを選択"}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
              キャンセル
            </button>
            <button type="submit" disabled={uploading}
              className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}>
              {uploading ? "アップロード中..." : "アップロード"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
