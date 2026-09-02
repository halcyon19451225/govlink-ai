"use client";

/**
 * スケジュール設定画面のタブ — 「PDCAサイクル全体図」を同居（2026-09 メニュー整理）。
 * 旧 /pdca メニューの内容をタブとして統合した（新メニューは立てない方針）。
 * /pdca・/pdca/[checkpointId]（チェックポイント完了操作）のルートはそのまま残っており、
 * タブ内のリンクから従来どおり遷移する。
 * 非アクティブ側は display:none で保持し、タブ切替でスケジュール編集中の状態が失われないようにする。
 */

import { useState, type ReactNode } from "react";

const TABS = [
  { key: "schedule", label: "📅 スケジュール", hint: "工程・タスク・進捗ボード" },
  { key: "pdca", label: "🔄 PDCAサイクル全体図", hint: "チェックポイントの一覧と完了操作" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ScheduleTabs({
  initialTab,
  schedule,
  pdca,
}: {
  initialTab?: string | undefined;
  schedule: ReactNode;
  pdca: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab === "pdca" ? "pdca" : "schedule");

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
      <div style={{ display: tab === "schedule" ? undefined : "none" }}>{schedule}</div>
      <div style={{ display: tab === "pdca" ? undefined : "none" }}>{pdca}</div>
    </div>
  );
}
