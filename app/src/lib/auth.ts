import crypto from "crypto";
import type { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import LineProvider from "next-auth/providers/line";
import GithubProvider from "next-auth/providers/github";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { queryOne } from "@/lib/db";

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

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }));
}

if (process.env.LINE_CLIENT_ID && process.env.LINE_CLIENT_SECRET) {
  providers.push(LineProvider({
    clientId: process.env.LINE_CLIENT_ID,
    clientSecret: process.env.LINE_CLIENT_SECRET,
  }));
}

if (process.env.GITHUB_ID && process.env.GITHUB_SECRET) {
  providers.push(GithubProvider({
    clientId: process.env.GITHUB_ID,
    clientSecret: process.env.GITHUB_SECRET,
  }));
}

export const authOptions: NextAuthOptions = {
  providers,

  session: { strategy: "jwt" },

  callbacks: {
    async jwt({ token, account, profile, user }) {
      // CredentialsProvider
      if (account?.provider === "credentials" && user) {
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
        // ソーシャルログインのアバター
        if (user?.image) token.picture = user.image;
      }

      if ((!token.municipalityId || !token.role) && token.sub) {
        try {
          const row = await queryOne<{
            id: string;
            municipality_id: string;
            avatar_url: string | null;
            role: string;
          }>(
            "SELECT id, municipality_id, avatar_url, role FROM user_roles WHERE cognito_user_id = $1 LIMIT 1",
            [token.sub],
          );
          if (row) {
            token.municipalityId = row.municipality_id;
            token.role = row.role;
            token.userRoleId = row.id;
            if (row.avatar_url) token.avatarUrl = row.avatar_url;
          }
        } catch { /* DB不通時スキップ */ }
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
      }
      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET!,
};
