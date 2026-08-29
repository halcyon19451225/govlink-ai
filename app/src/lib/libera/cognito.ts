import "server-only";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/**
 * メールアドレス → Cognito sub の解決（S3）
 *
 * Libera は Coe と同じ User Pool を OIDC 参照しているため、
 * ここで解決した sub がそのまま Libera 側の宛先ID
 * （CalendarEvent.participantIds / Task.owner）になる。
 *
 * Coe のユーザー名規約は Username=email（register ルートで確認済み）。
 * 念のため AdminGetUser が外れたら email フィルタの ListUsers にフォールバックする。
 */

function getClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? "ap-northeast-1",
    ...(process.env.APP_AWS_ACCESS_KEY_ID && process.env.APP_AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

function subOf(
  attrs: { Name?: string | undefined; Value?: string | undefined }[] | undefined,
): string | null {
  return attrs?.find((a) => a.Name === "sub")?.Value ?? null;
}

export async function resolveSubByEmail(email: string): Promise<string | null> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) return null;
  const client = getClient();
  const normalized = email.trim().toLowerCase();

  try {
    const res = await client.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: normalized }),
    );
    const sub = subOf(res.UserAttributes);
    if (sub) return sub;
  } catch {
    /* Username=email で見つからない → フィルタ検索へ */
  }
  try {
    const res = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${normalized.replace(/"/g, "")}"`,
        Limit: 2,
      }),
    );
    const users = res.Users ?? [];
    if (users.length !== 1) return null; // 0件 or 曖昧（2件以上）は解決しない
    return subOf(users[0]?.Attributes);
  } catch {
    return null;
  }
}
