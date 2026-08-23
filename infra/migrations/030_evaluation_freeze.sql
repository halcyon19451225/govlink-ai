-- ================================================================
-- 030_evaluation_freeze.sql
-- P3: 評価とKPIの接続 ＋ 承認時の凍結（スナップショット）
--
-- 設計: claude/coe-ca-audit.md ／ アウトカム三層評価と改善サイクル C-2・C-6
--
-- 【なぜ凍結が要るか】
--   評価の達成率をKPI実績から自動算出すると、あとからKPIが更新されたときに
--   過去の評価結果まで書き換わってしまう。承認（approved）した時点の
--   KPI実績値と算定式を評価行に固定し、監査可能性を担保する。
--
-- 方針: MIGRATION_POLICY.md 準拠。ADD COLUMN のみ（冪等）。
-- ================================================================

-- 承認時点のKPI実績スナップショット
--   [{ kpi_id, label, unit, current, target, baseline, condition,
--      rate, clamped, achieved, formula }]
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS kpi_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

-- KPI実績から自動算出した到達度（担当者が achievement_rate を手で上書きしても
-- 「システムはこう算定した」を残すため、別列で保持する）
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS computed_achievement_rate NUMERIC;

-- 凍結した時刻。NULL なら未凍結（KPI更新に追随する）
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS approved_snapshot_at TIMESTAMPTZ;

COMMENT ON COLUMN program_evaluations.kpi_snapshot IS
  '承認時点のKPI実績と到達度の算定結果。承認後はこれが正（後からKPIが変わっても書き換わらない）';
COMMENT ON COLUMN program_evaluations.computed_achievement_rate IS
  'KPI実績から自動算出した到達度(%)。achievement_rate は担当者の上書き値';
COMMENT ON COLUMN program_evaluations.approved_snapshot_at IS
  'kpi_snapshot を凍結した時刻。NULL は未凍結';

-- kpi_ids での逆引き（中間評価が短期評価をロールアップする際に使う）
CREATE INDEX IF NOT EXISTS idx_program_evaluations_kpi_ids
  ON program_evaluations USING GIN (kpi_ids);

-- 評価スパン別の絞り込み（ロールアップ・スコアボード）
CREATE INDEX IF NOT EXISTS idx_program_evaluations_project_tier
  ON program_evaluations (project_id, evaluation_tier);
