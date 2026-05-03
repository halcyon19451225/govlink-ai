-- サブスクリプション管理
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id UUID NOT NULL
    REFERENCES municipalities(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','standard','premium')),
  status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN (
      'trialing','active','past_due','canceled','paused'
    )),
  billing_method TEXT
    CHECK (billing_method IN ('stripe','invoice',NULL)),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(municipality_id)
);

-- 請求書管理
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id UUID NOT NULL
    REFERENCES municipalities(id) ON DELETE CASCADE,
  subscription_id UUID
    REFERENCES subscriptions(id),
  invoice_number TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid','paid','overdue','canceled')),
  paid_at TIMESTAMPTZ,
  pdf_s3_key TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- プラン使用量トラッキング
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id UUID NOT NULL
    REFERENCES municipalities(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  ai_calls INTEGER DEFAULT 0,
  projects_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(municipality_id, month)
);
