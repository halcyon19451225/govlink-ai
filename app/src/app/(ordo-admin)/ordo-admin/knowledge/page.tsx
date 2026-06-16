"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MAX_FILE_SIZE_BYTES, ALLOWED_FILE_TYPES, formatBytes, estimateProcessingSeconds } from "@/lib/knowledge-config";
import { runCompile, retryCompile, type CompileState } from "@/lib/runCompile";

// ─── 型定義 ───────────────────────────────────────────────

interface KnowledgeTag {
  id: string;
  name: string;
  slug: string;
  pdca_phase: string;
}

interface TagsResponse {
  tags: KnowledgeTag[];
  grouped: Record<string, KnowledgeTag[]>;
}

interface KnowledgeCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_type: string;
  file_size_bytes: number | null;
  category_id: string | null;
  status: "pending" | "processing" | "compiled" | "error";
  processing_step: string | null;
  processing_progress: number | null;
  error_message: string | null;
  created_at: string;
  tags: KnowledgeTag[];
}

// ─── 定数 ─────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; blink?: boolean }> = {
  pending:    { label: "未処理",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  processing: { label: "処理中",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)", blink: true },
  compiled:   { label: "完了",    color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  error:      { label: "エラー",  color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const PDCA_LABEL: Record<string, string> = {
  P: "Plan（計画）",
  D: "Do（実施）",
  C: "Check（評価）",
  A: "Act（改善）",
  common: "共通",
};

const PDCA_ORDER = ["P", "D", "C", "A", "common"];

// ─── メインコンポーネント ─────────────────────────────────

export default function OrdoKnowledgePage() {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadModal, setUploadModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  // docId → コンパイル進捗（タイムライン表示用）
  const [compileStates, setCompileStates] = useState<Record<string, CompileState>>({});
  const [timelineDocId, setTimelineDocId] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    const res = await fetch("/api/ordo-admin/knowledge/categories");
    const json = await res.json() as { data: KnowledgeCategory[] | null };
    const cats = json.data ?? [];
    setCategories(cats);
    if (!selectedCategoryId && cats.length > 0) {
      setSelectedCategoryId(cats[0]!.id);
    }
  }, [selectedCategoryId]);

  const fetchDocs = useCallback(async (catId?: string | null) => {
    const id = catId ?? selectedCategoryId;
    const url = id
      ? `/api/ordo-admin/knowledge/documents?category_id=${id}`
      : "/api/ordo-admin/knowledge/documents";
    const res = await fetch(url);
    const json = await res.json() as { data: KnowledgeDocument[] | null };
    setDocs(json.data ?? []);
  }, [selectedCategoryId]);

  useEffect(() => {
    Promise.all([fetchCategories()]).finally(() => setLoading(false));
  }, [fetchCategories]);

  useEffect(() => {
    void fetchDocs(selectedCategoryId);
  }, [selectedCategoryId, fetchDocs]);

  const handleCategoryChange = (id: string) => {
    setSelectedCategoryId(id);
  };

  const startCompile = async (docId: string, isRetry = false) => {
    setProcessing((s) => new Set(s).add(docId));
    setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, status: "processing" } : d));
    setTimelineDocId(docId);

    const onProgress = (state: CompileState) => {
      setCompileStates((prev) => ({ ...prev, [docId]: state }));
      if (state.done || state.error) {
        setProcessing((s) => { const n = new Set(s); n.delete(docId); return n; });
        void fetchDocs();
      }
    };

    if (isRetry) {
      void retryCompile(docId, onProgress);
    } else {
      void runCompile(docId, onProgress);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中...</div>
      </div>
    );
  }

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          ナレッジ管理（Tier 1）
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Ordoシステム共通のナレッジ文書管理・AI辞書構築
        </p>
      </div>

      {/* カテゴリーバー */}
      <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium shrink-0" style={{ color: "var(--text-secondary)" }}>
          カテゴリー:
        </span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={
                selectedCategoryId === cat.id
                  ? { background: cat.color, color: "#fff", boxShadow: `0 0 0 2px ${cat.color}40` }
                  : { background: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}30` }
              }
            >
              {cat.name}
            </button>
          ))}
          {categories.length === 0 && (
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              カテゴリーがありません
            </span>
          )}
        </div>
        <button
          onClick={() => setCategoryModal(true)}
          className="px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shrink-0"
          style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.2)" }}
        >
          ＋ カテゴリを追加 / 管理
        </button>
      </div>

      {/* メインコンテンツ: 左=ドキュメント一覧, 右=辞書ビューア */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* 左カラム: ドキュメント一覧 + タイムライン */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {selectedCategory ? selectedCategory.name : "全ドキュメント"}
              <span className="ml-2 text-sm font-normal" style={{ color: "var(--text-secondary)" }}>
                {docs.length}件
              </span>
            </h2>
            <button
              onClick={() => setUploadModal(true)}
              disabled={!selectedCategoryId}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              ＋ ドキュメントをアップロード
            </button>
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {docs.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                このカテゴリーにドキュメントがありません
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["タイトル", "タグ", "ステータス", "日付", "操作"].map((h) => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold"
                        style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => {
                    const badge = (STATUS_BADGE[doc.status] ?? STATUS_BADGE["pending"])!;
                    return (
                      <tr key={doc.id} className="hover:bg-white/3 transition-colors"
                        style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-3 py-2">
                          <p className="font-medium truncate max-w-[130px]"
                            style={{ color: "var(--text-primary)" }} title={doc.title}>
                            {doc.title}
                          </p>
                          <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                            {doc.file_name}
                            {doc.file_size_bytes ? ` · ${formatBytes(doc.file_size_bytes)}` : ""}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {doc.tags.length === 0 && (
                              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>—</span>
                            )}
                            {doc.tags.slice(0, 2).map((tag) => (
                              <span key={tag.id} className="text-[10px] px-1.5 py-0.5 rounded-full"
                                style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
                                {tag.name}
                              </span>
                            ))}
                            {doc.tags.length > 2 && (
                              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>+{doc.tags.length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.blink ? "animate-pulse" : ""}`}
                              style={{ background: badge.bg, color: badge.color }}>
                              {badge.label}
                            </span>
                            {doc.status === "processing" && doc.processing_progress != null && (
                              <div className="w-14 h-1 rounded-full overflow-hidden" style={{ background: "rgba(96,165,250,0.2)" }}>
                                <div className="h-full rounded-full transition-all"
                                  style={{ width: `${doc.processing_progress}%`, background: "#60a5fa" }} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {new Date(doc.created_at).toLocaleDateString("ja-JP")}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {doc.status === "pending" && (
                              <button onClick={() => void startCompile(doc.id)} disabled={processing.has(doc.id)}
                                className="text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                                style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                                AI処理
                              </button>
                            )}
                            {doc.status === "error" && (
                              <button onClick={() => void startCompile(doc.id, true)} disabled={processing.has(doc.id)}
                                className="text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                                style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                                再試行
                              </button>
                            )}
                            <button
                              onClick={() => setTimelineDocId(timelineDocId === doc.id ? null : doc.id)}
                              className="text-xs px-2 py-1 rounded-lg transition-colors"
                              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
                              ログ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* タイムラインパネル */}
          {timelineDocId && (() => {
            const timelineDoc = docs.find((d) => d.id === timelineDocId);
            const cs = compileStates[timelineDocId];
            return timelineDoc ? (
              <CompileTimeline
                doc={timelineDoc}
                compileState={cs}
                onClose={() => setTimelineDocId(null)}
                onRetry={() => void startCompile(timelineDocId, true)}
              />
            ) : null;
          })()}
        </div>

        {/* 右カラム: 辞書ビューア */}
        <KnowledgeDictViewer
          categoryId={selectedCategoryId}
          categoryName={selectedCategory?.name ?? null}
        />
      </div>

      {/* モーダル類 */}
      {uploadModal && (
        <UploadModal
          categoryId={selectedCategoryId!}
          onClose={() => setUploadModal(false)}
          onUploaded={async (docId) => {
            setUploadModal(false);
            await fetchDocs();
            void startCompile(docId);
          }}
        />
      )}

      {categoryModal && (
        <CategoryModal
          categories={categories}
          onClose={() => setCategoryModal(false)}
          onChanged={async () => { await fetchCategories(); }}
        />
      )}
    </div>
  );
}

