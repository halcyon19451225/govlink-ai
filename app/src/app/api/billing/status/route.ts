export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUsage } from "@/lib/plan-limits";
import { query } from "@/lib/db";

export async function GET(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  const [usage, invoices, subRows] = await Promise.all([
    getUsage(municipalityId),
    query<{
      id: string;
      invoice_number: string;
      total_amount: number;
      period_start: string;
      period_end: string;
      status: string;
      created_at: string;
    }>(
      `SELECT id, invoice_number, total_amount,
              period_start::text, period_end::text, status, created_at::text
       FROM invoices WHERE municipality_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [municipalityId],
    ),
    query<{ billing_method: string | null; stripe_customer_id: string | null; cancel_at_period_end: boolean }>(
      "SELECT billing_method, stripe_customer_id, cancel_at_period_end FROM subscriptions WHERE municipality_id = $1",
      [municipalityId],
    ),
  ]);

  return NextResponse.json({
    data: {
      ...usage,
      invoices,
      billingMethod: subRows[0]?.billing_method ?? null,
      cancelAtPeriodEnd: subRows[0]?.cancel_at_period_end ?? false,
    },
    error: null,
  });
}
