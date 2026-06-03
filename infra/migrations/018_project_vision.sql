-- ================================================================
-- 018_project_vision.sql
-- projects テーブルにビジョンカラムを追加
-- ================================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vision TEXT;
