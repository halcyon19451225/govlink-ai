-- 027: 組織コード連携（Ordo ライセンス台帳との紐づけ）
-- 実行先: Aurora (govlink)。psql で実行する。
ALTER TABLE municipalities
  ADD COLUMN IF NOT EXISTS org_code TEXT,
  ADD COLUMN IF NOT EXISTS org_name TEXT,
  ADD COLUMN IF NOT EXISTS org_linked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS municipalities_org_code_key
  ON municipalities (org_code) WHERE org_code IS NOT NULL;
