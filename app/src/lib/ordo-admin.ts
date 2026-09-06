import "server-only";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * 運営者（Ordo 社）判定
 *
 * `(ordo-admin)` 配下と `api/ordo-admin/**` は、**テナントを越えて**全自治体の
 * データを読み書きするコンソール。境界が無いことは仕様だが、その代わり
 * 「運営者だけが入れること」がすべての防御になる。
 *
 * 背景（2026-09-06 の監査 / claude/coe-tenant-isolation.md §8）:
 *   判定が `session.user.email === "ordoservice.com@gmail.com"` の形で
 *   **28 ファイルに完全重複**していた。1箇所書き忘れれば、そこは全テナントに
 *   対して開いたままになる。テナント境界を src/lib/tenant.ts に集約したのと
 *   同じ理由で、ここに1本化する。
 *
 * ⚠ **既知の弱点（未解決）: 判定キーが email であること。**
 *   `claude/ordo-id-design.md` §4 で、権限解決から email 照合を排除した
 *   （メールは可変で、同じ Cognito プールを一般消費者向け SNS の Libera が
 *   共有しているため）。運営者判定だけが、まだその古い方式のまま残っている。
 *   `src/lib/auth.ts` の「email によるフォールバックを足し直してはいけない」は
 *   テナント権限についての警告だが、理屈はここにもそのまま当てはまる。
 *   sub ベース（下の ORDO_ADMIN_SUBS）へ移すのが本筋。移行手順は
 *   claude/coe-tenant-isolation.md §8-2 に書いた。
 *
 * ⚠ **`email_verified` を条件にしていない。**
 *   条件にすべきだが、現時点で Cognito の Google 連携ユーザーは属性マッピング漏れで
 *   `email_verified=false` のまま（ordo-id-design.md §4-3-4 の罠2）。
 *   ここで検証済みを要求すると、Google でログインしている運営者が締め出される。
 *   **属性マッピングを直してから**有効にすること。
 */

/** 運営者のメールアドレス。移行が済むまでの暫定キー */
const ORDO_ADMIN_EMAILS: readonly string[] = ["ordoservice.com@gmail.com"];

/**
 * 運営者の Cognito sub。ここが埋まっていれば sub 照合を優先する。
 * 空のあいだは email 照合にフォールバックする（現状）。
 *
 * 1人が複数の identity を持つ（ネイティブ／Google 連携で sub が別）ため配列。
 * 詳細: claude/ordo-id-design.md §4-3-3
 */
const ORDO_ADMIN_SUBS: readonly string[] = (process.env.ORDO_ADMIN_SUBS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * このセッションが運営者か。**判定はここだけに置くこと。**
 *
 * 戻り値を型述語（`session is Session`）にしているのは、呼び出し側が
 * `if (!isOrdoAdmin(session)) return …;` の後で `session` を非 null として
 * 扱えるようにするため。かつての `if (!session || session.user?.email !== …)` は
 * 副作用として null 絞り込みも兼ねていたので、それを引き継ぐ。
 */
export function isOrdoAdmin(session: Session | null): session is Session {
  if (!session?.user) return false;

  // sub が設定されていれば、それだけで判定する（email には落ちない）
  if (ORDO_ADMIN_SUBS.length > 0) {
    const sub = session.user.id;
    return typeof sub === "string" && ORDO_ADMIN_SUBS.includes(sub);
  }

  const email = session.user.email;
  return typeof email === "string" && ORDO_ADMIN_EMAILS.includes(email);
}

/**
 * API ルート用。運営者でなければ 403 を返す。通ってよいときは null。
 *
 * ⚠ ここは 403 のままにしてある。テナント境界（tenant.ts）が 404 なのは
 *   「他テナントの政策が存在すること」を漏らさないためだが、
 *   `/api/ordo-admin/*` というパスの存在自体は隠しても意味がない。
 */
export async function requireOrdoAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  // ⚠ isOrdoAdmin は型述語なので、false 側で session は never に絞られる。
  //   ログ用の値は判定より先に取り出しておくこと
  const who = `email=${session?.user?.email ?? "-"} sub=${session?.user?.id ?? "-"}`;
  if (isOrdoAdmin(session)) return null;

  console.warn(`[ordo-admin] 拒否: ${who}`);
  return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
}

/**
 * ページ・layout 用。運営者でなければ /dashboard へ戻す。
 *
 * ⚠ layout に置くだけでは足りない。Next.js の layout は認可の境界にしてはならない
 *   （ナビゲーション時に再実行されず、RSC リクエストを直接組み立てられると層を飛ばせる）。
 *   **各ページの先頭でも呼ぶこと。**
 */
export async function assertOrdoAdminPage(): Promise<Session> {
  const session = await getServerSession(authOptions);
  const who = `email=${session?.user?.email ?? "-"} sub=${session?.user?.id ?? "-"}`;
  if (!isOrdoAdmin(session)) {
    console.warn(`[ordo-admin] 拒否(page): ${who}`);
    redirect("/dashboard");
  }
  return session;
}
