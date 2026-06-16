-- ================================================================
-- 022_asis_kpi_link.sql
-- 現状整理（As-Is分析）とKPIの紐付けを保証する。
-- kpi_id カラムは 021 で作成済みだが、冪等性のため IF NOT EXISTS で再宣言。
-- (project_id, kpi_id) に部分ユニークインデックスを張り、
-- 1つのKPIにつき現状整理は1件のみとする（find-or-create のため）。
-- ================================================================

ALTER TABLE asis_analyses
  ADD COLUMN IF NOT EXISTS kpi_id UUID REFERENCES kpis(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_asis_project_kpi
  ON asis_analyses(project_id, kpi_id) WHERE kpi_id IS NOT NULL;
