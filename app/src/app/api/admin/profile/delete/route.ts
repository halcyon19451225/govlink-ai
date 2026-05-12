export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? "ap-northeast-1",
});

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    return NextResponse.json({ data: null, error: "認証設定が不足しています" }, { status: 500 });
  }

  try {
    await query(
      "DELETE FROM user_roles WHERE cognito_user_id = $1",
      [session.user.id],
    );

    await cognitoClient.send(new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: session.user.email,
    }));

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "アカウント削除に失敗しました";
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }
}
