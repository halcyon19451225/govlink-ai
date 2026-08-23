-- ================================================================
-- 034_logic_model_foundation.sql
-- L1: ロジックモデルの土台修復（版・三層・因果エッジの器）
--
-- 設計: claude/coe-logicmodel-audit.md
--       https://claude.ai/code/artifact/9c44e43b-2bce-4284-9fc3-9d3b227330e0
--
-- 【背景1】「承認済みにする」が必ず失敗していた（同種バグの4件目）
--   010 の CHECK は status IN ('draft','reviewed','approved') だが、
--   アプリ（logic-model/route.ts の zod・LogicModelEditorClient）は
--   'confirmed' を送るため CHECK 違反になる。
--   課題仮説の 'confirmed'（028）、プログラム評価の draft/in_review/approved（029）
--   に続く4件目。承認語彙がモジュールごとに割れているのが根因。
--   → 語彙の一致は scripts/check-status-vocab.mjs で機械検査できるようにした。
--
-- 【背景2】AI生成が logic_models を物理削除していた
--   generate-logic-model が DELETE FROM logic_models WHERE project_id → 1行 INSERT。
--   評価が参照していた軸（program_evaluations.logic_model_id）、
--   改善の反映先（improvement_actions.reflect_logic_model_id）、
--   リネージ（module_artifacts.artifact_record_id）が指す行ごと消えていた。
--   → 改訂は「その場更新」ではなく「新しい版の追加」に変える。そのための列を用意する。
--
-- 方針: MIGRATION_POLICY.md 準拠。DROP COLUMN / DROP TABLE は行わない。
--       CHECK は DROP + 再作成（冪等）。
-- ================================================================

-- ================================================================
-- Step 1: status の CHECK をアプリ実装に合わせる
--   旧値（reviewed / approved）も残して既存行を壊さない。
-- ================================================================
ALTER TABLE logic_models
  DROP CONSTRAINT IF EXISTS logic_models_status_check;

ALTER TABLE logic_models
  ADD CONSTRAINT logic_models_status_check
    CHECK (status IN (
      'draft',
      'confirmed',   -- アプリ実装の承認値
      'reviewed',    -- 010 の旧値（後方互換）
      'approved'     -- 010 の旧値（後方互換）
    ));

-- ================================================================
-- Step 2: 長期アウトカムの器と、因果エッジ
--
--   三層（短期 initial / 中間 intermediate / 長期 long）を揃える。
--   CA工程のアウトカム・スコアボードは既に三層で動いているのに、
--   計画側に長期の器が無く対応が取れていなかった。
--
--   edges は「どの要素がどの成果に効くのか」の明示。
--   現行エディタは隣接カラムの総当たりで線を引いているだけで、
--   図7フローの「中間の未達は初期アウトカムに起因するか」に答えられない。
--   形: [{ "from": "<要素id>", "to": "<要素id>", "note": "..." }]
-- ================================================================
ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS long_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS edges JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN logic_models.long_outcomes IS
  '長期アウトカム（計画期間を超える成果）。要素は { id, text, kpi_ids[] }';
COMMENT ON COLUMN logic_models.edges IS
  '因果エッジ [{ from, to, note }]。要素idどうしを結ぶ。空なら隣接列の総当たりを初期提案として表示する';

-- ================================================================
-- Step 3: 版と改訂の履歴
--
--   改訂は「その場更新」ではなく「新しい版の追加」にする。
--   評価が参照した版（program_evaluations.logic_model_id）は動かないので、
--   計画が改訂されても過去の評価の前提が書き換わらない
--   （program_evaluations.approved_snapshot_at と同じ思想）。
--
--   現行版は is_current で一意に決める。
--   これまで「最新版」の取り方が ORDER BY version DESC と
--   ORDER BY generated_at DESC の2通りに割れており、全行 version=1 のため
--   画面ごとに違う行を見得る状態だった。
-- ================================================================
ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS revised_from_id UUID
    REFERENCES logic_models(id) ON DELETE SET NULL;

ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS revision_reason TEXT;

-- A工程（改善）から計画への還り道。
-- 改善アクションの反映先に「ロジックモデルの改訂」を選ぶと、
-- その改善を理由とする新版がここから起票される。
ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS source_improvement_action_id UUID
    REFERENCES improvement_actions(id) ON DELETE SET NULL;

COMMENT ON COLUMN logic_models.is_current IS
  '現在有効な版。プロジェクトごとに1件だけ true';
COMMENT ON COLUMN logic_models.revised_from_id IS
  'どの版から派生したか。改訂の系譜';
COMMENT ON COLUMN logic_models.source_improvement_action_id IS
  'この改訂を生んだ改善アクション（A工程から計画への還り道）';

-- ================================================================
-- Step 4: 既存データのバックフィル
--   プロジェクトごとに最新1件を is_current にする。
--   version が全行1のため、generated_at → created_at → id の順で決める。
-- ================================================================
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id
           ORDER BY version DESC NULLS LAST,
                    generated_at DESC NULLS LAST,
                    created_at DESC NULLS LAST,
                    id DESC
         ) AS rn
  FROM logic_models
)
UPDATE logic_models lm
SET is_current = (ranked.rn = 1)
FROM ranked
WHERE lm.id = ranked.id;

-- 現行版はプロジェクトごとに1件だけ（部分ユニークインデックス）
CREATE UNIQUE INDEX IF NOT EXISTS uq_logic_models_current
  ON logic_models (project_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_logic_models_revised_from
  ON logic_models (revised_from_id)
  WHERE revised_from_id IS NOT NULL;

-- ================================================================
-- Step 5: 確認用ログ
-- ================================================================
DO $$
DECLARE
  n_total   INT;
  n_current INT;
  n_proj    INT;
BEGIN
  SELECT COUNT(*) INTO n_total   FROM logic_models;
  SELECT COUNT(*) INTO n_current FROM logic_models WHERE is_current;
  SELECT COUNT(DISTINCT project_id) INTO n_proj FROM logic_models;
  RAISE NOTICE 'ロジックモデル: 全% 件 / 現行版% 件 / 対象プロジェクト% 件（現行版=プロジェクト数なら正常）',
    n_total, n_current, n_proj;
END $$;
