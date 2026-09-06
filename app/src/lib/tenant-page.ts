import "server-only";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

/**
 * ページ（サーバーコンポーネント）用のテナント境界ガード。
 *
 * `projects/[id]/**` の各ページの**先頭**で呼ぶ。URL の政策が自分の自治体のもので
 * なければ notFound() を投げる（403 ではなく 404。存在を漏らさないため）。
 *
 * ⚠ layout.tsx にも同じガードを置いているが、**それだけでは足りない**。
 *   App Router は layout と page を並行して描画するので、layout が notFound() を
 *   投げても page の本体（データ取得・副作用）は走りうる。
 *   layout は「表示させない」ための保険で、実際の境界は各ページのこの呼び出し。
 *
 * 背景: claude/coe-tenant-isolation.md A-3
 *
 * ⚠ このモジュールを @/lib/tenant に統合しないこと。
 *   auth.ts → permissions.ts → tenant.ts という依存があるため、
 *   tenant.ts から authOptions を import すると循環参照になる。
 */
export async function assertProjectPage(projectId: string): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  await assertProjectAccess(session, projectId);
  return session;
}
