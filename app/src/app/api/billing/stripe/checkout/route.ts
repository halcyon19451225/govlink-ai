export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getStripe, STRIPE_PRICE_IDS } from "@/lib/stripe";

const bodySchema = z.object({
  plan: z.enum(["light", "standard", "premium"]),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "プランが不正です" }, { status: 400 });
  }

  const { plan } = parsed.data;
  const priceId = STRIPE_PRICE_IDS[plan];
  if (!priceId) {
    return NextResponse.json({ data: null, error: "Stripe価格IDが設定されていません" }, { status: 500 });
  }

  const stripe = getStripe();
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  try {
    // 既存のStripe顧客IDを取得
    const subRows = await query<{ stripe_customer_id: string | null }>(
      "SELECT stripe_customer_id FROM subscriptions WHERE municipality_id = $1",
      [municipalityId],
    );
    let customerId = subRows[0]?.stripe_customer_id ?? undefined;

    // 自治体名を取得
    const munRows = await query<{ name: string; id: string }>(
      "SELECT name, id FROM municipalities WHERE id = $1",
      [municipalityId],
    );
    const munName = munRows[0]?.name ?? "";

    // 顧客未作成の場合は作成
    if (!customerId) {
      const customerParams: Parameters<typeof stripe.customers.create>[0] = {
        name: munName,
        metadata: { municipality_id: municipalityId },
        ...(session.user?.email ? { email: session.user.email } : {}),
      };
      const customer = await stripe.customers.create(customerParams);
      customerId = customer.id;

      // subscriptionsテーブルに顧客IDを保存
      await query(
        `INSERT INTO subscriptions (municipality_id, stripe_customer_id, plan, status)
         VALUES ($1, $2, $3, 'trialing')
         ON CONFLICT (municipality_id)
         DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = NOW()`,
        [municipalityId, customerId, plan],
      );
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
      metadata: { municipality_id: municipalityId, plan },
      subscription_data: {
        metadata: { municipality_id: municipalityId, plan },
      },
    });

    return NextResponse.json({ data: { url: checkoutSession.url }, error: null });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ data: null, error: "決済セッションの作成に失敗しました" }, { status: 500 });
  }
}
