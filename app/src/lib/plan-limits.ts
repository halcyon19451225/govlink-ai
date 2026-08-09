import { query } from "@/lib/db";
import { getOrgPlan } from "@/lib/org-license";

export const PLAN_LIMITS = {
  free: {
    projects: 1,
    users: 3,
    ai_calls_per_month: 10,
    template_sharing: false,
    invoice_billing: false,
    trial_days: 30,
  },
  light: {
    projects: 3,
    users: 5,
    ai_calls_per_month: 50,
    template_sharing: false,
    invoice_billing: true,
    trial_days: 0,
  },
  standard: {
    projects: 10,
    users: 10,
    ai_calls_per_month: 100,
    template_sharing: true,
    invoice_billing: true,
    trial_days: 0,
  },
  premium: {
    projects: Infinity,
    users: Infinity,
    ai_calls_per_month: Infinity,
    template_sharing: true,
    invoice_billing: true,
    trial_days: 0,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

interface SubscriptionRow {
  plan: string;
  status: string;
  trial_ends_at: string | null;
}

const PLAN_RANK: Record<Plan, number> = { free: 0, light: 1, standard: 2, premium: 3 };

async function getActivePlan(municipalityId: string): Promise<Plan> {
  const rows = await query<SubscriptionRow>(
    `SELECT plan, status, trial_ends_at::text
     FROM subscriptions WHERE municipality_id = $1`,
    [municipalityId],
  );
  const sub = rows[0];

  let stripePlan: Plan = "free";
  if (sub) {
    const trialExpired =
      sub.status === "trialing" &&
      !!sub.trial_ends_at &&
      new Date(sub.trial_ends_at) < new Date();
    const inactive = sub.status === "canceled" || sub.status === "past_due";
    if (!trialExpired && !inactive) {
      stripePlan = (sub.plan as Plan) ?? "free";
    }
  }

  // 組織コード契約（Ordo 台帳・請求書払い等）。Stripe 契約と強い方を採用する。
  let orgPlan: Plan = "free";
  try {
    orgPlan = (await getOrgPlan(municipalityId)) ?? "free";
  } catch {
    /* Ordo 照会失敗時は Stripe 契約のみで判定 */
  }

  return PLAN_RANK[orgPlan] > PLAN_RANK[stripePlan] ? orgPlan : stripePlan;
}

export async function checkLimit(
  municipalityId: string,
  limitType: "projects" | "users" | "ai_calls",
): Promise<{ allowed: boolean; current: number; limit: number; plan: Plan }> {
  // 開発環境では上限チェックをスキップ（本番では従来通り適用）
  if (process.env.NODE_ENV !== "production") {
    return { allowed: true, current: 0, limit: Infinity, plan: "premium" };
  }

  const plan = await getActivePlan(municipalityId);
  const limits = PLAN_LIMITS[plan];

  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  let current = 0;
  let limit = 0;

  if (limitType === "projects") {
    limit = limits.projects;
    const rows = await query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM projects WHERE municipality_id = $1",
      [municipalityId],
    );
    current = rows[0]?.count ?? 0;
  } else if (limitType === "users") {
    limit = limits.users;
    const rows = await query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM user_roles WHERE municipality_id = $1",
      [municipalityId],
    );
    current = rows[0]?.count ?? 0;
  } else {
    limit = limits.ai_calls_per_month;
    const rows = await query<{ ai_calls: number }>(
      `SELECT ai_calls FROM usage_tracking
       WHERE municipality_id = $1 AND month = $2`,
      [municipalityId, month],
    );
    current = rows[0]?.ai_calls ?? 0;
  }

  return {
    allowed: limit === Infinity || current < limit,
    current,
    limit,
    plan,
  };
}

export async function incrementAiUsage(municipalityId: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  await query(
    `INSERT INTO usage_tracking (municipality_id, month, ai_calls, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (municipality_id, month)
     DO UPDATE SET ai_calls = usage_tracking.ai_calls + 1, updated_at = NOW()`,
    [municipalityId, month],
  );
}

export async function getUsage(municipalityId: string): Promise<{
  plan: Plan;
  status: string;
  trialEndsAt: string | null;
  projects: { current: number; limit: number };
  users: { current: number; limit: number };
  aiCalls: { current: number; limit: number };
}> {
  const plan = await getActivePlan(municipalityId);
  const limits = PLAN_LIMITS[plan];
  const month = new Date().toISOString().slice(0, 7);

  const [subRows, projectRows, userRows, usageRows] = await Promise.all([
    query<{ status: string; trial_ends_at: string | null }>(
      "SELECT status, trial_ends_at::text FROM subscriptions WHERE municipality_id = $1",
      [municipalityId],
    ),
    query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM projects WHERE municipality_id = $1",
      [municipalityId],
    ),
    query<{ count: number }>(
      "SELECT COUNT(id)::int AS count FROM user_roles WHERE municipality_id = $1",
      [municipalityId],
    ),
    query<{ ai_calls: number }>(
      "SELECT ai_calls FROM usage_tracking WHERE municipality_id = $1 AND month = $2",
      [municipalityId, month],
    ),
  ]);

  return {
    plan,
    status: subRows[0]?.status ?? "trialing",
    trialEndsAt: subRows[0]?.trial_ends_at ?? null,
    projects: {
      current: projectRows[0]?.count ?? 0,
      limit: limits.projects,
    },
    users: {
      current: userRows[0]?.count ?? 0,
      limit: limits.users,
    },
    aiCalls: {
      current: usageRows[0]?.ai_calls ?? 0,
      limit: limits.ai_calls_per_month,
    },
  };
}
