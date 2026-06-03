"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface DictSection {
  id: string;
  title: string;
  category: string;
  summary: string;
  key_points: string[];
  planning_implications: string[];
}

interface KnowledgeLink {
  id: string;
  knowledge_dict_id: string;
  linked_section_ids: string[];
}

interface MergedDict {
  tier1_version: number;
  tier2_id: string | null;
  sections: DictSection[];
  global_terms: Record<string, string>;
}

const CATEGORY_LABEL: Record<string, string> = {
  law: "法令", guideline: "基本指針・通知", research: "調査研究",
  plan: "計画書", policy: "策定方針", ordinance: "条例", other: "その他",
};

const CATEGORY_COLOR: Record<string, string> = {
  law: "#6366f1", guideline: "#06b6d4", research: "#10b981",
  plan: "#f59e0b", policy: "#a855f7", ordinance: "#ef4444", other: "#64748b",
};

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export default function KnowledgePanel({ projectId, open, onClose }: Props) {
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  const [sections, setSections] = useState<DictSection[]>([]);
  const [allDict, setAllDict] = useState<MergedDict | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [linkModal, setLinkModal] = useState(false);

  const fetchKnowledge = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/knowledge`);
      const json = await res.json() as { data: { links: KnowledgeLink[]; sections: DictSection[] } | null };
      if (json.data) {
        setLinks(json.data.links);
        setSections(json.data.sections);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchAllDict = async () => {
    const res = await fetch("/api/admin/knowledge/dict");
    const json = await res.json() as { data: MergedDict | null };
    if (json.data) setAllDict(json.data);
  };

  useEffect(() => {
    if (open) {
      void fetchKnowledge();
    }
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (id: string) => {
    setExpandedSections((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  return (
    <>
      {/* オーバーレイ */}
      {open && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: "transparent" }}
          onClick={onClose}
        />
      )}

      {/* スライドインパネル */}
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col"
        style={{
          width: 320,
          background: "var(--bg-secondary, #141722)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          overflowY: "auto",
        }}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-4 sticky top-0"
          style={{ background: "var(--bg-secondary, #141722)", borderBottom: "1px solid var(--border)", zIndex: 1 }}>
          <div>
            <h3 className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>ナレッジ</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {sections.length}セクション紐付け中
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg">✕</button>
        </div>

        <div className="flex-1 px-4 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
          ) : sections.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                ナレッジが紐付けられていません
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sections.map((section) => {
                const expanded = expandedSections.has(section.id);
                const catColor = CATEGORY_COLOR[section.category] ?? "#64748b";
                return (
                  <div key={section.id} className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid var(--border)" }}>
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full px-3 py-2.5 flex items-start gap-2 hover:bg-white/3 transition-colors text-left"
                    >
                      <span className="text-xs mt-0.5" style={{ color: expanded ? catColor : "var(--text-secondary)" }}>
                        {expanded ? "▼" : "▶"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                          {section.title}
                        </p>
                        <span className="text-xs px-1.5 py-0.5 rounded mt-1 inline-block"
                          style={{ background: `${catColor}20`, color: catColor }}>
                          {CATEGORY_LABEL[section.category] ?? section.category}
                        </span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="px-3 pb-3 space-y-2"
                        style={{ background: "rgba(0,0,0,0.15)", borderTop: "1px solid var(--border)" }}>
                        {section.summary && (
                          <p className="text-xs leading-relaxed mt-2" style={{ color: "var(--text-secondary)" }}>
                            {section.summary}
                          </p>
                        )}
                        {section.planning_implications.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                              計画策定上の留意点
                            </p>
                            <ul className="space-y-1">
                              {section.planning_implications.map((pi, i) => (
                                <li key={i} className="text-xs flex gap-1.5" style={{ color: "var(--text-primary)" }}>
                                  <span style={{ color: "#10b981", flexShrink: 0 }}>→</span>{pi}
                                </li>
                              ))}
                            </ul>
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

        {/* フッター */}
        <div className="px-4 py-4 space-y-2 sticky bottom-0"
          style={{ background: "var(--bg-secondary, #141722)", borderTop: "1px solid var(--border)" }}>
          <Link
            href="/knowledge"
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs transition-colors"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
          >
            📚 ナレッジを管理
          </Link>
          <button
            onClick={() => { void fetchAllDict(); setLinkModal(true); }}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-colors"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            + ナレッジを紐付ける
          </button>
        </div>
      </div>

      {linkModal && allDict && (
        <LinkModal
          projectId={projectId}
          allDict={allDict}
          existingLinks={links}
          onClose={() => setLinkModal(false)}
          onLinked={async () => {
            setLinkModal(false);
            await fetchKnowledge();
          }}
        />
      )}
    </>
  );
}

function LinkModal({
  projectId, allDict, existingLinks, onClose, onLinked,
}: {
  projectId: string;
  allDict: MergedDict;
  existingLinks: KnowledgeLink[];
  onClose: () => void;
  onLinked: () => Promise<void>;
}) {
  const existingIds = new Set(existingLinks.flatMap((l) => l.linked_section_ids ?? []));
  const [selected, setSelected] = useState<Set<string>>(new Set(existingIds));
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Tier1辞書に紐付け
      await fetch(`/api/admin/projects/${projectId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_dict_id: allDict.tier2_id ?? "tier1-placeholder",
          linked_section_ids: Array.from(selected),
        }),
      });
      await onLinked();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="glass-card rounded-2xl p-6 w-full max-w-lg mx-4 space-y-4 neu-card"
        style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div className="flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            ナレッジを紐付ける
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-2">
          {allDict.sections.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>
              利用可能なナレッジがありません
            </p>
          ) : (
            allDict.sections.map((section) => (
              <label
                key={section.id}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer hover:bg-white/5 transition-colors"
                style={{ border: "1px solid var(--border)" }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(section.id)}
                  onChange={() => toggle(section.id)}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {section.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {CATEGORY_LABEL[section.category] ?? section.category}
                    {section.summary && ` · ${section.summary.slice(0, 60)}...`}
                  </p>
                </div>
              </label>
            ))
          )}
        </div>

        <div className="flex gap-3 shrink-0 pt-2">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-sm transition-colors"
            style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}>
            キャンセル
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {saving ? "保存中..." : `紐付ける（${selected.size}件）`}
          </button>
        </div>
      </div>
    </div>
  );
}
