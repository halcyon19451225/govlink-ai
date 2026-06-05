-- ================================================================
-- 020_gap_kpi_link.sql
-- gap_analyses テーブルに kpi_id カラムを追加（汎用化）
-- ================================================================

ALTER TABLE gap_analyses
  ADD COLUMN IF NOT EXISTS kpi_id UUID REFERENCES kpis(id) ON DELETE CASCADE;

-- 既存データのクリア（必要に応じてコメントを外して実行）
-- DELETE FROM gap_analyses;
-- または特定プロジェクトのみクリア:
-- DELETE FROM gap_analyses WHERE project_id = '対象プロジェクトのUUID';
