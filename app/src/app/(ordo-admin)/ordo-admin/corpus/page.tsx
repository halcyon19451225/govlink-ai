export const dynamic = "force-dynamic";

import CorpusAdminClient from "./CorpusAdminClient";

/**
 * コーパス管理（検収・ナレッジ抽出・同意）— X3
 * 認可は (ordo-admin)/layout.tsx が担う（Ordo管理者のみ）。
 * データはクライアント側で /api/ordo-admin/corpus* から取得する。
 */
export default function OrdoCorpusPage() {
  return <CorpusAdminClient />;
}
