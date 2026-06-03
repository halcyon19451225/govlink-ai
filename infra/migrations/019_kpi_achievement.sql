-- ================================================================
-- 019_kpi_achievement.sql
-- kpis テーブルに達成水準・達成期限を追加
-- ================================================================

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS achievement_condition TEXT
    CHECK (achievement_condition IN ('lte', 'lt', 'gte', 'gt', 'eq'));

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS target_deadline DATE;
