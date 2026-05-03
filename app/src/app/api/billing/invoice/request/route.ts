import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { sendMail } from "@/lib/mailer";

const bodySchema = z.object({
  plan: z.enum(["standard", "premium"]),
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

  // 自治体を検索または作成
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
      [municipalityName, `org-${Date.now()}`],
    );
    if (!munInserted[0]) {
      return NextResponse.json({ data: null, error: "自治体情報の作成に失敗しました" }, { status: 500 });
    }
    municipalityId = munInserted[0].id;
  }

  // サブスクリプションを仮登録（paused）
  await query(
    `INSERT INTO subscriptions
       (municipality_id, plan, status, billing_method, trial_ends_at)
     VALUES ($1, $2, 'paused', 'invoice', NOW() + INTERVAL '14 days')
     ON CONFLICT (municipality_id)
     DO UPDATE SET plan = EXCLUDED.plan, status = 'paused',
                   billing_method = 'invoice', updated_at = NOW()`,
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
