"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ─────────────────────────────────────────────
// ナビゲーション定義
// ─────────────────────────────────────────────
const NAV_ITEMS = [
  {
    section: "P",
    label: "計画",
    color: "#6366f1",
    items: [
      { id: "overview",        label: "計画概要",          icon: "📋", path: "" },
      { id: "datasets",        label: "データセット管理",    icon: "🗄️", path: "datasets" },
      { id: "gap-analysis",    label: "ギャップ分析",        icon: "📊", path: "gap-analysis" },
      { id: "asis-analysis",   label: "現状整理(As-Is)",     icon: "🧭", path: "asis-analysis" },
      { id: "issue-hypothesis",label: "課題仮説設定",        icon: "💡", path: "issue-hypothesis" },
      { id: "measure-design",  label: "施策構築(EBPM)",      icon: "🔬", path: "measure-design" },
      { id: "logic-model",     label: "ロジックモデル",      icon: "🗺️", path: "logic-model" },
      { id: "evidences",       label: "エビデンス管理",      icon: "🔍", path: "evidences" },
      { id: "schedule",        label: "スケジュール設定",    icon: "📅", path: "schedule" },
      { id: "pdca",            label: "PDCAサイクル全体図",  icon: "🔄", path: "pdca" },
      { id: "plan-document",   label: "計画書の調製",        icon: "📄", path: "plan-document" },
    ],
  },
  {
    section: "D",
    label: "実行",
    color: "#0891b2",
    items: [
      { id: "service-volume",  label: "サービス見込量",      icon: "📈", path: "service-volume" },
      { id: "kpi-report",      label: "KPI・進捗報告",       icon: "🎯", path: "kpi-report" },
      { id: "documents",       label: "ドキュメント管理",    icon: "📁", path: "documents" },
    ],
  },
  {
    section: "C",
    label: "評価",
    color: "#0f6e56",
    items: [
      { id: "program-evaluation", label: "プログラム評価",   icon: "✅", path: "program-evaluation" },
      { id: "ebpm",               label: "EBPMダッシュボード",icon: "📉", path: "ebpm" },
      { id: "lineage",            label: "リネージグラフ",   icon: "🕸️", path: "lineage" },
    ],
  },
  {
    section: "A",
    label: "改善",
    color: "#b45309",
    items: [
      { id: "improvement-actions", label: "改善アクション",  icon: "🔧", path: "improvement-actions" },
      { id: "self-evaluation", label: "自己評価シート",      icon: "📝", path: "self-evaluation" },
      { id: "post",            label: "AI改善提案",          icon: "🤖", path: "post" },
      { id: "kpi-summary",     label: "KPIサマリー",         icon: "📑", path: "kpi-summary" },
    ],
  },
] as const;

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface Props {
  projectId: string;
}

// ─────────────────────────────────────────────
// ツールチップ（収納時）
// ─────────────────────────────────────────────
function Tooltip({ label }: { label: string }) {
  return (
    <span
      className="absolute left-full ml-2 px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      style={{
        background: "var(--bg-secondary)",
        color: "var(--text-primary)",
        boxShadow: "2px 2px 8px var(--neu-shadow-dark), -2px -2px 8px var(--neu-shadow-light)",
        top: "50%",
        transform: "translateY(-50%)",
      }}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────
export default function ProjectSidebar({ projectId }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());

  // 現在のパスからアクティブな項目を判定
  // /projects/[id] → id: "overview"
  // /projects/[id]/gap-analysis → id: "gap-analysis"
  const basePrefix = `/projects/${projectId}`;
  const afterBase = pathname.replace(basePrefix, "").replace(/^\//, "");
  // pdca/[checkpointId] なども pdca としてアクティブにする
  const activeSegment = afterBase.split("/")[0] || "overview";

  const toggleSection = (section: string) => {
    setClosedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <aside
      className="neu-card shrink-0 flex flex-col"
      style={{
        width: collapsed ? 56 : 240,
        minHeight: "100vh",
        borderRadius: 0,
        transition: "width 0.2s ease",
        position: "sticky",
        top: 0,
        overflowX: "hidden",
        overflowY: "auto",
        zIndex: 30,
        boxShadow: "4px 0 16px var(--neu-shadow-dark), -2px 0 8px var(--neu-shadow-light)",
      }}
    >
      {/* トグルボタン */}
      <div
        style={{
          display: "flex",
          justifyContent: collapsed ? "center" : "flex-end",
          padding: "12px 8px 4px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="neu-button"
          aria-label={collapsed ? "サイドバーを展開" : "サイドバーを収納"}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: "var(--text-secondary)",
            flexShrink: 0,
          }}
        >
          {collapsed ? "▶" : "◀"}
        </button>
      </div>

      {/* ナビゲーション */}
      <nav style={{ flex: 1, padding: "4px 0 16px" }}>
        {NAV_ITEMS.map((group) => {
          const isClosed = closedSections.has(group.section);
          return (
            <div key={group.section} style={{ marginBottom: 4 }}>
              {/* セクションヘッダー */}
              <button
                onClick={() => toggleSection(group.section)}
                title={collapsed ? `${group.section}: ${group.label}` : undefined}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: collapsed ? "8px 0" : "6px 12px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  borderLeft: collapsed ? "none" : `3px solid ${group.color}`,
                  marginLeft: collapsed ? 0 : 0,
                }}
              >
                {/* PDCA バッジ */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: group.color,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {group.section}
                </span>
                {!collapsed && (
                  <>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: group.color,
                        letterSpacing: "0.05em",
                        flex: 1,
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {group.label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-secondary)",
                        transition: "transform 0.15s ease",
                        transform: isClosed ? "rotate(-90deg)" : "rotate(0deg)",
                      }}
                    >
                      ▾
                    </span>
                  </>
                )}
              </button>

              {/* アイテムリスト */}
              {!isClosed && (
                <div>
                  {group.items.map((item) => {
                    const href =
                      item.path === ""
                        ? `/projects/${projectId}`
                        : `/projects/${projectId}/${item.path}`;
                    const isActive = activeSegment === item.id;

                    return (
                      <div key={item.id} className="relative group" style={{ position: "relative" }}>
                        <Link
                          href={href}
                          className={isActive ? "neu-card-inset" : ""}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: collapsed ? 0 : 8,
                            padding: collapsed ? "8px 0" : "6px 12px 6px 20px",
                            justifyContent: collapsed ? "center" : "flex-start",
                            textDecoration: "none",
                            borderRadius: 8,
                            margin: collapsed ? "1px 4px" : "1px 8px",
                            transition: "background 0.15s ease",
                            background: isActive ? undefined : "transparent",
                            borderLeft: isActive && !collapsed
                              ? `2px solid ${group.color}`
                              : collapsed ? "none" : "2px solid transparent",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 16,
                              flexShrink: 0,
                              lineHeight: 1,
                              opacity: isActive ? 1 : 0.75,
                            }}
                          >
                            {item.icon}
                          </span>
                          {!collapsed && (
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: isActive ? 600 : 400,
                                color: isActive ? group.color : "var(--text-secondary)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {item.label}
                            </span>
                          )}
                        </Link>
                        {/* 収納時ツールチップ */}
                        {collapsed && <Tooltip label={item.label} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
