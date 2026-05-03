-- 比較基準値テーブル
CREATE TABLE benchmark_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id UUID NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT,
  year INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- 政策改善提案テーブル
CREATE TABLE policy_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  suggestion_type TEXT NOT NULL
    CHECK (suggestion_type IN (
      'kpi_adjustment',
      'evidence_gap',
      'schedule_risk',
      'efficiency',
      'best_practice'
    )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),
  ai_generated BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- レポートテーブル
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  municipality_id UUID REFERENCES municipalities(id),
  report_type TEXT NOT NULL
    CHECK (report_type IN (
      'council',
      'public',
      'evaluation',
      'annual'
    )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start DATE,
  period_end DATE
);
