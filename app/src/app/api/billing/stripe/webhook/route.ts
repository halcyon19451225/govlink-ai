export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { query } from "@/lib/db";
import type Stripe from "stripe";

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: "署名が不正です" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("Webhook signature error:", err);
    return NextResponse.json({ error: "署名検証に失敗しました" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const municipalityId = sub.metadata.municipality_id;
        if (!municipalityId) break;

        await query(
          `UPDATE subscriptions
           SET plan = $1, status = $2,
               stripe_subscription_id = $3,
               cancel_at_period_end = $4,
               billing_method = 'stripe',
               updated_at = NOW()
           WHERE municipality_id = $5`,
          [
            sub.metadata.plan ?? "standard",
            sub.status,
            sub.id,
            sub.cancel_at_period_end,
            municipalityId,
          ],
        );
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const municipalityId = sub.metadata.municipality_id;
        if (!municipalityId) break;

        await query(
          `UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
           WHERE municipality_id = $1`,
          [municipalityId],
        );
        break;
      }

      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;

        // customer metadataから municipality_id を取得
        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        if (!customerId) break;

        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const municipalityId = customer.metadata?.municipality_id;
        if (!municipalityId) break;

        const subRows = await query<{ id: string }>(
          "SELECT id FROM subscriptions WHERE municipality_id = $1",
          [municipalityId],
        );
        const subscriptionId = subRows[0]?.id ?? null;

        const year = new Date().getFullYear();
        const countRows = await query<{ count: number }>(
          "SELECT COUNT(id)::int AS count FROM invoices WHERE invoice_number LIKE $1",
          [`INV-${year}-%`],
        );
        const nextNum = String((countRows[0]?.count ?? 0) + 1).padStart(4, "0");
        const invoiceNumber = `INV-${year}-${nextNum}`;

        const totalAmount = inv.amount_paid ?? 0;
        const amount = Math.round(totalAmount / 1.1);
        const taxAmount = totalAmount - amount;

        await query(
          `INSERT INTO invoices
             (municipality_id, subscription_id, invoice_number,
              amount, tax_amount, total_amount,
              period_start, period_end, due_date, status, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()::date,NOW()::date,NOW()::date,'paid',NOW())
           ON CONFLICT DO NOTHING`,
          [municipalityId, subscriptionId, invoiceNumber, amount, taxAmount, totalAmount],
        );
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: "内部エラー" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
