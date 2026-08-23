-- ================================================================
-- 028_issue_dialogue.sql
-- 対話型の課題仮説設定（QCストーリー / JIS Q 9024:2003 準拠）
--
--   現状整理（asis_analyses）の SWOT・クロス分析を起点に
--     problems   問題の洗い出し   … 目標と現実のギャップ＝「問題」を列挙
--     selection  課題の選別       … 重点指向（影響度/関与可能性/緊急性）
--     rootcause  真因分析         … 特性要因図（大骨=PESTLE/7S）＋なぜなぜ分析
--     hypothesis 仮説の定式化     … 検証可能な課題仮説文＋エビデンス
--   の順に対話で進める。
--
--   確定した仮説は既存の issue_hypotheses へ書き出す（commit API）。
--   本テーブルは「過程」を、issue_hypotheses は「成果物」を保持する。
--
-- JSONB フィールドの中身の構造はアプリ側（lib/issue/types.ts）で
-- 対応するため、構造変更時のマイグレーションは不要。
-- ================================================================

CREATE TABLE IF NOT EXISTS issue_dialogues (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_id           UUID        REFERENCES kpis(id) ON DELETE CASCADE,
  -- 出所（リネージ）: どのギャップ分析・どの現状整理を根拠にしたか
  gap_analysis_id  UUID        REFERENCES gap_analyses(id) ON DELETE SET NULL,
  asis_analysis_id UUID        REFERENCES asis_analyses(id) ON DELETE SET NULL,
  title            TEXT        NOT NULL DEFAULT '課題仮説設定',
  status           TEXT        NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress', 'completed')),
  current_step     TEXT        NOT NULL DEFAULT 'problems'
                     CHECK (current_step IN ('problems', 'selection', 'rootcause', 'hypothesis', 'done')),
  -- 対話履歴: [{ role, content, step?, suggestions? }]
  messages         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 問題候補: [{ id, text, origin: 'weakness'|'threat'|'wo'|'wt'|..., source_text?, factor? }]
  problems         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 課題の選別: [{ problem_id, impact, controllability, urgency, score, selected, reason }]
  selection        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 真因分析: [{ problem_id, bones: [{factor, causes[]}], whys: [{level, question, answer}], root_cause }]
  root_causes      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 課題仮説: [{ problem_id, title, statement, root_cause, evidence[], measures[], verification }]
  hypotheses       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- commit API で issue_hypotheses へ書き出した時刻（未書き出しは NULL）
  committed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_dialogues_project_id ON issue_dialogues (project_id);
CREATE INDEX IF NOT EXISTS idx_issue_dialogues_kpi_id     ON issue_dialogues (kpi_id);

DROP TRIGGER IF EXISTS set_updated_at_issue_dialogues ON issue_dialogues;
CREATE TRIGGER set_updated_at_issue_dialogues
    BEFORE UPDATE ON issue_dialogues
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE issue_dialogues IS
  '対話型の課題仮説設定（QCストーリー）: 問題の洗い出し→課題の選別→真因分析→仮説の定式化';

-- ================================================================
-- 既存 issue_hypotheses の不整合修正
--
-- (1) status の CHECK 制約がアプリ実装とずれていた。
--     DB:  draft / verified / adopted / rejected
--     App: draft / confirmed / rejected
--     → 「採用」ボタン（status='confirmed'）が CHECK 違反で失敗していた。
--     既存データを壊さないよう、両方を許容する上位集合に置き換える。
--
-- (2) description が NOT NULL だが、アプリの POST は説明未入力時に
--     NULL を挿入するため NOT NULL 違反になっていた。
--     → NULL 許容に変更する（表示側は既に null を許容済み）。
-- ================================================================

ALTER TABLE issue_hypotheses
  DROP CONSTRAINT IF EXISTS issue_hypotheses_status_check;

ALTER TABLE issue_hypotheses
  ADD CONSTRAINT issue_hypotheses_status_check
  CHECK (status IN ('draft', 'verified', 'confirmed', 'adopted', 'rejected'));

ALTER TABLE issue_hypotheses
  ALTER COLUMN description DROP NOT NULL;

-- 対話（過程）と仮説（成果物）を紐付ける
ALTER TABLE issue_hypotheses
  ADD COLUMN IF NOT EXISTS issue_dialogue_id UUID REFERENCES issue_dialogues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issue_hypotheses_dialogue
  ON issue_hypotheses (issue_dialogue_id);

COMMENT ON COLUMN issue_hypotheses.issue_dialogue_id IS
  'この仮説を導いた対話型課題仮説設定（issue_dialogues）への参照';
