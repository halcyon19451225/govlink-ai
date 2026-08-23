-- ================================================================
-- 033_improvement_dialogue_handover.sql
-- P5: 対話型AI改善提案 ＋ 次期計画への引き継ぎ
--
-- 設計: claude/coe-ca-audit.md ／ アウトカム三層評価と改善サイクル A-3・A-5
--
-- 【A-3】現行の AI改善提案（/api/ai/suggest-improvements）は
--   KPI・エビデンス・スケジュールしか見ておらず、**評価結果を読んでいない**。
--   A工程の提案なのに C工程の成果物（program_evaluations / self_evaluation_entries /
--   図6・図7の判定経路）を参照しないため、評価を踏まえた提案になっていなかった。
--   現状整理・課題仮説と同じ対話方式に作り直し、その過程を保持する。
--
-- 【A-5】計画期間評価（図7）の完了時に、次期計画へ渡すべきものを
--   ひとまとまりのパッケージとして固定する。PDCAが実際に一周するのはこの一点。
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブルのみ（既存への破壊的変更なし）。
-- ================================================================

-- ================================================================
-- 対話型AI改善提案
-- ================================================================
CREATE TABLE IF NOT EXISTS improvement_dialogues (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 起点となった評価（NULL ならプロジェクト全体の改善検討）
  program_evaluation_id UUID REFERENCES program_evaluations(id) ON DELETE SET NULL,
  title        TEXT        NOT NULL DEFAULT '改善提案',
  status       TEXT        NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'completed')),
  current_step TEXT        NOT NULL DEFAULT 'review'
                 CHECK (current_step IN ('review', 'cause', 'design', 'assign', 'done')),
  -- 対話履歴: [{ role, content, step?, suggestions? }]
  messages     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 改善案: [{ id, title, detail, root_cause, reflect_target, owner_department,
  --            due_hint, expected_effect, evidence[] }]
  proposals    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- improvement_actions へ書き出した時刻
  committed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_improvement_dialogues_project
  ON improvement_dialogues (project_id);

DROP TRIGGER IF EXISTS set_updated_at_improvement_dialogues ON improvement_dialogues;
CREATE TRIGGER set_updated_at_improvement_dialogues
    BEFORE UPDATE ON improvement_dialogues
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE improvement_dialogues IS
  '対話型AI改善提案。評価結果・自己評価・図6/図7の判定経路を読んで改善案を練る過程を保持する';

-- 起票元の対話を改善アクション側からも辿れるようにする
ALTER TABLE improvement_actions
  ADD COLUMN IF NOT EXISTS improvement_dialogue_id UUID
    REFERENCES improvement_dialogues(id) ON DELETE SET NULL;

-- 出所に 'improvement_dialogue' を追加
ALTER TABLE improvement_actions
  DROP CONSTRAINT IF EXISTS improvement_actions_source_check;

ALTER TABLE improvement_actions
  ADD CONSTRAINT improvement_actions_source_check
    CHECK (source IN (
      'program_evaluation',
      'self_evaluation',
      'ai_suggestion',
      'improvement_dialogue',  -- 対話型AI改善提案から起票
      'checkpoint',
      'manual'
    ));

-- ================================================================
-- 次期計画への引き継ぎパッケージ
-- ================================================================
CREATE TABLE IF NOT EXISTS plan_handovers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 次期計画。まだ作られていなければ NULL
  target_project_id UUID        REFERENCES projects(id) ON DELETE SET NULL,
  title             TEXT        NOT NULL DEFAULT '次期計画への引き継ぎ',
  fiscal_year       INT,
  -- 引き継ぎ内容のスナップショット。確定時点の値で固定する
  --  { carry_over_actions: [], unmet_outcomes: [], flow_decisions: [],
  --    root_causes: [], notes: string }
  package           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'finalized', 'consumed')),
  finalized_at      TIMESTAMPTZ,
  consumed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_handovers_source
  ON plan_handovers (source_project_id);
CREATE INDEX IF NOT EXISTS idx_plan_handovers_target
  ON plan_handovers (target_project_id)
  WHERE target_project_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_plan_handovers ON plan_handovers;
CREATE TRIGGER set_updated_at_plan_handovers
    BEFORE UPDATE ON plan_handovers
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE plan_handovers IS
  '計画期間評価（図7）の結果を次期計画へ渡すパッケージ。draft→finalized（確定）→consumed（次期計画が取り込み済み）';
COMMENT ON COLUMN plan_handovers.package IS
  '確定時点のスナップショット。以後、元データが変わっても引き継ぎ内容は動かない';
