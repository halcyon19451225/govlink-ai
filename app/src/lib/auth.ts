import crypto from "crypto";
import type { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";
import CredentialsProvider from "next-auth/providers/credentials";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { queryOne } from "@/lib/db";
import { isOrgAdmin } from "@/lib/permissions";

const region = process.env.AWS_REGION ?? "ap-northeast-1";
const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
const clientId = process.env.COGNITO_CLIENT_ID ?? "";
const clientSecret = process.env.COGNITO_CLIENT_SECRET ?? "";
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

function getSecretHash(username: string): string | undefined {
  if (!clientSecret || !clientId) return undefined;
  return crypto.createHmac("sha256", clientSecret).update(username + clientId).digest("base64");
}


const cognitoClient = new CognitoIdentityProviderClient({ region });

const providers: NextAuthOptions["providers"] = [
  CognitoProvider({ clientId, clientSecret, issuer }),

  // Google は「Cognito のフェデレーション経由」で使う。
  // identity_provider=Google を渡すことで Cognito のホストUIを素通りして
  // 直接 Google の同意画面へ飛ぶため、利用者から見た体験は直付けと変わらない。
  // 違いは、返ってくる sub が **Cognito の sub** になること。これで user_roles を
  // cognito_user_id で引けるようになり、メール照合を捨てられる。
  //
  // 前提: Coe のアプリクライアントの SupportedIdentityProviders に "Google" が入っていること。
  //   aws cognito-idp update-user-pool-client --supported-identity-providers COGNITO Google ...
  CognitoProvider({
    id: "cognito-google",
    name: "Google",
    clientId,
    clientSecret,
    issuer,
    authorization: { params: { identity_provider: "Google", scope: "openid email profile" } },
  }),

  CredentialsProvider({
    id: "credentials",
    name: "メールアドレス",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      try {
        const secretHash = getSecretHash(credentials.email);
        const authParams: Record<string, string> = {
          USERNAME: credentials.email,
          PASSWORD: credentials.password,
        };
        if (secretHash) authParams["SECRET_HASH"] = secretHash;
        const res = await cognitoClient.send(new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: clientId,
          AuthParameters: authParams,
        }));
        const idToken = res.AuthenticationResult?.IdToken;
        if (!idToken) return null;
        const parts = idToken.split(".");
        const raw = parts[1] ?? "";
        const p = JSON.parse(Buffer.from(raw, "base64").toString()) as Record<string, unknown>;
        return {
          id: typeof p.sub === "string" ? p.sub : "",
          email: typeof p.email === "string" ? p.email : credentials.email,
          name: typeof p.name === "string" ? p.name : (typeof p["cognito:username"] === "string" ? p["cognito:username"] : ""),
        };
      } catch {
        return null;
      }
    },
  }),
];

// ⚠ Google / LINE / GitHub を NextAuth に直付けしていたのを廃止した（2026-09-06）。
//
// 直付けだと token.sub が各プロバイダーの識別子になり、Cognito の sub と一致しない。
// そのため権限解決が「メール一致」に退避し、
//   ・同じプールを使う一般消費者向け SNS（Libera）に業務メールで登録すると業務権限が付く
//   ・同一メールが複数テナントにあると LIMIT 1 で所属が不定になる
// という穴になっていた。実データにも `cognito_user_id = 'google_1105...'` の行が残っている。
//
// 今後、ソーシャルログインは **Cognito のフェデレーション経由**に統一する
// （Google IdP はプール ap-northeast-1_fskAOFUGZ に設定済み。Coe のアプリクライアントの
//   SupportedIdentityProviders に "Google" を追加すれば、利用者から見た体験は変わらない）。
// LINE は id_token が ES256 のみ、GitHub は OIDC 非対応のため Cognito に載らない。
// 詳細と判断の記録: プロジェクト文書 claude/ordo-id-design.md §4

