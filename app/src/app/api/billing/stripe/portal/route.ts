import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export async function POST(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  const rows = await query<{ stripe_customer_id: string | null }>(
    "SELECT stripe_customer_id FROM subscriptions WHERE municipality_id = $1",
    [municipalityId],
  );
  const customerId = rows[0]?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json({ data: null, error: "Stripe顧客情報が見つかりません" }, { status: 404 });
  }

  const stripe = getStripe();
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/billing`,
  });

  return NextResponse.json({ data: { url: portalSession.url }, error: null });
}
