-- ================================================================
-- 016_program_eval_integration.sql
-- プログラム評価5階層への再設計（案B-2）フェーズP1: DBスキーマ変更
--
-- 設計ドキュメント: docs/PROGRAM_EVALUATION_REDESIGN.md（§3 案B-2 / §5 P1）
--
-- 目的:
--   効率性評価（旧コスト効率）をプログラム評価の第5階層として統合する。
--   cost_efficiency_records テーブルは維持しつつ、program_evaluations と
--   1対1で強く紐付ける（案B-2）。
--
-- 方針（MIGRATION_POLICY.md 準拠）:
--   - DROP COLUMN / DROP TABLE は行わない（後方互換・データ保全）。
--   - CHECK 制約は DROP + 再作成（冪等）で更新する（010 の status_check と同手法）。
--   - 既存 tier 値（needs/theory/process/outcome_initial/outcome_intermediate/
--     cost_efficiency）はすべて維持し、新たに 'efficiency' を許可する。
-- ================================================================

-- ================================================================
-- Step 1: program_evaluations.evaluation_tier に 'efficiency' を追加
--   既存の CHECK 制約（010 で inline 定義、自動命名）を冪等に張り替える。
--   'cost_efficiency'（旧称）と 'efficiency'（新称）を併存させ後方互換を確保。
-- ================================================================
ALTER TABLE program_evaluations
  DROP CONSTRAINT IF EXISTS program_evaluations_evaluation_tier_check;

ALTER TABLE program_evaluations
  ADD CONSTRAINT program_evaluations_evaluation_tier_check
    CHECK (evaluation_tier IN (
      'needs',
      'theory',
      'process',
      'outcome',               -- アプリ既存値（アウトカム評価・後方互換）
      'outcome_initial',
      'outcome_intermediate',
      'cost',                  -- アプリ既存値（旧コスト評価・後方互換）
      'cost_efficiency',       -- 旧称（後方互換のため残置）
      'efficiency'             -- 新称（第5階層・効率性評価）
    ));

-- ================================================================
-- Step 2: cost_efficiency_records と program_evaluations の 1対1 紐付けを強化
--
--   Step 2-1: 重複クリーンアップ
--     同一 program_evaluation_id を指す行が複数ある場合、最古（created_at 昇順、
--     同値は id 昇順）の1件を残し、残りの program_evaluation_id を NULL に更新する。
--     （データ自体は保持し、紐付けのみ解除する＝非破壊的）
-- ================================================================
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY program_evaluation_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM cost_efficiency_records
  WHERE program_evaluation_id IS NOT NULL
)
UPDATE cost_efficiency_records cer
SET program_evaluation_id = NULL
FROM ranked
WHERE cer.id = ranked.id
  AND ranked.rn > 1;

-- ================================================================
--   Step 2-2: 孤児 ID のクリーンアップ
--     存在しない program_evaluations を指す行を NULL に更新（参照整合性）。
-- ================================================================
UPDATE cost_efficiency_records
SET program_evaluation_id = NULL
WHERE program_evaluation_id IS NOT NULL
  AND program_evaluation_id NOT IN (SELECT id FROM program_evaluations);

-- ================================================================
--   Step 2-3: 1対1 を保証する UNIQUE 制約（部分インデックス）
--     program_evaluation_id IS NOT NULL の行に対してのみ一意性を強制する。
--     （複数の NULL は許可 = 旧来の独立レコードを温存）
-- ================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_efficiency_program_evaluation
  ON cost_efficiency_records (program_evaluation_id)
  WHERE program_evaluation_id IS NOT NULL;
