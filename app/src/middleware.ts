import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 認証ミドルウェア
 *
 * 保護対象:
 *   /admin/*       → 未ログインなら /login へリダイレクト
 *   /api/ai/*      → 未ログインなら /login へリダイレクト
 *
 * 認証不要（通過):
 *   /public/*
 *   /api/public/*
 *   /login, /api/auth/* など
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
    /*
     * 以下を除くすべてのリクエストにマッチ:
     *   - _next/static (静的ファイル)
     *   - _next/image  (画像最適化)
     *   - favicon.ico
     *   - /login       (ログインページ自体)
     *   - /api/auth/*  (NextAuth エンドポイント)
     */
    "/admin/:path*",
    "/api/ai/:path*",
    "/public/:path*",
    "/api/public/:path*",
  ],
};
