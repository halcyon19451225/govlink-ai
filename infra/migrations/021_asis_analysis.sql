-- ================================================================
-- 021_asis_analysis.sql
-- 対話型の現状整理（As-Is分析）テーブル
--   外部環境(PESTLE) / 内部環境(マッキンゼー7S) を対話で整理し
--   SWOT・クロス分析を生成する
-- JSONBフィールドの中身の構造（pestle / seven_s タグ付け）は
-- アプリ側で対応するため、構造変更時のマイグレーションは不要。
-- ================================================================

CREATE TABLE IF NOT EXISTS asis_analyses (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kpi_id         UUID        REFERENCES kpis(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL DEFAULT '現状整理',
  status         TEXT        NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed')),
  current_step   TEXT        NOT NULL DEFAULT 'external',
  -- 対話履歴: [{ role: 'user'|'assistant', content: string, step?: string }]
  messages       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- SWOT: {
  --   opportunities: [{ text, pestle: 'P'|'E'|'S'|'T'|'L'|'Env' }],
  --   threats:       [{ text, pestle }],
  --   strengths:     [{ text, seven_s: 'strategy'|'structure'|... }],
  --   weaknesses:    [{ text, seven_s }]
  -- }
  swot           JSONB       NOT NULL
                   DEFAULT '{"opportunities":[],"threats":[],"strengths":[],"weaknesses":[]}'::jsonb,
  -- クロス分析の4戦略: { so: [], wo: [], st: [], wt: [] }
  cross_analysis JSONB       NOT NULL
                   DEFAULT '{"so":[],"wo":[],"st":[],"wt":[]}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asis_analyses_project_id ON asis_analyses (project_id);

CREATE TRIGGER set_updated_at_asis_analyses
    BEFORE UPDATE ON asis_analyses
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE asis_analyses IS '対話型の現状整理（As-Is分析）: PESTLE/7S→SWOT→クロス分析';
