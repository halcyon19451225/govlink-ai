-- ============================================================
-- 003_schedule_resources.sql — スケジュール管理・組織リソース
-- ============================================================

CREATE TABLE project_schedules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase         TEXT        NOT NULL
    CHECK (phase IN ('preparation','implementation','evaluation','reporting')),
  title         TEXT        NOT NULL,
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','done')),
  created_by_ai BOOLEAN     DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_schedules_project_id ON project_schedules (project_id);

CREATE TABLE schedule_tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id       UUID        NOT NULL REFERENCES project_schedules(id) ON DELETE CASCADE,
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT        NOT NULL,
  due_date          DATE,
  document_required BOOLEAN     DEFAULT false,
  document_deadline DATE,
  gcal_event_id     TEXT,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedule_tasks_schedule_id ON schedule_tasks (schedule_id);
CREATE INDEX idx_schedule_tasks_project_id  ON schedule_tasks (project_id);

CREATE TABLE org_resources (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id   UUID        NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
  resource_type     TEXT        NOT NULL
    CHECK (resource_type IN ('advisory_board','meeting','tool','other')),
  name              TEXT        NOT NULL,
  purpose           TEXT,
  contact           TEXT,
  schedule_pattern  TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_resources_municipality_id ON org_resources (municipality_id);
