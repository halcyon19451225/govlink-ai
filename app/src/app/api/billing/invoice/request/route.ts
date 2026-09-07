export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { sendMail } from "@/lib/mailer";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  plan: z.enum(["light", "standard", "premium"]),
  municipalityName: z.string().min(1, "自治体名・法人名は必須です"),
  contactName: z.string().min(1, "担当者名は必須です"),
  contactEmail: z.string().email("メールアドレスの形式が正しくありません"),
  contactPhone: z.string().optional(),
  address: z.string().min(1, "住所は必須です"),
  invoiceNumber: z.string().optional(),
  startMonth: z.string().min(1, "開始希望月は必須です"),
  notes: z.string().optional(),
});

const PLAN_AMOUNTS: Record<string, number> = {
  standard: 30000,
  premium: 80000,
};

const PLAN_LABELS: Record<string, string> = {
  standard: "Standard",
  premium: "Premium",
};

export async function POST(req: NextRequest) {
  // ── 回数制限（IP）─────────────────────────────────────────────
  // 未認証で到達でき、1リクエストごとに invoices の行が増えメールが飛ぶ。
  const ipLimited = await enforceRateLimit("invoice-request", [
    { kind: "ip", value: clientIpFrom(req.headers), limit: 5, windowSeconds: 3600 },
  ]);
  if (ipLimited) return ipLimited;

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

  const { plan, municipalityName, contactName, contactEmail, contactPhone, address, invoiceNumber: invoiceNum, startMonth, notes } = parsed.data;

  // ── 回数制限（宛先メールアドレス）──────────────────────────────
  const mailLimited = await enforceRateLimit("invoice-request", [
    { kind: "email", value: contactEmail, limit: 3, windowSeconds: 3600 },
  ]);
  if (mailLimited) return mailLimited;

  // ⚠ **既存の自治体名は受け付けない。**
  //
  //   ここは未認証で公開インターネットから到達できるフォーム（料金ページの
  //   「請求書払いのご相談」）。かつては自治体名で `municipalities` を検索し、
  //   **既存があればそこに合流**したうえで、その自治体の `subscriptions` を
  //   `ON CONFLICT DO UPDATE SET plan = EXCLUDED.plan` で上書きしていた。
  //   自治体名は公開情報なので、**誰でも任意のテナントのプランを書き換えられた**。
  //   しかも `getActivePlan`（src/lib/plan-limits.ts）は `paused` を無効扱いに
  //   しないため、書き換えたプランがそのまま有効になっていた。
  //
  //   これは §3-5 で `/api/auth/register` から、c3e3846 で
  //   `api/admin/projects` の POST から取り除いたのと**同じ「名前による合流」**。
  //   3度目なので、ここでも同じ結論にする: **合流させない。既存名は 409。**
  //   claude/coe-tenant-isolation.md §10
  const munExisting = await query<{ id: string }>(
    "SELECT id FROM municipalities WHERE name = $1 LIMIT 1",
    [municipalityName.trim()],
  );
  if (munExisting[0]) {
    return NextResponse.json(
      {
        data: null,
        error:
          "この自治体は既に登録されています。お手数ですが、管理者の方からお問い合わせください。",
      },
      { status: 409 },
    );
  }

  // 事前チェックとの競合でも合流させない（WHERE NOT EXISTS 付き）
  const munInserted = await query<{ id: string }>(
    `INSERT INTO municipalities (name, slug, prefecture)
     SELECT $1, $2, '未設定'
     WHERE NOT EXISTS (SELECT 1 FROM municipalities WHERE name = $1)
     RETURNING id`,
    [municipalityName.trim(), `org-${Date.now()}`],
  );
  if (!munInserted[0]) {
    return NextResponse.json(
      { data: null, error: "この自治体は既に登録されています。" },
      { status: 409 },
    );
  }
  const municipalityId = munInserted[0].id;

  // 申込の記録として subscriptions を作る（**まだ権利は与えない**）。
  //
  // ⚠ `status = 'pending_invoice'` は getActivePlan が無効として扱う値。
  //   ここで有効になる値を入れると、**未認証の申込だけで有償プランが使える**。
  //   入金確認（運営者が invoice/[id]/pay を叩く）で 'active' になる。
  //   新規テナントなので ON CONFLICT は起きないが、念のため何もしない形にしてある。
  await query(
    `INSERT INTO subscriptions
       (municipality_id, plan, status, billing_method, trial_ends_at)
     VALUES ($1, $2, 'pending_invoice', 'invoice', NOW() + INTERVAL '14 days')
     ON CONFLICT (municipality_id) DO NOTHING`,
    [municipalityId, plan],
  );

  // 請求書番号採番
  const year = new Date().getFullYear();
  const countRows = await query<{ count: number }>(
    "SELECT COUNT(id)::int AS count FROM invoices WHERE invoice_number LIKE $1",
    [`INV-${year}-%`],
  );
  const nextNum = String((countRows[0]?.count ?? 0) + 1).padStart(4, "0");
  const newInvoiceNumber = `INV-${year}-${nextNum}`;

  const amount = PLAN_AMOUNTS[plan] ?? 0;
  const taxAmount = Math.round(amount * 0.1);
  const totalAmount = amount + taxAmount;

  // 開始月からperiodを計算
  const periodStart = `${startMonth}-01`;
  const periodEnd = new Date(new Date(periodStart).setMonth(new Date(periodStart).getMonth() + 1) - 1)
    .toISOString().slice(0, 10);
  const dueDate = new Date(new Date(periodStart).getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const subRows = await query<{ id: string }>(
    "SELECT id FROM subscriptions WHERE municipality_id = $1",
    [municipalityId],
  );

  const invInserted = await query<{ id: string }>(
    `INSERT INTO invoices
       (municipality_id, subscription_id, invoice_number,
        amount, tax_amount, total_amount,
        period_start, period_end, due_date, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'unpaid',$10)
     RETURNING id`,
    [
      municipalityId, subRows[0]?.id ?? null, newInvoiceNumber,
      amount, taxAmount, totalAmount,
      periodStart, periodEnd, dueDate,
      [
        invoiceNum ? `適格請求書番号: ${invoiceNum}` : null,
        `担当者: ${contactName}`,
        `電話: ${contactPhone ?? "未記入"}`,
        `住所: ${address}`,
        notes ?? null,
      ].filter(Boolean).join("\n"),
    ],
  );

  const invoiceId = invInserted[0]?.id;

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@sinap-sys.jp";
  const planLabel = PLAN_LABELS[plan] ?? plan;

  // 管理者通知メール
  await sendMail({
    to: adminEmail,
    subject: `【請求書払い申込】${municipalityName} - ${planLabel}プラン`,
    text: `
新しい請求書払い申込がありました。

自治体名: ${municipalityName}
プラン: ${planLabel} (¥${totalAmount.toLocaleString()}/月 税込)
担当者: ${contactName}（${contactEmail}）
電話: ${contactPhone ?? "未記入"}
住所: ${address}
開始希望月: ${startMonth}
請求書番号: ${newInvoiceNumber}
${notes ? `備考: ${notes}` : ""}

請求書ID: ${invoiceId ?? "未採番"}
    `.trim(),
  });

  // 申込者確認メール
  await sendMail({
    to: contactEmail,
    subject: "【Sinap-sys】請求書払い申込を受け付けました",
    html: `
<p>${contactName} 様</p>
<p>Sinap-sys 請求書払いのお申し込みを受け付けました。<br>
3営業日以内にご連絡いたします。</p>

<table border="1" cellpadding="8" style="border-collapse:collapse;">
  <tr><th>プラン</th><td>${planLabel}</td></tr>
  <tr><th>月額（税込）</th><td>¥${totalAmount.toLocaleString()}</td></tr>
  <tr><th>開始希望月</th><td>${startMonth}</td></tr>
  <tr><th>請求書番号</th><td>${newInvoiceNumber}</td></tr>
</table>

<p>ご不明な点は <a href="mailto:${adminEmail}">${adminEmail}</a> までお問い合わせください。</p>
<p>Sinap-sys サポートチーム</p>
    `.trim(),
    text: `${contactName} 様\n\nご申込ありがとうございます。3営業日以内にご連絡いたします。\nプラン: ${planLabel} / 月額: ¥${totalAmount.toLocaleString()}`,
  });

  return NextResponse.json({ data: { invoiceId, invoiceNumber: newInvoiceNumber }, error: null }, { status: 201 });
}
