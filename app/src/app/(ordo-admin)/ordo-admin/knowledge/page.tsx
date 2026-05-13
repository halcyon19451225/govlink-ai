"use client";

import { useState, useEffect, useRef } from "react";

interface KnowledgeDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_type: string;
  file_size_bytes: number | null;
  document_category: string | null;
  status: "pending" | "processing" | "compiled" | "error";
  error_message: string | null;
  created_at: string;
  compiled_at: string | null;
}

interface DictSection {
  id: string;
  title: string;
  category: string;
  summary: string;
  key_points: string[];
  planning_implications: string[];
  terms: Record<string, string>;
  source_document_ids: string[];
  last_updated: string;
}

interface KnowledgeDict {
  version: number;
  last_compiled?: string;
  sections: DictSection[];
  global_terms: Record<string, string>;
  planning_checklist: string[];
}

const FALLBACK_BADGE = { label: "未処理", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", blink: false };
const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; blink?: boolean }> = {
  pending: { label: "未処理", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  processing: { label: "処理中", color: "#60a5fa", bg: "rgba(96,165,250,0.12)", blink: true },
  compiled: { label: "完了", color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  error: { label: "エラー", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const CATEGORY_LABEL: Record<string, string> = {
  law: "法令",
  guideline: "基本指針・通知",
  research: "調査研究",
  plan: "計画書",
  policy: "策定方針",
  ordinance: "条例",
  other: "その他",
};

export default function OrdoKnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [dict, setDict] = useState<KnowledgeDict | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadModal, setUploadModal] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  const fetchDocs = async () => {
    const res = await fetch("/api/ordo-admin/knowledge/documents");
    const json = await res.json() as { data: KnowledgeDocument[] | null };
    setDocs(json.data ?? []);
  };

  const fetchDict = async () => {
    const res = await fetch("/api/ordo-admin/knowledge/dict");
    const json = await res.json() as { data: { dict_data: KnowledgeDict } | null };
    if (json.data) setDict(json.data.dict_data);
  };

  useEffect(() => {
    Promise.all([fetchDocs(), fetchDict()]).finally(() => setLoading(false));
  }, []);

  const startCompile = async (docId: string) => {
    setProcessing((s) => new Set(s).add(docId));
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, status: "processing" } : d));
    try {
      await fetch(`/api/ordo-admin/knowledge/compile/${docId}`, { method: "POST" });
      await Promise.all([fetchDocs(), fetchDict()]);
    } finally {
      setProcessing((s) => { const n = new Set(s); n.delete(docId); return n; });
    }
  };

  const toggleSection = (id: string) => {
    setExpandedSections((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  const exportDict = () => {
    const blob = new Blob([JSON.stringify(dict, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge_dict_tier1_v${dict?.version ?? 0}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          ナレッジ管理（Tier 1）
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Ordoシステム共通のナレッジ文書管理・AI辞書構築
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左: ドキュメント一覧 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              アップロード文書
            </h2>
            <button
              onClick={() => setUploadModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              + ドキュメントをアップロード
            </button>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {docs.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                ドキュメントがありません
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["タイトル", "カテゴリ", "ステータス", "日付", "操作"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold"
                        style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => {
                    const badge = STATUS_BADGE[doc.status] ?? FALLBACK_BADGE;
                    return (
                      <tr key={doc.id} className="hover:bg-white/3 transition-colors"
                        style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-3 py-2">
                          <p className="font-medium truncate max-w-[140px]"
                            style={{ color: "var(--text-primary)" }} title={doc.title}>
                            {doc.title}
                          </p>
                          <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                            {doc.file_name}
                          </p>
                        </td>
                        <td className="px-3 py-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                          {doc.document_category ? CATEGORY_LABEL[doc.document_category] ?? doc.document_category : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${badge.blink ? "animate-pulse" : ""}`}
                            style={{ background: badge.bg, color: badge.color }}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap"
                          style={{ color: "var(--text-secondary)" }}>
                          {new Date(doc.created_at).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-3 py-2">
                          {doc.status === "pending" || doc.status === "error" ? (
                            <button
                              onClick={() => void startCompile(doc.id)}
                              disabled={processing.has(doc.id)}
                              className="text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                              style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}
                            >
                              AI処理
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 右: ナレッジ辞書 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              ナレッジ辞書
              {dict && (
                <span className="ml-2 text-sm font-normal" style={{ color: "var(--text-secondary)" }}>
                  v{dict.version} · {dict.sections.length}セクション
                </span>
              )}
            </h2>
            {dict && dict.sections.length > 0 && (
              <button
                onClick={exportDict}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}
              >
                辞書をエクスポート（JSON）
              </button>
            )}
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {!dict || dict.sections.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                辞書にセクションがありません
              </div>
            ) : (
              <div>
                {dict.sections.map((section) => {
                  const expanded = expandedSections.has(section.id);
                  return (
                    <div key={section.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <button
                        onClick={() => toggleSection(section.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/3 transition-colors text-left"
                      >
                        <span className="text-sm" style={{ color: expanded ? "var(--accent)" : "var(--text-primary)" }}>
                          {expanded ? "▼" : "▶"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
                            {section.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-1.5 py-0.5 rounded"
                              style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
                              {CATEGORY_LABEL[section.category] ?? section.category}
                            </span>
                            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              要点 {section.key_points.length}件
                            </span>
                            {section.last_updated && (
                              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                更新: {new Date(section.last_updated).toLocaleDateString("ja-JP")}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {expanded && (
                        <div className="px-4 pb-4 space-y-3" style={{ background: "rgba(0,0,0,0.15)" }}>
                          {section.summary && (
                            <div>
                              <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>要約</p>
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
                                    <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>{kp}
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
                          {Object.keys(section.terms ?? {}).length > 0 && (
                            <div>
                              <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>用語集</p>
                              <div className="space-y-1">
                                {Object.entries(section.terms).map(([term, def]) => (
                                  <div key={term} className="text-xs">
                                    <span className="font-medium" style={{ color: "var(--accent)" }}>{term}</span>
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
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {uploadModal && (
        <UploadModal
          onClose={() => setUploadModal(false)}
          onUploaded={async () => {
            setUploadModal(false);
            await fetchDocs();
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
      const res = await fetch("/api/ordo-admin/knowledge/upload", { method: "POST", body: form });
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="例: 介護保険法（令和6年改正版）"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>説明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="文書の概要（任意）"
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
              {file ? (
                <span style={{ color: "var(--text-primary)" }}>{file.name}</span>
              ) : (
                "PDF / Word ファイルを選択"
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
              キャンセル
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {uploading ? "アップロード中..." : "アップロード"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
