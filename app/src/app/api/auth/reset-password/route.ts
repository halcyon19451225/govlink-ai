export const dynamic = "force-dynamic";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CognitoIdentityProviderClient, ConfirmForgotPasswordCommand } from "@aws-sdk/client-cognito-identity-provider";

const bodySchema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません"),
  code: z.string().min(1, "確認コードは必須です"),
  newPassword: z.string().min(8, "パスワードは8文字以上にしてください"),
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

  const { email, code, newPassword } = parsed.data;

  try {
    await cognitoClient.send(new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
      SecretHash: getSecretHash(email),
    }));

    return NextResponse.json({ data: { ok: true }, error: null });
  } catch (err) {
    const code_ = (err as { name?: string }).name;
    if (code_ === "CodeMismatchException") {
      return NextResponse.json({ data: null, error: "確認コードが正しくありません" }, { status: 400 });
    }
    if (code_ === "ExpiredCodeException") {
      return NextResponse.json({ data: null, error: "確認コードの有効期限が切れました。もう一度メールを送信してください" }, { status: 400 });
    }
    if (code_ === "InvalidPasswordException") {
      return NextResponse.json(
        { data: null, error: "パスワードが要件を満たしていません（8文字以上・大小英字・数字・記号を含む）" },
        { status: 400 },
      );
    }
    if (code_ === "LimitExceededException") {
      return NextResponse.json(
        { data: null, error: "リクエストが多すぎます。しばらく待ってから再試行してください" },
        { status: 429 },
      );
    }
    return NextResponse.json({ data: null, error: "パスワードの再設定に失敗しました" }, { status: 500 });
  }
}
