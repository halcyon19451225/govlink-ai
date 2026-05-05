export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { query } from "@/lib/db";

const bodySchema = z.object({
  municipalityName: z.string().min(1, "自治体名は必須です"),
  email: z.string().email("メールアドレスの形式が正しくありません"),
  password: z.string().min(8, "パスワードは8文字以上にしてください"),
  displayName: z.string().min(1, "担当者名は必須です"),
});

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? "ap-northeast-1",
});

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

  const { municipalityName, email, password, displayName } = parsed.data;

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!userPoolId || !clientId) {
    return NextResponse.json({ data: null, error: "認証設定が不足しています" }, { status: 500 });
  }

  // Cognitoにサインアップ
  let cognitoUserId: string;
  try {
    const signUpRes = await cognitoClient.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: displayName },
        ],
      }),
    );
    cognitoUserId = signUpRes.UserSub ?? email;

    // 開発環境: メール確認をスキップして自動承認
    if (process.env.NODE_ENV !== "production") {
      try {
        await cognitoClient.send(
          new AdminConfirmSignUpCommand({
            UserPoolId: userPoolId,
            Username: email,
          }),
        );
      } catch {
        // 承認失敗は無視（本番はメール確認フロー）
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "アカウント作成に失敗しました";
    const code = (err as { name?: string }).name;
    if (code === "UsernameExistsException") {
      return NextResponse.json({ data: null, error: "このメールアドレスはすでに登録されています" }, { status: 409 });
    }
    if (code === "InvalidPasswordException") {
      return NextResponse.json({ data: null, error: "パスワードが要件を満たしていません（8文字以上・大小英字・数字・記号を含む）" }, { status: 400 });
    }
    return NextResponse.json({ data: null, error: message }, { status: 500 });
  }

  // 自治体をINSERT
  const munExisting = await query<{ id: string }>(
    "SELECT id FROM municipalities WHERE name = $1 LIMIT 1",
    [municipalityName],
  );

  let municipalityId: string;
  if (munExisting[0]) {
    municipalityId = munExisting[0].id;
  } else {
    const munInserted = await query<{ id: string }>(
      "INSERT INTO municipalities (name, slug, prefecture) VALUES ($1, $2, '未設定') RETURNING id",
      [municipalityName, `org-${cognitoUserId.slice(0, 8)}`],
    );
    if (!munInserted[0]) {
      return NextResponse.json({ data: null, error: "自治体情報の作成に失敗しました" }, { status: 500 });
    }
    municipalityId = munInserted[0].id;
  }

  // user_rolesにINSERT
  await query(
    `INSERT INTO user_roles (municipality_id, cognito_user_id, email, display_name, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (municipality_id, cognito_user_id) DO NOTHING`,
    [municipalityId, cognitoUserId, email, displayName],
  );

  // subscriptionsにINSERT（30日トライアル）
  await query(
    `INSERT INTO subscriptions
       (municipality_id, plan, status, trial_ends_at)
     VALUES ($1, 'free', 'trialing', NOW() + INTERVAL '30 days')
     ON CONFLICT (municipality_id) DO NOTHING`,
    [municipalityId],
  );

  return NextResponse.json({ data: { municipalityId, cognitoUserId }, error: null }, { status: 201 });
}
