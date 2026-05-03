import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { sendMail } from "@/lib/mailer";

const bodySchema = z.object({
  inquiryType: z.string().min(1, "種別を選択してください"),
  orgName: z.string().min(1, "組織名は必須です"),
  name: z.string().min(1, "お名前は必須です"),
  email: z.string().email("メールアドレスの形式が正しくありません"),
  body: z.string().min(10, "お問い合わせ内容は10文字以上で入力してください"),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエストの形式が正しくありません" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("、");
    return NextResponse.json({ data: null, error: message }, { status: 400 });
  }

  const { inquiryType, orgName, name, email, body } = parsed.data;

  // DBへ保存（メール送信が失敗してもデータは残す）
  try {
    await query(
      `INSERT INTO contact_inquiries (inquiry_type, org_name, name, email, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [inquiryType, orgName, name, email, body],
    );
  } catch (err) {
    console.error("[contact] DB insert failed:", err);
  }

  // 管理者へ通知メール
  const contactEmail = process.env.CONTACT_EMAIL ?? "admin@sinap-sys.jp";
  const adminText = `
【お問い合わせを受信しました】

種別: ${inquiryType}
組織名: ${orgName}
お名前: ${name}
メールアドレス: ${email}

内容:
${body}
`.trim();

  await sendMail({
    to: contactEmail,
    subject: `【Sinap-sys お問い合わせ】${inquiryType} - ${orgName}`,
    text: adminText,
  });

  // 申込者への自動返信メール
  const replyText = `
${name} 様

このたびはSinap-sysへのお問い合わせをいただきありがとうございます。
以下の内容でお問い合わせを受け付けました。

【お問い合わせ内容】
種別: ${inquiryType}
組織名: ${orgName}

${body}

3営業日以内にご返信いたします。
しばらくお待ちください。

──────────────────────────
株式会社 Ordo
https://sinap-sys.jp
お問い合わせ: https://sinap-sys.jp/contact
──────────────────────────
`.trim();

  await sendMail({
    to: email,
    subject: "【Sinap-sys】お問い合わせを受け付けました",
    text: replyText,
  });

  return NextResponse.json({ data: { ok: true }, error: null }, { status: 200 });
}
