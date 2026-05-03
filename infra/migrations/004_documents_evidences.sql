CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  schedule_task_id UUID REFERENCES schedule_tasks(id),
  title TEXT NOT NULL,
  document_type TEXT NOT NULL
    CHECK (document_type IN (
      'advisory_report',
      'meeting_minutes',
      'survey_report',
      'plan',
      'other'
    )),
  s3_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  ai_summary TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT
);

CREATE TABLE evidences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  output_kpi_id UUID REFERENCES kpis(id),
  outcome_kpi_id UUID REFERENCES kpis(id),
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN (
      'rct',
      'observational',
      'case_study',
      'expert',
      'statistics',
      'other'
    )),
  strength INTEGER NOT NULL DEFAULT 3
    CHECK (strength BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  document_id UUID REFERENCES documents(id),
  ai_validity TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
