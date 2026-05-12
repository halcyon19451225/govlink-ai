export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CognitoIdentityProviderClient, ForgotPasswordCommand } from "@aws-sdk/client-cognito-identity-provider";

const bodySchema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません"),
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
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { email } = parsed.data;

  try {
    const secretHash = getSecretHash(email);
    const params: Record<string, string> = { USERNAME: email };
    if (secretHash) params["SECRET_HASH"] = secretHash;

    await cognitoClient.send(new ForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
      SecretHash: secretHash,
    }));

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    const code = (err as { name?: string }).name;
    // ユーザーが存在しない場合でも成功を返す（メールアドレス列挙対策）
    if (code === "UserNotFoundException" || code === "InvalidParameterException") {
      return NextResponse.json({ data: { ok: true }, error: null });
    }
    if (code === "LimitExceededException") {
      return NextResponse.json(
        { data: null, error: "リクエストが多すぎます。しばらく待ってから再試行してください" },
        { status: 429 },
      );
    }
    return NextResponse.json({ data: null, error: "送信に失敗しました。しばらく待ってから再試行してください" }, { status: 500 });
  }
}
