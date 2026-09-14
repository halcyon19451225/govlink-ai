-- ================================================================
-- Migration 072: 割付を凍結する（事前登録を構造で守る）
-- ================================================================
--
-- 設計: claude/coe-dataset-model.md §5-3・§11（D7）
--
-- なぜ必要か
-- ----------
--   実験の割付は**事前登録の代わり**をしている。「誰がどちらの群か」を
--   結果を見てから動かせるなら、比較の意味が消える。
--
--   066 の時点では、この規律はコメントに書いてあるだけだった:
--     「Coe が生成する割付。事前登録の代わりなので UPDATE/DELETE は**アプリ層で禁止する**」
--   アプリ層の禁止は、次に SQL を書く人が知らなければ破れる。
--   **DB 側で断る。** そうすれば、経路がいくつあっても破れない。
--
-- 何を許して、何を断るか
-- ----------
--   INSERT … 許す（割付の生成は1回だけ。同じ (cohort_id, sid) は主キーで弾かれる）
--   UPDATE … 断る（群の付け替えは、やり直しではなく改ざんになる）
--   DELETE … 断る。ただし cohort ごと消す場合（retention 到来・shred）は通す。
--            計画のデータを廃棄する道まで塞ぐと、消せないデータが残る
--
--   「やり直したい」場合は、**新しい cohort を作って割り付け直す**。
--   古い割付は残り、いつ何を決めたかが追える。

-- ────────────────────────────────────────────────────────────────
-- 1. 付け替え・削除を断る
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION experiment_assignments_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      '割付は変更できません（事前登録のため）。やり直すときは新しい対象群を作って割り付けてください'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- 対象群ごと消えるとき（廃棄・shred）だけは通す。
    -- 行だけを選んで消す＝「無かったことにする」なので断る
    IF EXISTS (SELECT 1 FROM cohorts WHERE id = OLD.cohort_id) THEN
      RAISE EXCEPTION
        '割付は削除できません（事前登録のため）。廃棄するときは対象群ごと廃棄してください'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_experiment_assignments_frozen ON experiment_assignments;
CREATE TRIGGER trg_experiment_assignments_frozen
  BEFORE UPDATE OR DELETE ON experiment_assignments
  FOR EACH ROW EXECUTE FUNCTION experiment_assignments_frozen();

-- ────────────────────────────────────────────────────────────────
-- 2. 割付の由来を残す
-- ────────────────────────────────────────────────────────────────
--   どの施策・どの設計で、誰が、いつ生成したか。
--   seed そのものは持たない（指紋だけ。設計 §5-3）。
ALTER TABLE experiment_assignments ADD COLUMN IF NOT EXISTS design TEXT;
ALTER TABLE experiment_assignments ADD COLUMN IF NOT EXISTS measure_design_id UUID
  REFERENCES measure_designs(id) ON DELETE SET NULL;
ALTER TABLE experiment_assignments ADD COLUMN IF NOT EXISTS assigned_by UUID
  REFERENCES user_roles(id) ON DELETE SET NULL;

COMMENT ON TABLE experiment_assignments IS
  'Coe が生成する割付。事前登録の代わりなので、**DB が UPDATE/DELETE を断る**（072）。やり直しは新しい対象群で';
COMMENT ON COLUMN experiment_assignments.seed_digest IS
  '割付の種の指紋。種そのものは持たない。同じ種なら同じ割付になることの確認に使う';
COMMENT ON COLUMN experiment_assignments.assigned_by IS
  '生成した担当者（user_roles.id）。AI ではない';

-- ────────────────────────────────────────────────────────────────
-- 3. 群別の値を引くための索引
-- ────────────────────────────────────────────────────────────────
--   評価時点ごとに「群 × 時点」で indicator_values を引く（設計 §10-4）
CREATE INDEX IF NOT EXISTS idx_indicator_values_arm
  ON indicator_values(indicator_id, cohort_id, arm, as_of DESC)
  WHERE cohort_id IS NOT NULL;
