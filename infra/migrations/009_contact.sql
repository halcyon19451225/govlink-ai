-- お問い合わせ一覧テーブル
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_type TEXT NOT NULL,
  org_name     TEXT NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_inquiries_created_at ON contact_inquiries (created_at DESC);
