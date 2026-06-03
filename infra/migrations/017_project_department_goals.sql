-- ================================================================
-- 017_project_department_goals.sql
-- projects テーブルに担当課名（department_name）を追加
-- ※ plan_start_date / plan_end_date は 006 で追加済み
-- ※ project_goals テーブルは 006 で作成済み
-- ================================================================

-- 担当課名（municipality.department とは別に projects 側に持つ）
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS department_name TEXT;

-- project_goals に purpose / major_policy を projects 側でなく goals に持てるよう補完
-- (projects.purpose は logic_models に誤追加されており、projects 自体には未存在のため追加)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS purpose      TEXT;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS major_policy TEXT;
