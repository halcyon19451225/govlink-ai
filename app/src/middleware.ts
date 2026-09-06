import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 認証ミドルウェア
 *
 * ⚠ **ルートグループは URL に現れない。**
 *   画面の実体は `src/app/(admin)/…` だが、括弧付きディレクトリは URL に出ないため
 *   実際のパスは `/dashboard`・`/projects/[id]`・`/settings/…` である。
 *   2026-09-06 まで matcher が `/admin/:path*` になっており、**どのリクエストにも
 *   マッチしていなかった**（`src/app/admin` は存在しない）。
 *   ページは `(admin)/layout.tsx` の redirect が、API は各 route の getServerSession が
 *   個別に救っていたため未認証アクセスは通らなかったが、多層防御は消失していた。
 *   §3-5 で `/api/auth/register` が保護外だったのも根は同じ。
 *   詳細: claude/coe-tenant-isolation.md A-1
 *
 * 保護対象（未ログインなら /login へリダイレクト）:
 *   /dashboard/*   /projects/*   /settings/*   /knowledge/*
 *   /templates/*   /resources/*  /billing/*    /help/*
 *   /api/ai/*
 *   （/api/admin/* は除外。理由は下の matcher のコメント）
 *
 * 認証不要（通過）:
 *   /public/*・/api/public/*・/login・/register・/api/auth/* など
 *
 * ⚠ ここを通ることは「ログイン済み」を意味するだけで、
 *   **どのテナントのデータを触ってよいか**は一切保証しない。
 *   テナント境界は src/lib/tenant.ts のガードで各ルートが判定する。
 */
export default withAuth(
  function middleware(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
    // 認証済みの場合はそのまま通過
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl;

        // 公開パスは認証不要
        if (
          pathname.startsWith("/public/") ||
          pathname.startsWith("/api/public/")
        ) {
          return true;
        }

        // 保護パス: トークンが存在すれば OK
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  matcher: [
    // ⚠ ルートグループ (admin) は URL に出ない。実ルートを列挙すること
    "/dashboard/:path*",
    "/projects/:path*",
    "/settings/:path*",
    "/knowledge/:path*",
    "/templates/:path*",
    "/resources/:path*",
    "/billing/:path*",
    "/help/:path*",
    // ⚠ /api/admin/* は **あえて入れない**。withAuth は未認証時に /login への 302 を返すため、
    //   API が返していた 401 JSON の契約が壊れ、呼び出し側の res.json() が HTML を掴む。
    //   api/admin 配下 131 本はすべて getServerSession で自前に 401 を返している（確認済み）。
    //   ここを入れるなら、先に API 側のエラー契約を揃えること。
    "/api/ai/:path*",
    "/public/:path*",
    "/api/public/:path*",
  ],
};
