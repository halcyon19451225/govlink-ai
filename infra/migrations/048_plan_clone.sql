-- ================================================================
-- 048_plan_clone.sql
-- PL1: P① 次期計画のたたき台作成（前期計画の複製）＋ P② 引き継ぎ取り込みの器
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 P①・P②
--
-- 【構成】
--   projects        … cloned_from_project_id（前期→次期の系譜。バナー表示・重複作成ガード）
--   logic_models    … cloned_from_project_id / cloned_from_logic_model_id
--                     （前期の現行版 → 新計画の第1版、の系譜を記録）
--   kpis            … cloned_from_kpi_id（引き継ぎ取込のKPI対応表）
--                     target_needs_review（複製時は前期targetを据え置き「要見直し」フラグを立てる —
--                     targetはNOT NULLのため空欄にはできない）
--   measure_designs … cloned_from_measure_id（carry_over改善アクションの反映先解決に使う）
--   improvement_actions … source に 'handover' を追加（CHECK張り替え・上位集合）
--                         plan_handover_id（どの引き継ぎから起票されたか — リネージ）
--   ai_task_routing … proposal.handover_intake の種付け（P②のAI差分提案）
--
-- 方針: MIGRATION_POLICY.md 準拠。追加のみ。冪等。
-- ================================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS cloned_from_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN projects.cloned_from_project_id IS
  '前期計画（複製元）。P①で設定。次期計画ダッシュボードの引き継ぎバナー・P②の対応表解決に使う（PL1）';

ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS cloned_from_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloned_from_logic_model_id UUID REFERENCES logic_models(id) ON DELETE SET NULL;

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS cloned_from_kpi_id UUID REFERENCES kpis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_needs_review BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN kpis.target_needs_review IS
  '複製直後のtargetは前期値の据え置き — 新期の目標として見直しが必要（PL1 P①。見直したらfalseに）';

ALTER TABLE measure_designs
  ADD COLUMN IF NOT EXISTS cloned_from_measure_id UUID REFERENCES measure_designs(id) ON DELETE SET NULL;

ALTER TABLE improvement_actions
  ADD COLUMN IF NOT EXISTS plan_handover_id UUID REFERENCES plan_handovers(id) ON DELETE SET NULL;

-- source の CHECK に 'handover' を追加（既存値はすべて残す・上位集合）
ALTER TABLE improvement_actions
  DROP CONSTRAINT IF EXISTS improvement_actions_source_check;
ALTER TABLE improvement_actions
  ADD CONSTRAINT improvement_actions_source_check
    CHECK (source IN (
      'program_evaluation',
      'self_evaluation',
      'ai_suggestion',
      'improvement_dialogue',
      'checkpoint',
      'manual',
      'handover'              -- 前期からの引き継ぎ取込（PL1 P②）
    ));

-- ── AIタスク種別の種付け（P②の差分提案）─────────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('proposal.handover_intake', '前期引き継ぎパッケージからの反映差分提案（PL1）')
ON CONFLICT (task_type) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'PL1: 複製系譜（projects/logic_models/kpis/measure_designs）・target要見直しフラグ・handover起票・proposal.handover_intake を用意しました';
END $$;
