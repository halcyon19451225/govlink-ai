-- ================================================================
-- 032_improvement_actions.sql
-- P4: 改善アクションの実体化
--
-- 設計: claude/coe-ca-audit.md ／ アウトカム三層評価と改善サイクル A-1・A-2
--
-- 【背景】
--   改善に相当するデータが6か所に分散し、いずれもテキスト列のまま行き止まりだった:
--     program_evaluations.improvement_actions / next_steps
--     self_evaluation_entries.countermeasures / next_year_changes
--     project_pdca_checkpoints.completion_notes
--     policy_suggestions.body
--   どこからもタスク化・KPI修正・ロジックモデル改訂・次サイクル生成に流れず、
--   「改善が次に還る回路」が存在しなかった。
--
-- 【方針】
--   改善を「文章」ではなく「追跡可能なオブジェクト」にする。
--   出所（どの評価から生まれたか）と反映先（どこへ効かせるか）を持たせ、
--   状態で追跡できるようにする。既存のテキスト列は残す（非破壊）。
-- ================================================================

CREATE TABLE IF NOT EXISTS improvement_actions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- ── 出所（どこから生まれた改善か）──────────────
  source        TEXT        NOT NULL DEFAULT 'manual'
                  CHECK (source IN (
                    'program_evaluation',  -- プログラム評価（図6/図7フロー）
                    'self_evaluation',     -- 自己評価シート
                    'ai_suggestion',       -- AI改善提案
                    'checkpoint',          -- PDCAチェックポイントの完了メモ
                    'manual'               -- 直接起票
                  )),
  program_evaluation_id    UUID REFERENCES program_evaluations(id)      ON DELETE SET NULL,
  self_evaluation_entry_id UUID REFERENCES self_evaluation_entries(id)  ON DELETE SET NULL,
  policy_suggestion_id     UUID REFERENCES policy_suggestions(id)       ON DELETE SET NULL,
  checkpoint_id            UUID REFERENCES project_pdca_checkpoints(id) ON DELETE SET NULL,

  -- ── 内容 ──────────────────────────────────
  title         TEXT        NOT NULL,
  detail        TEXT,
  -- 課題仮説設定で到達した真因（あれば）。改善が真因に対応しているかを見るため
  root_cause    TEXT,

  -- ── 実行 ──────────────────────────────────
  owner_department TEXT,
  owner_name       TEXT,
  due_date         DATE,
  fiscal_year      INT,
  status        TEXT        NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed', 'adopted', 'in_progress', 'done', 'dropped')),
  -- 1 が最優先。NULL は未設定
  priority      INT,

  -- ── 反映先（4系統。どこへ効かせたかを1件ずつ記録する）──
  reflect_schedule_task_id    UUID REFERENCES schedule_tasks(id)     ON DELETE SET NULL,
  reflect_kpi_id              UUID REFERENCES kpis(id)               ON DELETE SET NULL,
  reflect_logic_model_id      UUID REFERENCES logic_models(id)       ON DELETE SET NULL,
  reflect_issue_hypothesis_id UUID REFERENCES issue_hypotheses(id)   ON DELETE SET NULL,
  reflected_at    TIMESTAMPTZ,
  reflection_note TEXT,

  -- 次期計画へ引き継ぐか（計画期間評価の引き継ぎパッケージで使う）
  carry_over    BOOLEAN     NOT NULL DEFAULT false,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_improvement_actions_project
  ON improvement_actions (project_id);
CREATE INDEX IF NOT EXISTS idx_improvement_actions_status
  ON improvement_actions (project_id, status);
CREATE INDEX IF NOT EXISTS idx_improvement_actions_eval
  ON improvement_actions (program_evaluation_id)
  WHERE program_evaluation_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_improvement_actions ON improvement_actions;
CREATE TRIGGER set_updated_at_improvement_actions
    BEFORE UPDATE ON improvement_actions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE improvement_actions IS
  '改善アクション。評価・自己評価・AI提案から起票し、反映先（タスク/KPI/ロジックモデル/課題仮説）まで追跡する';
COMMENT ON COLUMN improvement_actions.carry_over IS
  '次期計画へ引き継ぐ。計画期間評価（図7）の引き継ぎパッケージに含める';

-- ================================================================
-- AI改善提案に採用フローを持たせる
--   policy_suggestions には status も採用先も無く、提案が出るだけで
--   改善アクションに繋げられなかった。
-- ================================================================

ALTER TABLE policy_suggestions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';

ALTER TABLE policy_suggestions
  DROP CONSTRAINT IF EXISTS policy_suggestions_status_check;

ALTER TABLE policy_suggestions
  ADD CONSTRAINT policy_suggestions_status_check
    CHECK (status IN ('new', 'adopted', 'dismissed'));

ALTER TABLE policy_suggestions
  ADD COLUMN IF NOT EXISTS improvement_action_id UUID
    REFERENCES improvement_actions(id) ON DELETE SET NULL;

COMMENT ON COLUMN policy_suggestions.improvement_action_id IS
  'この提案から起票した改善アクション。採用の記録';
