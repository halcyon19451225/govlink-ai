import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      municipalityId?: string;
      avatarUrl?: string;
      role?: string;
      userRoleId?: string;
      isOrgAdmin?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    /** Ordo ID（Cognito）がメール到達性を確認済みか。email フォールバックの可否に使う */
    emailVerified?: boolean;
    /** 権限をどのキーで解決したか。sub のみ（email 照合は 2026-09-06 に廃止） */
    identityBoundBy?: "sub";
    municipalityId?: string;
    avatarUrl?: string;
    role?: string;
    userRoleId?: string;
    isOrgAdmin?: boolean;
  }
}