// ─── カテゴリ管理モーダル ──────────────────────────────────

function CategoryModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: KnowledgeCategory[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newColor, setNewColor] = useState("#0C447C");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCats, setLocalCats] = useState<KnowledgeCategory[]>(categories);

  const handleAdd = async () => {
    if (!newName.trim()) { setError("カテゴリー名は必須です"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/ordo-admin/knowledge/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), color: newColor }),
      });
      const json = await res.json() as { error?: string | null };
      if (json.error) { setError(json.error); return; }
      setNewName(""); setNewDesc(""); setNewColor("#0C447C");
      await onChanged();
      // 再取得
      const r2 = await fetch("/api/ordo-admin/knowledge/categories?all=true");
      const j2 = await r2.json() as { data: KnowledgeCategory[] | null };
      setLocalCats(j2.data ?? []);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (cat: KnowledgeCategory) => {
    await fetch(`/api/ordo-admin/knowledge/categories/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !cat.is_active }),
    });
    setLocalCats((prev) => prev.map((c) => c.id === cat.id ? { ...c, is_active: !c.is_active } : c));
    await onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-lg mx-4 space-y-5 neu-card max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            カテゴリー管理
          </h3>
          <button onClick={onClose} style={{ color: "var(--text-secondary)" }}>✕</button>
        </div>

        {/* 既存カテゴリ一覧 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>既存カテゴリー</p>
          {localCats.length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>カテゴリーがありません</p>
          )}
          {localCats.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center gap-3 px-3 py-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: cat.color }}
              />
              <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{cat.name}</span>
              <button
                onClick={() => void handleToggle(cat)}
                className="text-xs px-2 py-0.5 rounded-full transition-colors"
                style={
                  cat.is_active
                    ? { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                    : { background: "rgba(239,68,68,0.1)", color: "#ef4444" }
                }
              >
                {cat.is_active ? "有効" : "無効"}
              </button>
            </div>
          ))}
        </div>

        {/* 新規追加フォーム */}
        <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>新規カテゴリーを追加</p>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              カテゴリー名 <span className="text-red-400">*</span>
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="例: 地域福祉計画"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>説明</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="（任意）"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>カラー</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-10 h-8 rounded cursor-pointer border-0 p-0"
                style={{ background: "none" }}
              />
              <span className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{newColor}</span>
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={() => void handleAdd()}
            disabled={saving}
            className="w-full py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {saving ? "保存中..." : "追加する"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ナレッジ辞書ビューア ────────────────────────────────

interface DictSection {
  section_id?: string;
  id?: string;
  section_title?: string;
  title?: string;
  document_category?: string;
  summary?: string;
  key_points?: string[];
  planning_implications?: string[];
  pdca_tags?: string[];
  terms?: Record<string, string>;
  last_updated?: string;
}

interface DictData {
  version?: number;
  sections?: DictSection[];
  global_terms?: Record<string, string>;
}

const CAT_LABEL: Record<string, string> = {
  law: "法令", guideline: "基本指針", research: "調査研究",
  plan: "計画書", policy: "策定方針", ordinance: "条例", other: "その他",
};
const CAT_COLOR: Record<string, string> = {
  law: "#6366f1", guideline: "#0ea5e9", research: "#10b981",
  plan: "#f59e0b", policy: "#ec4899", ordinance: "#8b5cf6", other: "#6b7280",
};

function KnowledgeDictViewer({
  categoryId,
  categoryName,
}: {
  categoryId: string | null;
  categoryName: string | null;
}) {
  const [dict, setDict] = useState<{ id: string | null; dict_data: DictData; version: number } | null>(null);
  const [allTags, setAllTags] = useState<KnowledgeTag[]>([]);
  const [filterSlugs, setFilterSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fetchDict = useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ordo-admin/knowledge/dict?category_id=${categoryId}`);
      const json = await res.json() as { data: typeof dict | null };
      setDict(json.data ?? { id: null, dict_data: { version: 0, sections: [] }, version: 0 });
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/ordo-admin/knowledge/tags");
    const json = await res.json() as { data: TagsResponse | null };
    setAllTags(json.data?.tags ?? []);
  }, []);

  useEffect(() => {
    setFilterSlugs(new Set());
    void fetchDict();
    void fetchTags();
  }, [categoryId, fetchDict, fetchTags]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const exportDict = () => {
    if (!dict) return;
    const blob = new Blob([JSON.stringify(dict.dict_data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge_dict_${categoryId}_v${dict.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!categoryId) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center" style={{ color: "var(--text-secondary)" }}>
        <p className="text-sm">カテゴリーを選択してください</p>
      </div>
    );
  }

  const sections: DictSection[] = dict?.dict_data?.sections ?? [];
  const displaySections = filterSlugs.size === 0
    ? sections
    : sections.filter((s) => (s.pdca_tags ?? []).some((slug) => filterSlugs.has(slug)));

  // pdca_phase grouping for tag chips
  const tagsByPhase: Record<string, KnowledgeTag[]> = {};
  for (const tag of allTags) {
    (tagsByPhase[tag.pdca_phase] ??= []).push(tag);
  }

  return (
    <div className="space-y-4 relative">
      {/* トースト */}
      {toast && (
        <div
          className="fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: "#10b981", color: "#fff" }}
        >
          {toast}
        </div>
      )}

      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            ナレッジ辞書 — {categoryName ?? ""}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            version {dict?.version ?? 0} · {sections.length}セクション
          </p>
        </div>
        <button
          onClick={exportDict}
          disabled={sections.length === 0}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}
        >
          辞書をエクスポート（JSON）
        </button>
      </div>

      {/* タグフィルタ */}
      {allTags.length > 0 && (
        <div className="glass-card rounded-2xl px-4 py-3 space-y-2">
          <p className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>タグで絞り込み</p>
          <div className="flex flex-wrap gap-1.5">
            {PDCA_ORDER.filter((p) => (tagsByPhase[p]?.length ?? 0) > 0).map((phase) => (
              <div key={phase} className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] font-medium mr-1" style={{ color: "var(--text-secondary)" }}>
                  {PDCA_LABEL[phase]}
                </span>
                {(tagsByPhase[phase] ?? []).map((tag) => {
                  const active = filterSlugs.has(tag.slug);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => setFilterSlugs((prev) => {
                        const next = new Set(prev);
                        if (next.has(tag.slug)) { next.delete(tag.slug); } else { next.add(tag.slug); }
                        return next;
                      })}
                      className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                      style={
                        active
                          ? { background: "var(--accent)", color: "#fff" }
                          : { background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid var(--border)" }
                      }
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            ))}
            {filterSlugs.size > 0 && (
              <button
                onClick={() => setFilterSlugs(new Set())}
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
              >
                クリア
              </button>
            )}
          </div>
        </div>
      )}

      {/* セクション一覧 */}
      {loading ? (
        <div className="glass-card rounded-2xl px-4 py-12 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          読み込み中...
        </div>
      ) : displaySections.length === 0 ? (
        <div className="glass-card rounded-2xl px-4 py-12 text-center space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {sections.length === 0
              ? "まだナレッジがありません"
              : "該当するセクションがありません"}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {sections.length === 0
              ? "左からドキュメントをアップロードしてください"
              : "フィルタを変更してください"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displaySections.map((section) => {
            const sid = section.section_id ?? section.id ?? "";
            return (
              <SectionCard
                key={sid}
                section={section}
                categoryId={categoryId}
                onUpdated={async (note) => {
                  await fetchDict();
                  if (note) showToast(note);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── セクションカード ────────────────────────────────────

function SectionCard({
  section,
  categoryId,
  onUpdated,
}: {
  section: DictSection;
  categoryId: string;
  onUpdated: (note?: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "ai-edit" | "manual-edit">("view");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [editDraft, setEditDraft] = useState<DictSection>({ ...section });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const sectionId = section.section_id ?? section.id ?? "";
  const title = section.section_title ?? section.title ?? "（無題）";
  const catKey = section.document_category ?? "other";
  const catColor = CAT_COLOR[catKey] ?? "#6b7280";

  const handleAiEdit = async () => {
    if (!aiInstruction.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ordo-admin/knowledge/dict/section/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, sectionId, instruction: aiInstruction }),
      });
      const json = await res.json() as { ok: boolean; change_note?: string; error?: string };
      if (!json.ok) { alert(json.error ?? "エラーが発生しました"); return; }
      setAiInstruction("");
      setMode("view");
      await onUpdated(json.change_note ? `AI修正: ${json.change_note}` : "AI修正が完了しました");
    } finally {
      setAiLoading(false);
    }
  };

  const handleManualSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ordo-admin/knowledge/dict/section", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId, sectionId,
          patch: {
            section_title: editDraft.section_title ?? editDraft.title,
            summary: editDraft.summary,
            key_points: editDraft.key_points,
            planning_implications: editDraft.planning_implications,
            pdca_tags: editDraft.pdca_tags,
          },
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) { alert(json.error ?? "保存に失敗しました"); return; }
      setMode("view");
      await onUpdated("手動編集を保存しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const res = await fetch("/api/ordo-admin/knowledge/dict/section", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, sectionId }),
    });
    const json = await res.json() as { ok: boolean; error?: string };
    if (!json.ok) { alert(json.error ?? "削除に失敗しました"); return; }
    await onUpdated("セクションを削除しました");
  };

  return (
    <div
      className="glass-card rounded-2xl overflow-hidden transition-all"
      style={{ border: "1px solid var(--border)" }}
    >
      {/* 折りたたみヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/3 transition-colors"
        onClick={() => { setExpanded((v) => !v); setMode("view"); }}>
        <span className="text-xs" style={{ color: expanded ? "var(--accent)" : "var(--text-secondary)" }}>
          {expanded ? "▼" : "▶"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{title}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
              style={{ background: `${catColor}18`, color: catColor }}>
              {CAT_LABEL[catKey] ?? catKey}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {(section.pdca_tags ?? []).slice(0, 3).map((slug) => (
              <span key={slug} className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
                {slug}
              </span>
            ))}
            {(section.pdca_tags ?? []).length > 3 && (
              <span className="text-[9px]" style={{ color: "var(--text-secondary)" }}>
                +{(section.pdca_tags ?? []).length - 3}
              </span>
            )}
            <span className="text-[10px] ml-1" style={{ color: "var(--text-secondary)" }}>
              要点 {(section.key_points ?? []).length}件
            </span>
          </div>
        </div>
        {/* 操作ボタン（ヘッダー右） */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => { setExpanded(true); setMode(mode === "ai-edit" ? "view" : "ai-edit"); }}
            className="text-[10px] px-2 py-1 rounded-lg transition-colors"
            style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}
          >
            AIに修正を依頼
          </button>
          <button
            onClick={() => { setExpanded(true); setEditDraft({ ...section }); setMode(mode === "manual-edit" ? "view" : "manual-edit"); }}
            className="text-[10px] px-2 py-1 rounded-lg transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}
          >
            手動編集
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="text-[10px] px-2 py-1 rounded-lg transition-colors"
            style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}
          >
            削除
          </button>
        </div>
      </div>

      {/* 削除確認バナー */}
      {deleteConfirm && (
        <div className="px-4 py-3 flex items-center gap-3" style={{ background: "rgba(239,68,68,0.08)", borderTop: "1px solid var(--border)" }}>
          <p className="text-xs flex-1" style={{ color: "#ef4444" }}>このセクションを削除しますか？この操作は元に戻せません。</p>
          <button onClick={() => void handleDelete()}
            className="text-xs px-3 py-1 rounded-lg font-medium" style={{ background: "#ef4444", color: "#fff" }}>
            削除する
          </button>
          <button onClick={() => setDeleteConfirm(false)}
            className="text-xs px-2 py-1 rounded-lg" style={{ color: "var(--text-secondary)" }}>
            キャンセル
          </button>
        </div>
      )}

      {/* 展開コンテンツ */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.1)" }}>

          {/* AI修正フォーム */}
          {mode === "ai-edit" && (
            <div className="pt-3 space-y-2">
              <p className="text-xs font-semibold" style={{ color: "var(--accent)" }}>AIへの修正指示</p>
              <textarea
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                rows={3}
                placeholder="例: key_pointsをより具体的な数値を含む表現にしてください"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none resize-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleAiEdit()}
                  disabled={aiLoading || !aiInstruction.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {aiLoading ? "処理中..." : "送信"}
                </button>
                <button onClick={() => setMode("view")}
                  className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* 手動編集フォーム */}
          {mode === "manual-edit" && (
            <div className="pt-3 space-y-3">
              <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>手動編集</p>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>タイトル</label>
                <input
                  value={editDraft.section_title ?? editDraft.title ?? ""}
                  onChange={(e) => setEditDraft((d) => ({ ...d, section_title: e.target.value }))}
                  className="w-full rounded-lg px-3 py-1.5 text-xs outline-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>要約</label>
                <textarea
                  value={editDraft.summary ?? ""}
                  onChange={(e) => setEditDraft((d) => ({ ...d, summary: e.target.value }))}
                  rows={3} className="w-full rounded-lg px-3 py-1.5 text-xs outline-none resize-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>キーポイント（1行1項目）</label>
                <textarea
                  value={(editDraft.key_points ?? []).join("\n")}
                  onChange={(e) => setEditDraft((d) => ({ ...d, key_points: e.target.value.split("\n").filter(Boolean) }))}
                  rows={4} className="w-full rounded-lg px-3 py-1.5 text-xs outline-none resize-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>計画策定上の留意点（1行1項目）</label>
                <textarea
                  value={(editDraft.planning_implications ?? []).join("\n")}
                  onChange={(e) => setEditDraft((d) => ({ ...d, planning_implications: e.target.value.split("\n").filter(Boolean) }))}
                  rows={3} className="w-full rounded-lg px-3 py-1.5 text-xs outline-none resize-none"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => void handleManualSave()} disabled={saving}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "#fff" }}>
                  {saving ? "保存中..." : "保存"}
                </button>
                <button onClick={() => setMode("view")}
                  className="px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* 通常ビュー */}
          {mode === "view" && (
            <div className="pt-3 space-y-3">
              {section.summary && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>要約</p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>{section.summary}</p>
                </div>
              )}
              {(section.key_points ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>キーポイント</p>
                  <ul className="space-y-1">
                    {(section.key_points ?? []).map((kp, i) => (
                      <li key={i} className="text-sm flex gap-2" style={{ color: "var(--text-primary)" }}>
                        <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>{kp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(section.planning_implications ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>計画策定上の留意点</p>
                  <ul className="space-y-1">
                    {(section.planning_implications ?? []).map((pi, i) => (
                      <li key={i} className="text-sm flex gap-2" style={{ color: "var(--text-primary)" }}>
                        <span style={{ color: "#10b981", flexShrink: 0 }}>→</span>{pi}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Object.keys(section.terms ?? {}).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>用語集</p>
                  <div className="space-y-1">
                    {Object.entries(section.terms ?? {}).map(([term, def]) => (
                      <div key={term} className="text-xs">
                        <span className="font-medium" style={{ color: "var(--accent)" }}>{term}</span>
                        <span style={{ color: "var(--text-secondary)" }}>: {def}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(section.pdca_tags ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>PDCAタグ</p>
                  <div className="flex flex-wrap gap-1">
                    {(section.pdca_tags ?? []).map((slug) => (
                      <span key={slug} className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
                        {slug}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── コンパイルタイムライン ───────────────────────────────

const STEP_LABELS: Record<string, string> = {
  upload: "アップロード",
  extract: "テキスト抽出",
  chunk: "チャンク分割",
  compile: "AI編纂",
  merge: "辞書統合",
  done: "完了",
};
const STEP_ORDER = ["upload", "extract", "chunk", "compile", "merge", "done"];

function CompileTimeline({
  doc,
  compileState,
  onClose,
  onRetry,
}: {
  doc: KnowledgeDocument;
  compileState: CompileState | undefined;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [statusData, setStatusData] = useState<{
    processing_log: Array<{ step: string; message: string; at: string }>;
    error_message: string | null;
    processing_progress: number;
    processing_step: string | null;
    status: string;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await fetch(`/api/ordo-admin/knowledge/documents/${doc.id}/status`);
    const json = await res.json() as { data: typeof statusData | null };
    if (json.data) setStatusData(json.data);
  }, [doc.id]);

  useEffect(() => {
    void fetchStatus();
    // 処理中ならポーリング
    const interval = setInterval(() => {
      if (doc.status === "processing") void fetchStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [doc.status, fetchStatus]);

  const progress = compileState?.progress ?? statusData?.processing_progress ?? 0;
  const currentStep = compileState?.step ?? statusData?.processing_step ?? "upload";
  const logs = statusData?.processing_log ?? [];
  const error = compileState?.error ?? statusData?.error_message;

  const estSecs = doc.file_size_bytes ? estimateProcessingSeconds(doc.file_size_bytes) : null;
  const estMins = estSecs ? Math.ceil(estSecs / 60) : null;

  return (
    <div
      className="glass-card rounded-2xl p-5 space-y-4"
      style={{ border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {doc.title} — 編纂タイムライン
          </p>
          {estMins && doc.status === "processing" && (
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              処理目安: 約{estMins}分
            </p>
          )}
        </div>
        <button onClick={onClose} style={{ color: "var(--text-secondary)" }}>✕</button>
      </div>

      {/* ステップ進行バー */}
      <div className="flex items-center gap-1">
        {STEP_ORDER.map((s, i) => {
          const stepIdx = STEP_ORDER.indexOf(currentStep);
          const isDone = i < stepIdx || doc.status === "compiled";
          const isCurrent = s === currentStep && doc.status !== "compiled";
          return (
            <div key={s} className="flex items-center gap-1 flex-1 min-w-0">
              <div
                className={`h-1.5 rounded-full flex-1 transition-all ${isCurrent ? "animate-pulse" : ""}`}
                style={{
                  background: isDone
                    ? "#10b981"
                    : isCurrent
                    ? "var(--accent)"
                    : "rgba(255,255,255,0.08)",
                }}
              />
              <span
                className="text-[9px] shrink-0 whitespace-nowrap"
                style={{ color: isDone || isCurrent ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {STEP_LABELS[s] ?? s}
              </span>
            </div>
          );
        })}
      </div>

      {/* プログレスバー */}
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background: doc.status === "error" ? "#ef4444" : doc.status === "compiled" ? "#10b981" : "var(--accent)",
          }}
        />
      </div>
      <p className="text-xs text-right -mt-2" style={{ color: "var(--text-secondary)" }}>{progress}%</p>

      {/* エラー表示 */}
      {(doc.status === "error" || error) && (
        <div
          className="rounded-xl px-4 py-3 space-y-2"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <p className="text-sm text-red-400">{error ?? "エラーが発生しました"}</p>
          <button
            onClick={onRetry}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
          >
            再試行
          </button>
        </div>
      )}

      {/* 処理ログ */}
      {logs.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>処理ログ</p>
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}
              >
                {STEP_LABELS[log.step] ?? log.step}
              </span>
              <span className="text-xs flex-1" style={{ color: "var(--text-primary)" }}>{log.message}</span>
              <span className="text-[10px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                {new Date(log.at).toLocaleTimeString("ja-JP")}
              </span>
            </div>
          ))}
          {doc.status === "compiled" && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}>
                完了
              </span>
              <span className="text-xs" style={{ color: "#10b981" }}>編纂が完了しました</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── アップロードモーダル ──────────────────────────────────

function UploadModal({
  categoryId,
  onClose,
  onUploaded,
}: {
  categoryId: string;
  onClose: () => void;
  onUploaded: (docId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [tagData, setTagData] = useState<TagsResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/ordo-admin/knowledge/tags")
      .then((r) => r.json())
      .then((j: { data: TagsResponse | null }) => { if (j.data) setTagData(j.data); })
      .catch(() => null);
  }, []);

  const validateFile = (f: File): string | null => {
    const ext = f.name.toLowerCase().split(".").pop() ?? "";
    if (!(ALLOWED_FILE_TYPES as readonly string[]).includes(ext)) {
      return "対応形式はPDF・Word・テキストのみです";
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      return `ファイルサイズが上限(20MB)を超えています（現在: ${formatBytes(f.size)}）`;
    }
    return null;
  };

  const handleFileChange = (f: File | null) => {
    setFile(f);
    setFileError(f ? validateFile(f) : null);
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !file) { setError("タイトルとファイルは必須です"); return; }
    if (fileError) { setError(fileError); return; }
    if (selectedTagIds.size === 0) { setError("PDCA工程タグを1つ以上選択してください"); return; }

    setUploading(true); setError(null);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("description", description);
      form.append("category_id", categoryId);
      form.append("tagIds", JSON.stringify(Array.from(selectedTagIds)));
      form.append("file", file);
      const res = await fetch("/api/ordo-admin/knowledge/upload", { method: "POST", body: form });
      const json = await res.json() as { data?: { documentId?: string } | null; error?: string | null };
      if (json.error) { setError(json.error); return; }
      await onUploaded(json.data?.documentId ?? "");
    } catch {
      setError("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-lg mx-4 space-y-4 neu-card max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            ドキュメントをアップロード
          </h3>
          <button onClick={onClose} style={{ color: "var(--text-secondary)" }}>✕</button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          {/* タイトル */}
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

          {/* 説明 */}
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

          {/* ファイル選択 */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              ファイル <span className="text-red-400">*</span>
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="rounded-xl px-3 py-4 text-sm text-center cursor-pointer hover:bg-white/5 transition-colors"
              style={{
                border: `1px dashed ${fileError ? "#ef4444" : "var(--border)"}`,
                color: "var(--text-secondary)",
              }}
            >
              {file ? (
                <span style={{ color: "var(--text-primary)" }}>{file.name} ({formatBytes(file.size)})</span>
              ) : (
                "PDF / Word / テキストファイルを選択"
              )}
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
              対応形式: PDF / Word / テキスト　／　上限: 20MB
              {file && !fileError && (
                <span className="ml-2" style={{ color: "var(--accent)" }}>
                  処理目安: 約{Math.ceil(estimateProcessingSeconds(file.size) / 60)}分
                </span>
              )}
            </p>
            {fileError && <p className="text-xs text-red-400 mt-1">{fileError}</p>}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* PDCA工程タグ */}
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
              PDCA工程タグ <span className="text-red-400">*</span>
              <span className="ml-1 font-normal">（1つ以上選択）</span>
            </label>
            {!tagData ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>タグを読み込み中...</p>
            ) : (
              <div className="space-y-3">
                {PDCA_ORDER.filter((phase) => (tagData.grouped[phase]?.length ?? 0) > 0).map((phase) => (
                  <div key={phase}>
                    <p className="text-[11px] font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>
                      {PDCA_LABEL[phase] ?? phase}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(tagData.grouped[phase] ?? []).map((tag) => {
                        const checked = selectedTagIds.has(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className="text-xs px-2.5 py-1 rounded-full transition-all"
                            style={
                              checked
                                ? { background: "var(--accent)", color: "#fff" }
                                : { background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid var(--border)" }
                            }
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm transition-colors"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
              キャンセル
            </button>
            <button
              type="submit"
              disabled={uploading || !!fileError}
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
