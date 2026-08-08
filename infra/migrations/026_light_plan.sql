-- 026: subscriptions.plan に 'light' を追加
-- 実行先: Aurora (govlink)。psql で実行する。
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free','light','standard','premium'));
