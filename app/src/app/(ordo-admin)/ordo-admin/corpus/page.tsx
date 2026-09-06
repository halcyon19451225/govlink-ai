export const dynamic = "force-dynamic";

import CorpusAdminClient from "./CorpusAdminClient";
import { assertOrdoAdminPage } from "@/lib/ordo-admin";

/**
 * コーパス管理（検収・ナレッジ抽出・同意）— X3
 * 認可は (ordo-admin)/layout.tsx が担う（Ordo管理者のみ）。
 * データはクライアント側で /api/ordo-admin/corpus* から取得する。
 */
export default async function OrdoCorpusPage() {
  // 運営者判定。**layout だけに頼らない**（Next.js の layout は認可の境界に
  // してはならない。ナビゲーション時に再実行されず、層を飛ばせる）
  await assertOrdoAdminPage();
  return <CorpusAdminClient />;
}
