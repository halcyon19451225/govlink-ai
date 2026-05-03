import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { sendMail } from "@/lib/mailer";

type Params = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const invRows = await query<{
    id: string;
    municipality_id: string;
    subscription_id: string | null;
    invoice_number: string;
    total_amount: number;
    plan: string;
    status: string;
  }>(
    `SELECT i.id, i.municipality_id, i.subscription_id,
            i.invoice_number, i.total_amount, i.status,
            s.plan
     FROM invoices i
     LEFT JOIN subscriptions s ON s.id = i.subscription_id
     WHERE i.id = $1`,
    [params.id],
  );

  const inv = invRows[0];
  if (!inv) {
    return NextResponse.json({ data: null, error: "請求書が見つかりません" }, { status: 404 });
  }
  if (inv.status === "paid") {
    return NextResponse.json({ data: null, error: "すでに支払済みです" }, { status: 400 });
  }

  // 請求書を paid に更新
  await query(
    "UPDATE invoices SET status = 'paid', paid_at = NOW() WHERE id = $1",
    [params.id],
  );

  // サブスクリプションを active に更新
  if (inv.subscription_id) {
    await query(
      `UPDATE subscriptions
       SET status = 'active',
           current_period_start = NOW(),
           current_period_end = NOW() + INTERVAL '1 month',
           updated_at = NOW()
       WHERE id = $1`,
      [inv.subscription_id],
    );
  }

  // 自治体のメールアドレスを取得（user_rolesから）
  const userRows = await query<{ email: string; display_name: string }>(
    "SELECT email, display_name FROM user_roles WHERE municipality_id = $1 ORDER BY created_at LIMIT 1",
    [inv.municipality_id],
  );
  const recipient = userRows[0];

  if (recipient) {
    const planLabel = inv.plan === "premium" ? "Premium" : "Standard";
    await sendMail({
      to: recipient.email,
      subject: `【Sinap-sys】ご入金を確認しました（${inv.invoice_number}）`,
      html: `
<p>${recipient.display_name} 様</p>
<p>ご入金の確認が取れましたので、Sinap-sys ${planLabel} プランをご利用いただけます。</p>

<table border="1" cellpadding="8" style="border-collapse:collapse;">
  <tr><th>請求書番号</th><td>${inv.invoice_number}</td></tr>
  <tr><th>プラン</th><td>${planLabel}</td></tr>
  <tr><th>金額（税込）</th><td>¥${inv.total_amount.toLocaleString()}</td></tr>
</table>

<p>引き続きよろしくお願いいたします。</p>
<p>Sinap-sys サポートチーム</p>
      `.trim(),
      text: `${recipient.display_name} 様\nご入金を確認しました。プランが有効になりました。`,
    });
  }

  return NextResponse.json({ data: { id: params.id, status: "paid" }, error: null });
}
