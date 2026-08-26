"use client";

/**
 * 画面に応じたヘルプの自動設置（M3）
 * レイアウトに1回置くだけで、URLから現在のメニューを判定して
 * 右下に「❓ ヘルプ」を出す（対応するマニュアルトピックが無い画面では出さない）。
 * 個別ページへの設置漏れを構造的に無くすための方式（設計の「各画面ヘッダに設置」の
 * 変形 — 新しいメニューを足すと自動的にヘルプも付く）。
 */

import { usePathname } from "next/navigation";
import HelpButton from "@/components/help/HelpButton";
import { HELP_TOPICS } from "@/lib/manual/topics";

export default function AutoHelpButton() {
  const pathname = usePathname() ?? "";

  let topicId: string | null = null;
  const pm = pathname.match(/^\/projects\/[^/]+(?:\/([a-z0-9-]+))?/);
  if (pm) topicId = pm[1] ?? "overview";
  const om = pathname.match(/^\/ordo-admin\/(corpus|ai)/);
  if (om) topicId = `ordo-${om[1]}`;

  if (!topicId || !HELP_TOPICS.some((t) => t.id === topicId)) return null;

  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 40 }}>
      <HelpButton topicId={topicId} />
    </div>
  );
}
