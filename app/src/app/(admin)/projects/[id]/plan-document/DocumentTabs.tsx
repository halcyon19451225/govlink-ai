"use client";

/**
 * 計画書調製画面のタブ — PL3「📊 評価報告書」・PL4「🎤 説明資料」を同居
 * （設計 A①/P④: 新メニューは立てない）。key を切ることでタブごとに状態を独立させる。
 */

import { useState } from "react";
import PlanDocumentClient from "./PlanDocumentClient";
import DeckClient from "./DeckClient";

const TABS = [
  { key: "plan", label: "📄 計画書", hint: "P③ 本編・簡易版・概要版のdocx" },
  { key: "eval", label: "📊 評価報告書", hint: "A① 評価結果報告書のdocx・印刷" },
  { key: "deck", label: "🎤 説明資料", hint: "P④ 受益者向けpptx（ノート欄に読み原稿）" },
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
      {tab === "deck" ? (
        <DeckClient key="deck" projectId={projectId} projectTitle={projectTitle} />
      ) : (
        <PlanDocumentClient key={tab} projectId={projectId} projectTitle={projectTitle} docKind={tab} />
      )}
    </div>
  );
}
