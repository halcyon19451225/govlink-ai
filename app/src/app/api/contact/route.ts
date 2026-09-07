export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";

// 長さの上限は、メール本文が無制限に膨らむのを防ぐためのもの。
// 下限（min）は入力ミスを弾くための従来どおりの検証。
const bodySchema = z.object({
  inquiryType: z.string().min(1, "種別を選択してください").max(60, "種別が長すぎます"),
  orgName: z.string().min(1, "組織名は必須です").max(120, "組織名が長すぎます"),
  name: z.string().min(1, "お名前は必須です").max(120, "お名前が長すぎます"),
  email: z.string().email("メールアドレスの形式が正しくありません").max(254),
  body: z
    .string()
    .min(10, "お問い合わせ内容は10文字以上で入力してください")
    .max(4000, "お問い合わせ内容は4000文字以内で入力してください"),
});

export async function POST(req: NextRequest) {
  // ── 回数制限（IP）─────────────────────────────────────────────
  // 本文を読む前に IP で先に絞る。壊れた本文を大量に投げられても DB に到達しない。
  const ipLimited = await enforceRateLimit("contact", [
    { kind: "ip", value: clientIpFrom(req.headers), limit: 5, windowSeconds: 3600 },
  ]);
  if (ipLimited) return ipLimited;

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

  // ── 回数制限（宛先メールアドレス）──────────────────────────────
  // ⚠ これは**攻撃者ではなく被害者**を守るための軸。
  //   IP は回線を変えれば増やせるが、嫌がらせの標的にされた1つのアドレスに
  //   自動返信を浴びせ続けることは、この制限で止まる。
  const mailLimited = await enforceRateLimit("contact", [
    { kind: "email", value: email, limit: 3, windowSeconds: 3600 },
  ]);
  if (mailLimited) return mailLimited;

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

  // ── 管理者へ通知メール ────────────────────────────────────────
  // 宛先は環境変数で固定された自社アドレス。リクエスト本文の値は宛先に影響しないので、
  // ここには従来どおり全項目を載せてよい。
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

  // ── 申込者への自動返信メール ──────────────────────────────────
  //
  // ⚠ **リクエスト本文の値を1つも埋め込まないこと（完全な固定文にすること）。**
  //
  //   このエンドポイントは未認証で、宛先（email）も文面の材料（body / name /
  //   orgName / inquiryType）も**すべてリクエスト本文から来る**。
  //   以前はここに body をそのまま流し込んでいたため、
  //   「任意の文面を、任意の宛先に、自社ドメイン（MAIL_FROM）から送る」
  //   という装置になっていた。フィッシングの踏み台そのもの。
  //
  //   レート制限では**回数**しか減らせない。1時間に1通でも、
  //   任意の文面が自社ドメインから届く事実は変わらない。能力そのものを外す。
  //
  //   inquiryType も例外ではない。フォームは別リポジトリ（OrdoWebsite）にあり、
  //   このリポジトリには選択肢の定義が無い＝ここでは自由文字列として届く。
  //   「種別だけなら安全」とは言えないので、これも埋め込まない。
  //
  //   受け付けた内容の控えが要るなら、メールではなく送信後の画面に出すこと。
  const replyText = `
このたびはSinap-sysへのお問い合わせをいただきありがとうございます。
お問い合わせを受け付けました。

3営業日以内にご返信いたします。
しばらくお待ちください。

※ このメールは送信専用です。ご返信いただいてもお答えできません。
※ お心当たりが無い場合は、このメールを破棄してください。

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
