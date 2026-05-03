import type { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";

const region = process.env.AWS_REGION ?? "ap-northeast-1";
const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
const clientId = process.env.COGNITO_CLIENT_ID ?? "";
const clientSecret = process.env.COGNITO_CLIENT_SECRET ?? "";

/**
 * Cognito の OIDC Issuer URL
 * 例: https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_xxxxxxx
 */
const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

export const authOptions: NextAuthOptions = {
  providers: [
    CognitoProvider({
      clientId,
      clientSecret,
      issuer,
    }),
  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, account, profile }) {
      // 初回サインイン時に Cognito の情報を JWT に追加
      if (account && profile) {
        if (profile.sub !== undefined) token.sub = profile.sub;
        if (profile.email !== undefined) token.email = profile.email;
        const name = profile.name ?? (profile as Record<string, unknown>)["cognito:username"];
        if (typeof name === "string") token.name = name;
        if (account.access_token !== undefined) token.accessToken = account.access_token;
        if (account.id_token !== undefined) token.idToken = account.id_token;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        if (token.sub) session.user.id = token.sub;
        if (token.email && typeof token.email === "string") session.user.email = token.email;
        if (token.name && typeof token.name === "string") session.user.name = token.name;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  secret: process.env.NEXTAUTH_SECRET ?? "",
};
