export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { CognitoIdentityProviderClient, ChangePasswordCommand, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { authOptions } from "@/lib/auth";

const bodySchema = z.object({
  currentPassword: z.string().min(1, "現在のパスワードは必須です"),
  newPassword: z.string().min(8, "新しいパスワードは8文字以上にしてください"),
});

const region = process.env.AWS_REGION ?? "ap-northeast-1";
const clientId = process.env.COGNITO_CLIENT_ID ?? "";
const clientSecret = process.env.COGNITO_CLIENT_SECRET ?? "";

function getSecretHash(username: string): string | undefined {
  if (!clientSecret || !clientId) return undefined;
  return crypto.createHmac("sha256", clientSecret).update(username + clientId).digest("base64");
}

const cognitoClient = new CognitoIdentityProviderClient({ region });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;
  const email = session.user.email;

  try {
    const secretHash = getSecretHash(email);
    const authParams: Record<string, string> = { USERNAME: email, PASSWORD: currentPassword };
    if (secretHash) authParams["SECRET_HASH"] = secretHash;

    const authRes = await cognitoClient.send(new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: authParams,
    }));

    const accessToken = authRes.AuthenticationResult?.AccessToken;
    if (!accessToken) {
      return NextResponse.json({ data: null, error: "現在のパスワードが正しくありません" }, { status: 401 });
    }

    await cognitoClient.send(new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: currentPassword,
      ProposedPassword: newPassword,
    }));

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === "NotAuthorizedException") {
      return NextResponse.json({ data: null, error: "現在のパスワードが正しくありません" }, { status: 401 });
    }
    if (code === "InvalidPasswordException") {
      return NextResponse.json({ data: null, error: "新しいパスワードが要件を満たしていません（8文字以上・大小英字・数字・記号を含む）" }, { status: 400 });
    }
    return NextResponse.json({ data: null, error: "パスワード変更に失敗しました" }, { status: 500 });
  }
}
