"use client";

import { useState } from "react";
import Link from "next/link";

type Stage = "P" | "D" | "C" | "A";

interface SubItem {
  label: string;
  href: string | null; // null = disabled（未実装）
}

const STAGES: {
  key: Stage;
  label: string;
  title: string;
  color: string;
  activeGradient: string;
  items: SubItem[];
}[] = [
  {
    key: "P",
    label: "P",
    title: "計画",
    color: "#6366f1",
    activeGradient: "linear-gradient(135deg, #6366f1, #818cf8)",
    items: [
      { label: "ニーズ評価", href: null },
      { label: "セオリー評価", href: "PROJ/id" },      // /projects/[id] のロジックモデル
      { label: "計画策定", href: "PROJ/id" },
      { label: "スケジュール", href: "PROJ/schedule" },
    ],
  },
  {
    key: "D",
    label: "D",
    title: "実行",
    color: "#06b6d4",
    activeGradient: "linear-gradient(135deg, #06b6d4, #22d3ee)",
    items: [
      { label: "進捗報告・KPI更新", href: "PROJ/post" },
      { label: "KPI実績を報告", href: "PROJ/kpi-report" },
      { label: "KPI取りまとめ", href: "PROJ/kpi-summary" },
      { label: "ドキュメント管理", href: "PROJ/documents" },
      { label: "スケジュール進捗", href: "PROJ/schedule" },
    ],
  },
  {
    key: "C",
    label: "C",
    title: "評価",
    color: "#f59e0b",
    activeGradient: "linear-gradient(135deg, #f59e0b, #fbbf24)",
    items: [
      { label: "プロセス評価", href: "PROJ/evaluations" },
      { label: "アウトカム評価", href: "PROJ/evaluations" },
      { label: "EBPMスコア", href: "PROJ/ebpm" },
    ],
  },
  {
    key: "A",
    label: "A",
    title: "改善",
    color: "#10b981",
    activeGradient: "linear-gradient(135deg, #10b981, #34d399)",
    items: [
      { label: "AI改善提案", href: "PROJ/ebpm" },
      { label: "次期計画フィードバック", href: null },
      { label: "レポート生成", href: "PROJ/ebpm" },
    ],
  },
];

function resolveHref(template: string | null, projectId: string | undefined): string | null {
  if (!template || !projectId) return null;
  // "PROJ/id" → /projects/{id}, "PROJ/schedule" → /projects/{id}/schedule
  return template.replace("PROJ/id", `/projects/${projectId}`).replace("PROJ/", `/projects/${projectId}/`);
}

export default function PdcaNav({
  currentStage,
  currentStep,
  projectId,
}: {
  currentStage: Stage;
  currentStep: string;
  projectId?: string;
}) {
  const [openStage, setOpenStage] = useState<Stage | null>(null);

  const toggle = (key: Stage) => {
    setOpenStage((prev) => (prev === key ? null : key));
  };

  return (
    <nav
      className="rounded-2xl border mb-6 overflow-hidden"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      {/* ── メインバー ── */}
      <div className="flex items-stretch">
        {STAGES.map((stage, idx) => {
          const isActive = stage.key === currentStage;
          const isOpen = openStage === stage.key;

          return (
            <div key={stage.key} className="flex-1 flex flex-col">
              {/* ステージボタン */}
              <button
                onClick={() => toggle(stage.key)}
                className="w-full flex items-center justify-center gap-2 px-3 py-3 transition-all duration-200 group"
                style={
                  isActive
                    ? { background: stage.activeGradient }
                    : { background: "transparent" }
                }
              >
                {/* 丸バッジ */}
                <span
                  className="flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold shrink-0 transition-all duration-200"
                  style={
                    isActive
                      ? { background: "rgba(255,255,255,0.25)", color: "#fff" }
                      : { background: "var(--border)", color: stage.color }
                  }
                >
                  {stage.label}
                </span>

                {/* タイトル（sm以上で表示） */}
                <span
                  className="hidden sm:block text-sm font-semibold transition-colors duration-200"
                  style={{ color: isActive ? "#fff" : "#94a3b8" }}
                >
                  {stage.title}
                </span>

                {/* アクティブなサブ項目（md以上で表示） */}
                {isActive && (
                  <span
                    className="hidden md:block text-xs px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.9)" }}
                  >
                    {currentStep}
                  </span>
                )}

                {/* 展開矢印 */}
                <svg
                  className="ml-auto shrink-0 transition-transform duration-200"
                  style={{
                    width: 14, height: 14,
                    color: isActive ? "rgba(255,255,255,0.7)" : "#4b5563",
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* セパレーター（最後以外） */}
              {idx < STAGES.length - 1 && (
                <div className="hidden sm:block absolute" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── ドロップダウン ── */}
      {STAGES.map((stage) => {
        if (openStage !== stage.key) return null;
        return (
          <div
            key={`dropdown-${stage.key}`}
            className="border-t px-4 py-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
            style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}
          >
            {stage.items.map((item) => {
              const href = resolveHref(item.href, projectId);
              const isCurrentStep = item.label === currentStep;

              if (!href) {
                // disabled（未実装）
                return (
                  <span
                    key={item.label}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg opacity-40 cursor-not-allowed"
                    style={{ color: "#94a3b8", background: "var(--bg-secondary)" }}
                    title="近日公開予定"
                  >
                    <svg className="shrink-0" width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {item.label}
                  </span>
                );
              }

              return (
                <Link
                  key={item.label}
                  href={href}
                  onClick={() => setOpenStage(null)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all duration-200 hover:border-indigo-500/40 hover:text-slate-100"
                  style={
                    isCurrentStep
                      ? { borderColor: stage.color + "60", color: "#fff", background: stage.color + "18" }
                      : { borderColor: "var(--border)", color: "#94a3b8", background: "var(--bg-secondary)" }
                  }
                >
                  {isCurrentStep && (
                    <svg className="shrink-0" width={10} height={10} viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="12" r="6" />
                    </svg>
                  )}
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}

      {/* ── ボトムバー: ステージ間の矢印（sm以上） ── */}
      <div
        className="hidden sm:flex items-center justify-center gap-1 px-4 py-1.5 border-t"
        style={{ borderColor: "var(--border)" }}
      >
        {STAGES.map((stage, idx) => (
          <span key={stage.key} className="flex items-center gap-1">
            <span
              className="text-xs font-semibold"
              style={{ color: stage.key === currentStage ? stage.color : "#374151" }}
            >
              {stage.title}
            </span>
            {idx < STAGES.length - 1 && (
              <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="#374151" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </span>
        ))}
        <span className="ml-2 text-xs" style={{ color: "#374151" }}>→ 次のサイクルへ</span>
      </div>
    </nav>
  );
}
