-- 計画テンプレート（ひな形）
CREATE TABLE plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN (
      'elderly_care','disability','child','health',
      'urban','disaster','environment','education','other'
    )),
  legal_basis TEXT,
  plan_period_years INTEGER,
  is_composite BOOLEAN DEFAULT false,
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  shared_by_municipality_id UUID REFERENCES municipalities(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- テンプレートの推奨KPI（参考・必須ではない）
CREATE TABLE template_kpi_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL
    REFERENCES plan_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  unit TEXT,
  indicator_type TEXT NOT NULL DEFAULT 'process'
    CHECK (indicator_type IN (
      'process','outcome_initial','outcome_mid',
      'outcome_long','efficiency'
    )),
  evaluation_timing TEXT,
  evaluation_year INTEGER,
  description TEXT,
  sort_order INTEGER DEFAULT 0
);

-- テンプレートの推奨評価スケジュール
CREATE TABLE template_evaluation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL
    REFERENCES plan_templates(id) ON DELETE CASCADE,
  evaluation_type TEXT NOT NULL
    CHECK (evaluation_type IN (
      'process','outcome','efficiency','needs','theory'
    )),
  timing_year INTEGER NOT NULL,
  timing_period TEXT NOT NULL
    CHECK (timing_period IN ('first_half','second_half','year_end')),
  description TEXT
);

-- 計画の基本目標（自治体が自由に設定）
CREATE TABLE project_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  goal_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- projectsテーブルにテンプレート参照・計画期間を追加
ALTER TABLE projects
  ADD COLUMN template_id UUID REFERENCES plan_templates(id),
  ADD COLUMN plan_start_date DATE,
  ADD COLUMN plan_end_date DATE,
  ADD COLUMN is_composite BOOLEAN DEFAULT false;

-- kpisテーブルに基本目標との紐づけ・前期実績を追加
ALTER TABLE kpis
  ADD COLUMN goal_id UUID REFERENCES project_goals(id),
  ADD COLUMN previous_value NUMERIC,
  ADD COLUMN previous_target NUMERIC;

-- ユーザーロール管理
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id UUID NOT NULL
    REFERENCES municipalities(id) ON DELETE CASCADE,
  cognito_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin','manager','member','viewer')),
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(municipality_id, cognito_user_id)
);

-- KPI報告（各担当者から）
CREATE TABLE kpi_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id UUID NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reported_by TEXT NOT NULL,
  reported_by_name TEXT,
  reported_value NUMERIC NOT NULL,
  report_period TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
