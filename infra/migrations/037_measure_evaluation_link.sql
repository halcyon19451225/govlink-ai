-- ================================================================
-- 037_measure_evaluation_link.sql
-- E5: 施策データセットを C評価・A改善へ接続する
--
-- 設計: claude/coe-ebpm-plan.md（承認済み方針）の最終段
--
-- 【背景】E1〜E4 で施策データセット（エビデンス・実験設計・SPO指標・
--   KPI・コスト）が構築できるようになったが、評価がどの施策を
--   評価しているのかを記録する場所が無かった。
--   - 評価 → 施策: program_evaluations.measure_design_id。
--     「この評価は、この施策（この実験設計・このKPI）を前提にした」を残す。
--     施策側の kpi_ids・実験設計・コストの算定式が評価画面に揃う。
--   - 改善 → 施策: improvement_actions.reflect_measure_design_id。
--     改善の反映先に「施策の見直し」（対象・介入・指標の変更）を加え、
--     A工程から施策データセットへの還り道を作る。
--
-- 方針: MIGRATION_POLICY.md 準拠。列追加のみ（破壊的変更なし）。冪等。
-- ================================================================

-- ── 評価 → 施策 ─────────────────────────────────
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS measure_design_id UUID
    REFERENCES measure_designs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_program_evaluations_measure
  ON program_evaluations (measure_design_id)
  WHERE measure_design_id IS NOT NULL;

COMMENT ON COLUMN program_evaluations.measure_design_id IS
  'この評価が対象にした施策データセット（EBPM）。施策のKPI・実験設計・コスト算定式を評価の前提として参照する';

-- ── 改善 → 施策 ─────────────────────────────────
ALTER TABLE improvement_actions
  ADD COLUMN IF NOT EXISTS reflect_measure_design_id UUID
    REFERENCES measure_designs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_improvement_actions_reflect_measure
  ON improvement_actions (reflect_measure_design_id)
  WHERE reflect_measure_design_id IS NOT NULL;

COMMENT ON COLUMN improvement_actions.reflect_measure_design_id IS
  '反映先: 施策の見直し（施策データセットの対象・介入・指標の変更）。A工程から施策への還り道';

-- ── 確認用ログ ───────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '施策×評価の接続: program_evaluations.measure_design_id / improvement_actions.reflect_measure_design_id を用意しました';
END $$;
