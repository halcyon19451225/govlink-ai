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
      /** 運営者（Ordo 社）か。判定の本体は lib/ordo-admin.ts */
      isOrdoStaff?: boolean;
      /** 所属部署（Ordo 台帳から同期された表示用の値） */
      department?: string;
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
    /** Ordo 台帳と最後に同期した時刻（epoch ms）。再同期の頻度を抑えるために持つ */
    ordoSyncedAt?: number;
    municipalityId?: string;
    avatarUrl?: string;
    role?: string;
    userRoleId?: string;
    isOrgAdmin?: boolean;
    isOrdoStaff?: boolean;
    department?: string;
  }
}
