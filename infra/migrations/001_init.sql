-- ============================================================
-- 001_init.sql  — GovLink AI 初期スキーマ
-- 対象: Aurora Serverless v2 (PostgreSQL 15 互換)
-- ============================================================

-- 拡張機能
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- 全文検索補助（将来の検索機能用）

-- ============================================================
-- 自治体マスタ
-- ============================================================
CREATE TABLE municipalities (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,                          -- 例: 渋谷区
    slug        TEXT        NOT NULL UNIQUE,                   -- 例: shibuya-ku（URLスラグ）
    prefecture  TEXT        NOT NULL,                          -- 例: 東京都
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  municipalities             IS '自治体マスタ';
COMMENT ON COLUMN municipalities.slug        IS 'URL スラグ（英数字・ハイフンのみ）';
COMMENT ON COLUMN municipalities.prefecture  IS '都道府県名';

-- ============================================================
-- 政策プロジェクト
-- ============================================================
CREATE TYPE project_status AS ENUM (
    'draft',        -- 下書き
    'active',       -- 実施中
    'completed',    -- 完了
    'archived'      -- アーカイブ
);

CREATE TABLE projects (
    id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    municipality_id   UUID            NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
    title             TEXT            NOT NULL,
    description       TEXT            NOT NULL DEFAULT '',
    status            project_status  NOT NULL DEFAULT 'draft',
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_municipality_id ON projects (municipality_id);
CREATE INDEX idx_projects_status         ON projects (status);

COMMENT ON TABLE  projects                  IS '政策プロジェクト';
COMMENT ON COLUMN projects.municipality_id  IS '担当自治体';
COMMENT ON COLUMN projects.status           IS 'draft / active / completed / archived';

-- ============================================================
-- KPI (重要業績評価指標)
-- ============================================================
CREATE TABLE kpis (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label       TEXT        NOT NULL,      -- 例: 待機児童数
    target      NUMERIC     NOT NULL,      -- 目標値
    current     NUMERIC     NOT NULL DEFAULT 0,  -- 現在値
    unit        TEXT        NOT NULL DEFAULT '',  -- 単位: 人、円、% など
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kpis_project_id ON kpis (project_id);

COMMENT ON TABLE  kpis          IS 'プロジェクト KPI';
COMMENT ON COLUMN kpis.target   IS '達成目標値';
COMMENT ON COLUMN kpis.current  IS '現在の実績値';
COMMENT ON COLUMN kpis.unit     IS '値の単位（人・円・%など）';

-- ============================================================
-- 公開投稿（SNSフィード）
-- ============================================================
CREATE TYPE post_type AS ENUM (
    'plan',       -- 計画
    'progress',   -- 進捗報告
    'result'      -- 成果報告
);

CREATE TABLE posts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type         post_type   NOT NULL,
    body         TEXT        NOT NULL,             -- 本文（Markdown可）
    ai_summary   TEXT,                             -- Claude が生成した要約（NULL = 未生成）
    published_at TIMESTAMPTZ,                      -- NULL = 下書き / 値あり = 公開済み
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_posts_project_id   ON posts (project_id);
CREATE INDEX idx_posts_published_at ON posts (published_at DESC NULLS LAST)
    WHERE published_at IS NOT NULL;

COMMENT ON TABLE  posts               IS '公開投稿（SNS公開フィード）';
COMMENT ON COLUMN posts.type          IS 'plan / progress / result';
COMMENT ON COLUMN posts.ai_summary    IS 'Claude API が生成した要約テキスト';
COMMENT ON COLUMN posts.published_at  IS 'NULL = 下書き、値あり = 公開日時';

-- ============================================================
-- AI ロジックモデル
-- ============================================================
CREATE TABLE logic_models (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inputs       JSONB       NOT NULL DEFAULT '[]'::jsonb,     -- 投入資源
    activities   JSONB       NOT NULL DEFAULT '[]'::jsonb,     -- 活動
    outputs      JSONB       NOT NULL DEFAULT '[]'::jsonb,     -- 産出物
    outcomes     JSONB       NOT NULL DEFAULT '[]'::jsonb,     -- 成果（短期・長期）
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),           -- Claude 生成日時
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_logic_models_project_id   ON logic_models (project_id);
CREATE INDEX idx_logic_models_generated_at ON logic_models (generated_at DESC);

COMMENT ON TABLE  logic_models               IS 'AI ロジックモデル（Claude 自動生成）';
COMMENT ON COLUMN logic_models.inputs        IS '投入資源リスト (JSONB 配列)';
COMMENT ON COLUMN logic_models.activities    IS '活動リスト (JSONB 配列)';
COMMENT ON COLUMN logic_models.outputs       IS '産出物リスト (JSONB 配列)';
COMMENT ON COLUMN logic_models.outcomes      IS '成果リスト: [{term: "short"|"long", text: "..."}] (JSONB 配列)';
COMMENT ON COLUMN logic_models.generated_at  IS 'Claude API によるロジックモデル生成日時';

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 各テーブルにトリガーを設定
CREATE TRIGGER set_updated_at_municipalities
    BEFORE UPDATE ON municipalities
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_projects
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_kpis
    BEFORE UPDATE ON kpis
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_posts
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_logic_models
    BEFORE UPDATE ON logic_models
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
