import crypto from "crypto";
import type { NextAuthOptions } from "next-auth";
import CognitoProvider from "next-auth/providers/cognito";
import CredentialsProvider from "next-auth/providers/credentials";
import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { queryOne } from "@/lib/db";
import { isOrgAdmin } from "@/lib/permissions";
import { syncUserFromOrdo } from "@/lib/user-provisioning";
import { isOrdoAdminIdentity } from "@/lib/ordo-admin";

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

/** Ordo 台帳との再同期の間隔。組織コード契約のキャッシュ（6時間）と揃えてある。 */
const ORDO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const providers: NextAuthOptions["providers"] = [
  CognitoProvider({ clientId, clientSecret, issuer }),

  // ⚠ Google のフェデレーションプロバイダーは 2026-09-12 に廃止した。
  // Ordo ID をメール＋パスワードのみに一本化する方針（Ordo 側 claude/ordo-id-unify.md）。
  // 招待型プロビジョニング（管理者がメールアドレスから Ordo ID を発行して招待する運用）と
  // ソーシャルログインは両立しない。同じ人に Cognito の sub が2つでき、
  // 組織台帳との紐づけが静かに壊れるため。
  // → Coe のログイン手段は Cognito（メール＋パスワード）のみ。

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
// 【2026-09-12 追記】その後、**ソーシャルログインそのものを全廃**した。
// 一度は Cognito のフェデレーション経由（cognito-google）に寄せたが、Ordo ID を
// メールアドレスから発行して招待する運用に切り替えたため、Google 連携が邪魔になった
// （同じ人に sub が2つでき、組織台帳との紐づけが静かに壊れる）。
// 本番プールの棚卸しでも Google 連携ユーザーは内部2件のみで、顧客の利用実績は無かった。
// → 残る手段は Cognito（メール＋パスワード）のみ。
// 詳細と判断の記録: プロジェクト文書 claude/ordo-id-unify.md（経緯は ordo-id-design.md §4）

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
      // OAuth プロバイダー（Cognito のみ。ソーシャルログインは全廃）
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

      // 権限の解決 — **Cognito の sub のみを鍵にする**（2026-09-06 に email 照合を廃止）。
      //
      // かつては user_roles.email で引いていたが、メールは可変で、同じ値が複数テナントに
      // 存在しうるため認可の鍵として不適切だった。同じ Cognito プールを一般消費者向け SNS
      // （Libera）が共有しているので、業務メールで Libera に登録すると業務権限が付く、
      // という穴にもなっていた。詳細: claude/ordo-id-design.md §4
      //
      // sub は user_identities に持つ。1人が複数の identity を持ちうるため
      // （ネイティブのメール+パスワードと Google 連携で sub が別々になる）、
      // user_roles と 1対多 で紐付けている。
      //
      // ⚠ **ここに email によるフォールバックを足し直してはいけない。** 塞いだ穴が再び開く。
      //   未登録の identity は「権限なし」として落とす（fail closed）。ログに sub を出すので、
      //   正当な利用者なら user_identities に1行足せば復旧できる。
      type RoleRow = {
        id: string;
        municipality_id: string;
        avatar_url: string | null;
        role: string;
        department: string | null;
        membership_count: string;
      };
      const loadRole = (sub: string) =>
        queryOne<RoleRow>(
          `SELECT u.id, u.municipality_id, u.avatar_url, u.role, u.department,
                  count(*) OVER () AS membership_count
           FROM user_roles u
           JOIN user_identities i ON i.user_role_id = u.id
           WHERE i.cognito_sub = $1
           ORDER BY u.created_at
           LIMIT 1`,
          [sub],
        );

      if (token.sub) {
        try {
          let row = await loadRole(token.sub);

          // Ordo 台帳との同期 —
          // 招待された利用者は Cognito には居ても Coe には行が無い。台帳を正本として
          // 受け入れる（作成する）のがここ。**メールではなく sub で引く**ので、
          // 2026-09-06 に塞いだ穴は開かない。詳細: lib/user-provisioning.ts
          //
          // 毎リクエストでは呼ばない。行が無いとき・サインイン直後・前回同期から
          // ORDO_SYNC_INTERVAL_MS 以上経ったときだけ。ログインの待ち時間に
          // Ordo への往復が乗るため、頻度は抑える。
          const lastSync = typeof token.ordoSyncedAt === "number" ? token.ordoSyncedAt : 0;
          const stale = Date.now() - lastSync > ORDO_SYNC_INTERVAL_MS;
          if (!row || !!account || stale) {
            const outcome = await syncUserFromOrdo(token.sub);
            if (outcome.status !== "unreachable") token.ordoSyncedAt = Date.now();
            // 作成・更新があったら読み直す（unreachable なら既存の row のまま進む）
            if (outcome.status === "synced") row = await loadRole(token.sub);
          }

          if (row) {
            token.identityBoundBy = "sub";
            token.municipalityId = row.municipality_id;
            token.role = row.role;
            token.userRoleId = row.id;
            if (row.avatar_url) token.avatarUrl = row.avatar_url;
            // 所属は Ordo 台帳から同期された値（user-provisioning.ts）。画面の表示用
            if (row.department) token.department = row.department;
            else delete token.department;
            token.isOrgAdmin = row.role === "admin" || await isOrgAdmin(row.id);

            // 1人が複数自治体に所属している場合、今は「最も古い所属」を決定的に選ぶ。
            // 以前の LIMIT 1（順序未定義）と違って結果は毎回同じだが、
            // 本来は利用者に所属を選ばせるべき。未解決の課題として可視化しておく。
            if (Number(row.membership_count) > 1) {
              console.warn(
                `[auth] sub=${token.sub} は ${row.membership_count} 件の所属を持ちます。` +
                  `最も古い所属（user_roles.id=${row.id}）を選択しました。所属切替UIは未実装です。`,
              );
            }
          } else {
            // fail closed — **既にトークンに載っているクレームを必ず消す**。
            //
            // jwt コールバックは毎リクエスト走り、ここで返した token がそのリクエストの
            // 認可判断に使われる（かつセッション更新時にクッキーへ再エンコードされる）。
            // 消さずに warn だけ出すと、**修正前に email 照合で発行されたトークンが
            // municipalityId / role を保持したまま生き続ける**。NextAuth の JWT は
            // maxAge 30日・updateAge で延長されるため、使い続けている限り失効しない。
            // つまり「新規ログインは塞いだが、既存セッションは素通り」という状態になる。
            // 実際に 2026-09-06 の検証で、token.sub が Google の数値ID
            // （直付け時代の識別子）のまま role=admin のセッションが生きていた。
            delete token.municipalityId;
            delete token.role;
            delete token.userRoleId;
            delete token.avatarUrl;
            delete token.department;
            delete token.identityBoundBy;
            token.isOrgAdmin = false;

            console.warn(
              `[auth] sub=${token.sub} に対応する user_identities がありません。権限を剥奪しました。` +
                `直前に Ordo 台帳との同期を試みています（[provision] のログに理由が出ます）。` +
                `台帳に居るのにここへ来る場合は、組織コードの紐づけ・契約の有効性・` +
                `利用者のサービス許可のいずれかを確認してください。`,
            );
          }
        } catch {
          // DB 不通は一過性なので既存 token を維持する（ここで消すと全員が締め出される）。
          // 「identity が無い」という確定的な否定とは区別すること。
        }
      }

      // 運営者フラグ。**判定の本体は lib/ordo-admin.ts**（check:ordoadmin が固定）。
      // 画面側が独自に email を比べないよう、結果だけをセッションに載せる。
      token.isOrdoStaff = isOrdoAdminIdentity(
        typeof token.sub === "string" ? token.sub : null,
        typeof token.email === "string" ? token.email : null,
      );

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
        session.user.isOrdoStaff = token.isOrdoStaff ?? false;
        if (token.department && typeof token.department === "string") {
          session.user.department = token.department;
        }
      }
      return session;
    },
  },

  pages: { signIn: "/login" },
  secret: process.env.NEXTAUTH_SECRET!,
};
