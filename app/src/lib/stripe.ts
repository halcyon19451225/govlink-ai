import Stripe from "stripe";

// シングルトン（Cold Start対策）
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY が設定されていません");
    _stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  }
  return _stripe;
}

export const STRIPE_PRICE_IDS: Record<string, string | undefined> = {
  standard: process.env.STRIPE_STANDARD_PRICE_ID,
  premium: process.env.STRIPE_PREMIUM_PRICE_ID,
};
