-- ================================================================
-- 015_fk_integrity.sql
-- logic_models.issue_hypothesis_id に FK 制約を追加する
--
-- 背景:
--   010_care_plan_suite.sql で issue_hypothesis_id 列は追加されたが、
--   REFERENCES 句が付いていなかったため参照整合性が保証されていなかった。
--   R1 フェーズで AI 生成時に issue_hypothesis_id を正しく設定するよう
--   修正済みのため、ここで制約を追加する。
--
-- 事前クリーンアップ:
--   孤児 ID（存在しない issue_hypotheses を指す行）を NULL に更新する。
-- ================================================================

-- Step 1: 孤児 ID を NULL に更新
UPDATE logic_models
SET issue_hypothesis_id = NULL
WHERE issue_hypothesis_id IS NOT NULL
  AND issue_hypothesis_id NOT IN (SELECT id FROM issue_hypotheses);

-- Step 2: FK 制約を追加
ALTER TABLE logic_models
  ADD CONSTRAINT fk_logic_models_issue_hypothesis
  FOREIGN KEY (issue_hypothesis_id)
  REFERENCES issue_hypotheses(id)
  ON DELETE SET NULL;
