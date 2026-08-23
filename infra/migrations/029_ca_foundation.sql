-- ================================================================
-- 029_ca_foundation.sql
-- C（評価）/ A（改善）工程の土台修復と、達成率算定の作り直し
--
-- 設計: claude/coe-ca-audit.md ／ アウトカム三層評価と改善サイクル P1
--
-- 【背景1】program_evaluations は現状ほぼ保存できない
--   010 のスキーマと api/.../evaluations/route.ts の INSERT が3点で食い違う:
--     (1) checkpoint_id が NOT NULL だが INSERT 文に列が含まれない
--     (2) status の CHECK は pending/in_progress/completed だが
--         アプリは draft/in_review/approved を送る
--     (3) fiscal_year が NOT NULL だが API は未入力時 null を渡す
--   さらに program-evaluation/page.tsx の SELECT が .catch(() => []) で
--   握り潰すため、画面上は「レコード0件」に見えてエラーが表面化しない。
--
-- 【背景2】達成率が指標の向きを無視している
--   current / target × 100 を EBPMスコア・KPIサマリー・KPI報告が使用。
--   「給付総額 14億円以下」現状23億 → 達成率164% と表示される。
--   計画策定時の baseline からの前進量で測る方式に改める（§03）。
--
-- 方針: MIGRATION_POLICY.md 準拠。DROP COLUMN / DROP TABLE は行わない。
--       CHECK は DROP + 再作成（冪等）。旧値は後方互換のため併存させる。
-- ================================================================

-- ================================================================
-- Step 1: program_evaluations の保存を可能にする
-- ================================================================

-- (1) checkpoint_id を NULL 許容にする
--     チェックポイント外の随時評価を認めるため。
ALTER TABLE program_evaluations
  ALTER COLUMN checkpoint_id DROP NOT NULL;

-- (3) fiscal_year を NULL 許容にする
ALTER TABLE program_evaluations
  ALTER COLUMN fiscal_year DROP NOT NULL;

-- (2) status の CHECK をアプリ実装に合わせる。
--     旧値（pending/in_progress/completed）も残し既存行を壊さない。
ALTER TABLE program_evaluations
  DROP CONSTRAINT IF EXISTS program_evaluations_status_check;

ALTER TABLE program_evaluations
  ADD CONSTRAINT program_evaluations_status_check
    CHECK (status IN (
      'draft', 'in_review', 'approved',        -- アプリ実装の語彙
      'pending', 'in_progress', 'completed'    -- 010 の旧値（後方互換）
    ));

-- 長期アウトカム評価の階層を新設する。
-- 長期は「評価」ではなく常時監視だが、中間評価が長期の軌道に対して
-- どうだったかを記録するための器として tier を用意する。
ALTER TABLE program_evaluations
  DROP CONSTRAINT IF EXISTS program_evaluations_evaluation_tier_check;

ALTER TABLE program_evaluations
  ADD CONSTRAINT program_evaluations_evaluation_tier_check
    CHECK (evaluation_tier IN (
      'needs',
      'theory',
      'process',
      'outcome',                 -- アプリ既存値（後方互換）
      'outcome_initial',         -- 短期アウトカム（概ね1年）
      'outcome_intermediate',    -- 中間アウトカム（2〜5年）
      'outcome_long',            -- 長期アウトカム（計画期間を超える）★新設
      'cost',                    -- アプリ既存値（後方互換）
      'cost_efficiency',         -- 旧称（後方互換）
      'efficiency'               -- 第5階層・効率性評価
    ));

COMMENT ON COLUMN program_evaluations.checkpoint_id IS
  'PDCAチェックポイント。NULL はチェックポイント外の随時評価';

-- ================================================================
-- Step 2: 達成率を正しく算定するための基準値を持たせる
--
--   到達度 = 計画策定時（baseline）から目標へどれだけ前進したか。
--     「以上」目標: (current − baseline) / (target − baseline) × 100
--     「以下」目標: (baseline − current) / (baseline − target) × 100
--   0% = 策定時から不変 / 100% = 目標到達 / 負値 = 逆行
-- ================================================================

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS baseline_value NUMERIC;

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS baseline_year INT;

COMMENT ON COLUMN kpis.baseline_value IS
  '計画策定時点の値。到達度算定の起点（NULL の場合は比率方式にフォールバック）';
COMMENT ON COLUMN kpis.baseline_year IS
  'baseline_value を観測した年度';

-- 既存 KPI のバックフィル: 前期値があればそれを、無ければ現在値を基準値とする。
-- （現在値を基準にすると到達度は 0% から始まる ＝ 策定時から動いていない、
--   という正しい初期状態になる）
UPDATE kpis
SET baseline_value = COALESCE(previous_value, current)
WHERE baseline_value IS NULL;

-- ================================================================
-- Step 3: 三層アウトカムの連鎖（短期 → 中間 → 長期）
--
--   ロジックモデルの成果の連鎖を KPI 同士の親子関係として持たせる。
--   これにより中間評価の画面へ短期評価の履歴を自動で集約でき、
--   図7フローの第2の問い「中間の未達は初期アウトカムに起因するか」に
--   システムが材料を揃えた状態で答えられる。
-- ================================================================

ALTER TABLE kpis
  ADD COLUMN IF NOT EXISTS contributes_to_kpi_id UUID
    REFERENCES kpis(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kpis_contributes_to
  ON kpis (contributes_to_kpi_id)
  WHERE contributes_to_kpi_id IS NOT NULL;

COMMENT ON COLUMN kpis.contributes_to_kpi_id IS
  'この指標が寄与する上位アウトカム指標（短期→中間→長期の連鎖）';

-- indicator_type の語彙を評価側（outcome_intermediate）に揃える。
-- 旧値 outcome_mid も残して既存行を壊さない。
ALTER TABLE kpis
  DROP CONSTRAINT IF EXISTS kpis_indicator_type_check;

ALTER TABLE kpis
  ADD CONSTRAINT kpis_indicator_type_check
    CHECK (indicator_type IN (
      'process',
      'outcome_initial',
      'outcome_mid',             -- 旧称（後方互換）
      'outcome_intermediate',    -- 評価側と統一した新称
      'outcome_long',
      'efficiency'
    ));
