-- ================================================================
-- module_artifacts バックフィル
-- ================================================================
-- 目的: R2 実装前に作成された既存レコードを module_artifacts に登録し、
--       source_artifact_ids を正しい値に更新する。
--
-- 実行場所: Supabase SQL Editor
-- 前提条件: 014_artifact_unique_constraint.sql が適用済みであること
--   → 未適用の場合はまず以下を実行:
--     ALTER TABLE module_artifacts
--       ADD CONSTRAINT IF NOT EXISTS module_artifacts_project_module_record_unique
--       UNIQUE (project_id, module_id, artifact_record_id);
--
-- 実行順序: STEP1 → STEP2 → STEP3 → STEP4 → STEP5 → STEP6
-- ================================================================

-- ----------------------------------------------------------------
-- STEP 0: 確認クエリ（実行前の状態を確認）
-- ----------------------------------------------------------------
/*
SELECT module_id, COUNT(*) AS cnt,
       COUNT(NULLIF(array_length(source_artifact_ids,1), NULL)) AS has_sources
FROM module_artifacts
GROUP BY module_id ORDER BY module_id;
*/

-- ----------------------------------------------------------------
-- STEP 1: gap_analysis のアーティファクトをバックフィル
-- ----------------------------------------------------------------
INSERT INTO module_artifacts
  (project_id, module_id, artifact_type, artifact_record_id,
   source_artifact_ids, source_datasets_snapshot, derivation_note, updated_at)
SELECT
  ga.project_id,
  'gap_analysis',
  'gap_table',
  ga.id,
  ARRAY[]::uuid[],
  '{}'::jsonb,
  ga.indicator_name || ' のギャップ分析',
  NOW()
FROM gap_analyses ga
WHERE NOT EXISTS (
  SELECT 1 FROM module_artifacts ma
  WHERE ma.project_id = ga.project_id
    AND ma.module_id  = 'gap_analysis'
    AND ma.artifact_record_id = ga.id
);

-- ----------------------------------------------------------------
-- STEP 2: issue_hypothesis のアーティファクトをバックフィル
-- ----------------------------------------------------------------
INSERT INTO module_artifacts
  (project_id, module_id, artifact_type, artifact_record_id,
   source_artifact_ids, derivation_note, updated_at)
SELECT
  ih.project_id,
  'issue_hypothesis',
  'hypothesis_sheet',
  ih.id,
  ARRAY[]::uuid[],   -- source_artifact_ids は STEP4 で更新
  CASE WHEN ih.gap_analysis_id IS NOT NULL
    THEN 'ギャップ分析(' || ih.gap_analysis_id || ')から課題仮説を設定'
    ELSE NULL
  END,
  NOW()
FROM issue_hypotheses ih
WHERE NOT EXISTS (
  SELECT 1 FROM module_artifacts ma
  WHERE ma.project_id = ih.project_id
    AND ma.module_id  = 'issue_hypothesis'
    AND ma.artifact_record_id = ih.id
);

-- ----------------------------------------------------------------
-- STEP 3: logic_model のアーティファクトをバックフィル
-- ----------------------------------------------------------------
INSERT INTO module_artifacts
  (project_id, module_id, artifact_type, artifact_record_id,
   source_artifact_ids, derivation_note, updated_at)
SELECT
  lm.project_id,
  'logic_model',
  'logic_model_v1',
  lm.id,
  ARRAY[]::uuid[],   -- source_artifact_ids は STEP5 で更新
  CASE WHEN lm.issue_hypothesis_id IS NOT NULL
    THEN '課題仮説(' || lm.issue_hypothesis_id || ')からロジックモデルを作成'
    ELSE 'ロジックモデル'
  END,
  NOW()
FROM logic_models lm
WHERE NOT EXISTS (
  SELECT 1 FROM module_artifacts ma
  WHERE ma.project_id = lm.project_id
    AND ma.module_id  = 'logic_model'
    AND ma.artifact_record_id = lm.id
);

-- ----------------------------------------------------------------
-- STEP 4: issue_hypothesis の source_artifact_ids を更新
--         （gap_analysis アーティファクトへの参照）
-- ----------------------------------------------------------------
UPDATE module_artifacts ma_ih
SET
  source_artifact_ids = ARRAY(
    SELECT ma_ga.id
    FROM module_artifacts ma_ga
    JOIN issue_hypotheses ih ON ih.id = ma_ih.artifact_record_id
    WHERE ma_ga.project_id  = ma_ih.project_id
      AND ma_ga.module_id   = 'gap_analysis'
      AND ma_ga.artifact_record_id = ih.gap_analysis_id
  ),
  updated_at = NOW()
FROM issue_hypotheses ih_ref
WHERE ma_ih.module_id = 'issue_hypothesis'
  AND ma_ih.artifact_record_id = ih_ref.id
  AND ih_ref.gap_analysis_id IS NOT NULL;

-- ----------------------------------------------------------------
-- STEP 5: logic_model の source_artifact_ids を更新
--         （issue_hypothesis アーティファクトへの参照）
-- ----------------------------------------------------------------
UPDATE module_artifacts ma_lm
SET
  source_artifact_ids = ARRAY(
    SELECT ma_ih.id
    FROM module_artifacts ma_ih
    JOIN logic_models lm ON lm.id = ma_lm.artifact_record_id
    WHERE ma_ih.project_id  = ma_lm.project_id
      AND ma_ih.module_id   = 'issue_hypothesis'
      AND ma_ih.artifact_record_id = lm.issue_hypothesis_id
  ),
  updated_at = NOW()
FROM logic_models lm_ref
WHERE ma_lm.module_id = 'logic_model'
  AND ma_lm.artifact_record_id = lm_ref.id
  AND lm_ref.issue_hypothesis_id IS NOT NULL;

-- ----------------------------------------------------------------
-- STEP 6: 結果確認
-- ----------------------------------------------------------------
SELECT
  module_id,
  COUNT(*) AS total,
  COUNT(NULLIF(array_length(source_artifact_ids, 1), NULL)) AS has_sources,
  COUNT(CASE WHEN array_length(source_artifact_ids, 1) IS NULL THEN 1 END) AS no_sources
FROM module_artifacts
GROUP BY module_id
ORDER BY module_id;
