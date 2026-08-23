-- ================================================================
-- 031_outcome_tier_backfill.sql
-- アウトカム階層の誤分類を、目標期限から推定して補正する
--
-- 【背景】
--   KPI 作成時の indicator_type が既定値 'outcome_initial'（短期）に固定されていた。
--     - api/admin/projects/[id]/kpis/route.ts の zod default
--     - NewProjectWizard.tsx が全KPIに "outcome_initial" をハードコード
--   その結果、期限が2041年3月の長期指標まで「短期アウトカム（概ね1年）」として
--   スコアボードに並んでしまう。表示は正しく、データの分類が誤っている。
--
-- 【補正の方針】
--   計画開始日から目標期限までの長さ（horizon）で推定する:
--     18か月以下   → outcome_initial       （短期・概ね1年）
--     5年6か月以下 → outcome_intermediate  （中間・2〜5年）
--     それ超       → outcome_long          （長期・計画期間を超える）
--
--   **既定値のまま（outcome_initial）で、かつ期限が18か月を超える行だけ**を対象にする。
--   担当者が意図して設定した分類は動かさない（昇格のみ・降格はしない）。
--   期限が未設定の行も対象外（推定材料がないため）。
-- ================================================================

WITH horizon AS (
  SELECT
    k.id,
    -- 計画開始日が未設定なら KPI の作成日を起点にする
    (k.target_deadline - COALESCE(p.plan_start_date, k.created_at::date)) AS days
  FROM kpis k
  JOIN projects p ON p.id = k.project_id
  WHERE k.target_deadline IS NOT NULL
    AND k.indicator_type = 'outcome_initial'
)
UPDATE kpis k
SET indicator_type = CASE
      WHEN h.days > 2007 THEN 'outcome_long'          -- 5年6か月超
      WHEN h.days > 548  THEN 'outcome_intermediate'  -- 18か月超
      ELSE k.indicator_type
    END,
    updated_at = now()
FROM horizon h
WHERE k.id = h.id
  AND h.days > 548;

-- 補正結果の確認用（実行時のログに出る）
DO $$
DECLARE
  n_long INT;
  n_mid  INT;
  n_init INT;
BEGIN
  SELECT COUNT(*) INTO n_long FROM kpis WHERE indicator_type = 'outcome_long';
  SELECT COUNT(*) INTO n_mid  FROM kpis WHERE indicator_type IN ('outcome_intermediate','outcome_mid');
  SELECT COUNT(*) INTO n_init FROM kpis WHERE indicator_type = 'outcome_initial';
  RAISE NOTICE '補正後のアウトカム分類: 長期=% / 中間=% / 短期=%', n_long, n_mid, n_init;
END $$;