export const authOptions: NextAuthOptions = {
  providers,

  session: { strategy: "jwt" },

  callbacks: {
    async jwt({ token, account, profile, user }) {
      // CredentialsProvider
      if (account?.provider === "credentials" && user) {
        // USER_PASSWORD_AUTH は Cognito 側で CONFIRMED のユーザーしか通らないため、
        // ここに来た時点でメール到達性は確認済みとして扱ってよい
        token.emailVerified = true;
        token.sub = user.id;
        if (user.email) token.email = user.email;
        if (user.name) token.name = user.name;
      }
      // OAuth プロバイダー（Cognito / Google / LINE / GitHub）
      if (account && profile && account.provider !== "credentials") {
        if (profile.sub !== undefined) token.sub = profile.sub;
        if (profile.email !== undefined) token.email = profile.email;
        const name = profile.name ?? (profile as Record<string, unknown>)["cognito:username"];
        if (typeof name === "string") token.name = name;
        if (account.access_token !== undefined) token.accessToken = account.access_token;
        if (account.id_token !== undefined) token.idToken = account.id_token;
        const ev = (profile as Record<string, unknown>).email_verified;
        token.emailVerified = ev === true || ev === "true";
        // ソーシャルログインのアバター
        if (user?.image) token.picture = user.image;
      }

      // 権限の解決。
      //
      // 第一キーは cognito_user_id（= Cognito の sub）。不変で、本人以外が名乗れない。
      // email はフォールバックだが、**メールは可変で、複数テナントに同じ値が存在しうる**ため、
      // 権限の鍵としては本質的に不適切。移行が終わり次第この分岐は削除すること。
      //   ・email_verified が真のときのみ許可する
      //   ・成立したら warn を出す（どの行が sub 未設定のまま残っているかを可視化する）
      //   ・ここで sub を自動で書き戻してはいけない（攻撃者の sub を束ねてしまう）
      type RoleRow = {
        id: string;
        municipality_id: string;
        avatar_url: string | null;
        role: string;
      };
      if (token.sub || token.email) {
        try {
          let row: RoleRow | null = null;

          if (token.sub) {
            row = await queryOne<RoleRow>(
              "SELECT id, municipality_id, avatar_url, role FROM user_roles WHERE cognito_user_id = $1 LIMIT 1",
              [token.sub],
            );
            if (row) token.identityBoundBy = "sub";
          }

          if (!row && token.email && token.emailVerified === true) {
            row = await queryOne<RoleRow>(
              "SELECT id, municipality_id, avatar_url, role FROM user_roles WHERE email = $1 LIMIT 1",
              [token.email],
            );
            if (row) {
              token.identityBoundBy = "email";
              console.warn(
                `[auth] メール照合で権限を解決しました（移行未完了）: user_roles.id=${row.id} sub=${token.sub ?? "(なし)"}。` +
                  `この行の cognito_user_id を実際の sub に更新してください。`,
              );
            }
          }

          if (row) {
            token.municipalityId = row.municipality_id;
            token.role = row.role;
            token.userRoleId = row.id;
            if (row.avatar_url) token.avatarUrl = row.avatar_url;
            token.isOrgAdmin = row.role === "admin" || await isOrgAdmin(row.id);
          }
        } catch { /* DB不通時は既存tokenを維持 */ }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        if (token.sub) session.user.id = token.sub;
        if (token.email && typeof token.email === "string") session.user.email = token.email;
        if (token.name && typeof token.name === "string") session.user.name = token.name;
        if (token.municipalityId) session.user.municipalityId = token.municipalityId;
        if (token.picture && typeof token.picture === "string") session.user.image = token.picture;
        if (token.avatarUrl && typeof token.avatarUrl === "string") session.user.avatarUrl = token.avatarUrl;
        if (token.role) session.user.role = token.role;
        if (token.userRoleId) session.user.userRoleId = token.userRoleId;
        session.user.isOrgAdmin = token.isOrgAdmin ?? false;
      }
      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET!,
};
