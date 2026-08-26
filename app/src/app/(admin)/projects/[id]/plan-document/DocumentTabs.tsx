"use client";

/**
 * 計画書調製画面のタブ — PL3 で「📊 評価報告書」を追加（設計 A①: 新メニューは立てず同居）
 * key を切ることでタブごとに PlanDocumentClient の状態を独立させる。
 */

import { useState } from "react";
import PlanDocumentClient from "./PlanDocumentClient";

const TABS = [
  { key: "plan", label: "📄 計画書", hint: "P③ 本編・簡易版・概要版のdocx" },
  { key: "eval", label: "📊 評価報告書", hint: "A① 評価結果報告書のdocx・印刷" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function DocumentTabs({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const [tab, setTab] = useState<TabKey>("plan");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.hint}
            className={`neu-button px-4 py-2 text-sm font-semibold ${tab === t.key ? "neu-card-inset" : ""}`}
            style={{ color: tab === t.key ? "#6366f1" : "var(--text-secondary)" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <PlanDocumentClient key={tab} projectId={projectId} projectTitle={projectTitle} docKind={tab} />
    </div>
  );
}
