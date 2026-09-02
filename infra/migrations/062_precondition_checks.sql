-- 062_precondition_checks.sql
-- CA2-7c: 様式H2 前提条件表 — 年次評価での前提確認と、不成立時の改善アクション自動起票
--
-- 設計: claude/coe-eval-reflect-forms.md（H2）
--   前提（条件・確認方法・崩れた場合の対応）は施策側 measure_designs.preconditions（060）。
--   **年次の確認結果は評価側**に持つ（施策構築のデータを評価が書き換えない）:
--     program_evaluations.precondition_checks … [{ id, condition, state: 'holds'|'broken'|'unchecked', note }]
--   前提が崩れたら、承認時に改善アクション（source='precondition'）を自動起票し、
--   期末を待たずに進捗管理ルール（中止又は他取組の検討）を起動する。
--
-- 冪等: ADD COLUMN IF NOT EXISTS ／ CHECK の張り替えは上位集合。
-- ※ このファイルに BEGIN/COMMIT は書かない（ランナーがトランザクションを張る）。

ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS precondition_checks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN program_evaluations.precondition_checks IS
  '様式H2 年次の前提確認 [{id,condition,state:holds|broken|unchecked,note}]。前提の定義は measure_designs.preconditions';

-- 改善アクションの出所に 'precondition' を追加（既存値はすべて残す・上位集合）
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
      'handover',
      'precondition'          -- 前提条件の不成立（H2）から自動起票
    ));

DO $$ BEGIN
  RAISE NOTICE 'CA2-7c: program_evaluations.precondition_checks と improvement_actions.source=precondition を用意しました';
END $$;
