-- ============================================================
-- 010_care_plan_suite.sql — GovLink care plan suite 基盤
-- MIGRATION_POLICY.md の移行原則に従い実施
-- ============================================================

-- ================================================================
-- Step 1: kpis.indicator_type の確認・追加
-- APIコードが参照しているが既存マイグレーションに定義なし
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kpis' AND column_name = 'indicator_type'
  ) THEN
    ALTER TABLE kpis
      ADD COLUMN indicator_type TEXT NOT NULL DEFAULT 'process'
        CHECK (indicator_type IN (
          'process','outcome_initial','outcome_mid','outcome_long','efficiency'
        ));
    RAISE NOTICE 'kpis.indicator_type を追加しました';
  ELSE
    RAISE NOTICE 'kpis.indicator_type はすでに存在します（スキップ）';
  END IF;
END $$;

-- ================================================================
-- Step 2: logic_models の拡張（MIGRATION_POLICY.md: DROP不要）
-- 既存: inputs, activities, outputs, outcomes → そのまま保持
-- 新規カラムを追加し既存データを移行
-- ================================================================
ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS issue_hypothesis_id  UUID,
  ADD COLUMN IF NOT EXISTS name                 TEXT,
  ADD COLUMN IF NOT EXISTS version              INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status               TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS purpose              TEXT,
  ADD COLUMN IF NOT EXISTS basic_goal           TEXT,
  ADD COLUMN IF NOT EXISTS basic_ideology       TEXT,
  ADD COLUMN IF NOT EXISTS current_status       JSONB,
  ADD COLUMN IF NOT EXISTS problem              TEXT,
  ADD COLUMN IF NOT EXISTS challenge            TEXT,
  ADD COLUMN IF NOT EXISTS root_cause           TEXT,
  ADD COLUMN IF NOT EXISTS major_policy         TEXT,
  ADD COLUMN IF NOT EXISTS initial_outcomes     JSONB,
  ADD COLUMN IF NOT EXISTS intermediate_outcomes JSONB,
  ADD COLUMN IF NOT EXISTS evidence             JSONB,
  ADD COLUMN IF NOT EXISTS ai_generated         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_theory_check      TEXT;

-- status CHECK 制約（冪等）
ALTER TABLE logic_models
  DROP CONSTRAINT IF EXISTS logic_models_status_check;
ALTER TABLE logic_models
  ADD CONSTRAINT logic_models_status_check
    CHECK (status IN ('draft','reviewed','approved'));

-- 既存データ移行: 旧 outcomes → intermediate_outcomes、name を補完
UPDATE logic_models
  SET intermediate_outcomes = outcomes,
      name = 'ロジックモデル（移行データ）',
      status = 'draft'
  WHERE intermediate_outcomes IS NULL AND outcomes IS NOT NULL;

-- ================================================================
-- Step 3: projects テーブルに plan_type を追加
-- （template_id/plan_start_date/plan_end_date/is_composite は006で追加済み）
-- ================================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'kaigo_hoken';

-- ================================================================
-- Step 4: plan_templates の移行
-- 旧スキーマ（category-based）→ plan_templates_legacy にリネーム
-- 新スキーマ（plan_type + module_config JSONB）を作成
-- ================================================================

-- 外部キー制約を削除（リネーム後に新テーブルへのFKを設定するため）
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_template_id_fkey;
ALTER TABLE template_kpi_suggestions
  DROP CONSTRAINT IF EXISTS template_kpi_suggestions_template_id_fkey;
ALTER TABLE template_evaluation_schedules
  DROP CONSTRAINT IF EXISTS template_evaluation_schedules_template_id_fkey;

-- 旧テーブルをレガシーにリネーム（データ保全）
ALTER TABLE plan_templates RENAME TO plan_templates_legacy;

-- 新スキーマで plan_templates を作成
CREATE TABLE plan_templates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  plan_type        TEXT        NOT NULL,
  description      TEXT,
  plan_period_years INT        NOT NULL DEFAULT 3,
  module_config    JSONB       NOT NULL DEFAULT '{}',
  is_system_template BOOLEAN  NOT NULL DEFAULT false,
  is_public        BOOLEAN     NOT NULL DEFAULT false,
  created_by       UUID,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- Step 5: モジュールレジストリ
-- ================================================================
CREATE TABLE plan_modules (
  id           TEXT  PRIMARY KEY,
  display_name TEXT  NOT NULL,
  description  TEXT,
  plan_types   TEXT[] NOT NULL,
  depends_on   TEXT[] DEFAULT ARRAY[]::text[],
  sort_order   INT   DEFAULT 0
);

INSERT INTO plan_modules VALUES
  ('dataset_manager',    'データセット管理',
   'AI分析に必要なデータセットのアップロード・管理',
   ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],
   ARRAY[]::text[], 1),
  ('gap_analysis',       '地域分析・ギャップ分析',
   '基本目標指標の現状値収集とギャップの可視化',
   ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin'],
   ARRAY['dataset_manager'], 2),
  ('issue_hypothesis',   '課題仮説設定',
   'SWOT分析・真因分析・課題仮説シートの作成',
   ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],
   ARRAY['gap_analysis'], 3),
  ('logic_model',        'ロジックモデル作成',
   '目的・基本目標・課題・施策の論理構造を可視化',
   ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],
   ARRAY['issue_hypothesis'], 4),
  ('program_evaluation', 'プログラム評価（5階層）',
   '5階層評価（ニーズ・セオリー・プロセス・アウトカム・コスト）',
   ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],
   ARRAY['logic_model'], 5),
  ('cost_efficiency',    'コストと効率性の評価',
   '投入金額と給付費削減見込み額のコスト比率算出',
   ARRAY['kaigo_hoken'],
   ARRAY['program_evaluation'], 6),
  ('service_volume',     'サービス見込量管理',
   'サービス別計画値・実績値の比較と乖離要因分析',
   ARRAY['kaigo_hoken'],
   ARRAY['dataset_manager'], 7),
  ('self_evaluation',    '自己評価シート',
   '取組と目標の年次自己評価・進捗管理',
   ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],
   ARRAY['program_evaluation'], 8);

-- ================================================================
-- Step 6: PDCAサイクル定義・チェックポイント定義
-- ================================================================
CREATE TABLE pdca_cycle_defs (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID  NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
  name        TEXT  NOT NULL,
  cycle_type  TEXT  NOT NULL
    CHECK (cycle_type IN ('planning_phase','annual_june','annual_october','triennial','custom')),
  phase       TEXT  NOT NULL CHECK (phase IN ('P','D','C','A','P-D','C-A')),
  recurrence  TEXT  NOT NULL DEFAULT 'once'
    CHECK (recurrence IN ('once','yearly','triennial')),
  description TEXT,
  sort_order  INT   DEFAULT 0
);

CREATE TABLE pdca_checkpoint_defs (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id         UUID  NOT NULL REFERENCES pdca_cycle_defs(id) ON DELETE CASCADE,
  name             TEXT  NOT NULL,
  description      TEXT,
  plan_year        INT   NOT NULL,
  month_start      INT   NOT NULL CHECK (month_start BETWEEN 1 AND 12),
  month_end        INT   CHECK (month_end BETWEEN 1 AND 12),
  evaluation_tiers TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  modules_involved TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  qc_step          TEXT,
  instructions     TEXT,
  sort_order       INT   DEFAULT 0
);

-- ================================================================
-- Step 7: プロジェクト実行テーブル群
-- ================================================================

-- プロジェクトモジュール設定
CREATE TABLE project_module_configs (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id  TEXT    NOT NULL REFERENCES plan_modules(id),
  is_enabled BOOLEAN DEFAULT true,
  config     JSONB   DEFAULT '{}',
  enabled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, module_id)
);

-- プロジェクトPDCAチェックポイント（実際の日付が確定したインスタンス）
CREATE TABLE project_pdca_checkpoints (
  id                    UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_def_id     UUID  REFERENCES pdca_checkpoint_defs(id),
  name                  TEXT  NOT NULL,
  cycle_type            TEXT  NOT NULL,
  phase                 TEXT  NOT NULL CHECK (phase IN ('P','D','C','A','P-D','C-A')),
  description           TEXT,
  evaluation_tiers      TEXT[] DEFAULT ARRAY[]::text[],
  modules_involved      TEXT[] DEFAULT ARRAY[]::text[],
  qc_step               TEXT,
  instructions          TEXT,
  scheduled_date        DATE,
  scheduled_date_end    DATE,
  status                TEXT  NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming','in_progress','completed','skipped')),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  linked_evaluation_ids UUID[] DEFAULT ARRAY[]::uuid[],
  completion_notes      TEXT,
  sort_order            INT   DEFAULT 0
);

-- ================================================================
-- Step 8: 分析・評価テーブル群
-- ================================================================

-- ギャップ分析
CREATE TABLE gap_analyses (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id       UUID    REFERENCES project_pdca_checkpoints(id),
  indicator_name      TEXT    NOT NULL,
  indicator_unit      TEXT,
  data_source         TEXT    NOT NULL,
  current_value       NUMERIC,
  current_year        INT,
  target_value        NUMERIC,
  target_basis        TEXT,
  gap_value           NUMERIC GENERATED ALWAYS AS (target_value - current_value) STORED,
  affected_population NUMERIC,
  trend               TEXT    CHECK (trend IN ('improving','worsening','stable','unknown')),
  priority_score      INT,
  notes               TEXT,
  ai_analysis         TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 課題仮説
CREATE TABLE issue_hypotheses (
  id                 UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id      UUID  REFERENCES project_pdca_checkpoints(id),
  gap_analysis_id    UUID  REFERENCES gap_analyses(id),
  title              TEXT  NOT NULL,
  description        TEXT  NOT NULL,
  root_cause         TEXT,
  root_cause_tree    JSONB,
  priority_rank      INT,
  smart_check        JSONB,
  evidence_sources   TEXT[],
  proposed_measures  TEXT[],
  status             TEXT  DEFAULT 'draft'
    CHECK (status IN ('draft','verified','adopted','rejected')),
  ai_generated       BOOLEAN DEFAULT false,
  verification_notes TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- プログラム評価（5階層）
CREATE TABLE program_evaluations (
  id                 UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id      UUID  NOT NULL REFERENCES project_pdca_checkpoints(id),
  logic_model_id     UUID  REFERENCES logic_models(id),
  evaluation_tier    TEXT  NOT NULL
    CHECK (evaluation_tier IN (
      'needs','theory','process','outcome_initial','outcome_intermediate','cost_efficiency'
    )),
  fiscal_year        INT   NOT NULL,
  status             TEXT  DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed')),
  result             TEXT,
  achievement_rate   NUMERIC,
  findings           TEXT,
  success_factors    TEXT,
  barrier_factors    TEXT,
  improvement_actions TEXT,
  next_steps         TEXT,
  flow_decision_path JSONB,
  evaluated_by       TEXT,
  evaluated_at       TIMESTAMPTZ,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  ai_commentary      TEXT,
  kpi_ids            UUID[] DEFAULT ARRAY[]::uuid[],
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- コストと効率性の評価
CREATE TABLE cost_efficiency_records (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id        UUID    REFERENCES project_pdca_checkpoints(id),
  program_evaluation_id UUID   REFERENCES program_evaluations(id),
  major_policy_name    TEXT    NOT NULL,
  fiscal_year          INT     NOT NULL,
  evaluation_type      TEXT    NOT NULL CHECK (evaluation_type IN ('ex_ante','ex_post')),
  labor_cost           NUMERIC DEFAULT 0,
  operating_cost       NUMERIC DEFAULT 0,
  total_investment     NUMERIC GENERATED ALWAYS AS (labor_cost + operating_cost) STORED,
  insured_n            INT,
  utilization_rate     NUMERIC,
  unit_benefit         NUMERIC,
  delta_cert_rate      NUMERIC DEFAULT 0,
  reduction_a          NUMERIC DEFAULT 0,
  delta_recep_rate     NUMERIC DEFAULT 0,
  reduction_b          NUMERIC DEFAULT 0,
  recipient_count      INT     DEFAULT 0,
  delta_unit_benefit   NUMERIC DEFAULT 0,
  reduction_c          NUMERIC DEFAULT 0,
  total_reduction      NUMERIC GENERATED ALWAYS AS (reduction_a + reduction_b + reduction_c) STORED,
  cost_ratio           NUMERIC GENERATED ALWAYS AS (
    CASE WHEN (reduction_a + reduction_b + reduction_c) > 0
    THEN (labor_cost + operating_cost) / (reduction_a + reduction_b + reduction_c) * 100
    ELSE NULL END
  ) STORED,
  actual_total_reduction NUMERIC,
  actual_cost_ratio      NUMERIC,
  evidence_basis         TEXT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- サービス見込量管理
CREATE TABLE service_volume_plans (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id         UUID    REFERENCES project_pdca_checkpoints(id),
  service_name          TEXT    NOT NULL,
  service_category      TEXT,
  fiscal_year           INT     NOT NULL,
  planned_cert_rate     NUMERIC,
  planned_recep_rate    NUMERIC,
  planned_unit_benefit  NUMERIC,
  planned_users         INT,
  planned_benefit       NUMERIC,
  actual_cert_rate      NUMERIC,
  actual_recep_rate     NUMERIC,
  actual_unit_benefit   NUMERIC,
  actual_users          INT,
  actual_benefit        NUMERIC,
  cert_deviation_pct    NUMERIC GENERATED ALWAYS AS (
    CASE WHEN planned_cert_rate > 0
    THEN (actual_cert_rate - planned_cert_rate) / planned_cert_rate * 100
    ELSE NULL END
  ) STORED,
  deviation_analysis    JSONB,
  deviation_notes       TEXT,
  ai_deviation_analysis TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, service_name, fiscal_year)
);

-- 自己評価シート
CREATE TABLE self_evaluation_sheets (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id         UUID    REFERENCES project_pdca_checkpoints(id),
  program_evaluation_id UUID    REFERENCES program_evaluations(id),
  title                 TEXT    NOT NULL,
  has_interim_review    BOOLEAN DEFAULT true,
  background            TEXT,
  activities            TEXT,
  target_and_metrics    TEXT,
  evaluation_method     TEXT,
  evaluation_timing     TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE self_evaluation_entries (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id                 UUID NOT NULL REFERENCES self_evaluation_sheets(id) ON DELETE CASCADE,
  fiscal_year              INT  NOT NULL,
  period_type              TEXT NOT NULL CHECK (period_type IN ('interim','final')),
  actual_activities        TEXT,
  rating                   TEXT CHECK (rating IN ('achieved','mostly_achieved','not_achieved','ongoing')),
  rating_label             TEXT,
  achievement_analysis     TEXT,
  activity_appropriateness TEXT,
  improvement_status       TEXT,
  ideal_gap                TEXT,
  challenges               TEXT,
  countermeasures          TEXT,
  next_year_changes        TEXT,
  prefecture_support_request TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sheet_id, fiscal_year, period_type)
);

-- ================================================================
-- Step 9: データセット管理
-- ================================================================
CREATE TABLE dataset_definitions (
  id                 TEXT  PRIMARY KEY,
  display_name       TEXT  NOT NULL,
  description        TEXT  NOT NULL,
  data_format        TEXT  NOT NULL,
  required_columns   TEXT[],
  plan_types         TEXT[] NOT NULL,
  used_by_modules    TEXT[] NOT NULL,
  ai_analysis_types  TEXT[],
  data_sensitivity   TEXT  DEFAULT 'internal',
  update_frequency   TEXT,
  source_description TEXT
);

CREATE TABLE project_datasets (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_def_id   TEXT    NOT NULL REFERENCES dataset_definitions(id),
  file_name        TEXT    NOT NULL,
  s3_key           TEXT    NOT NULL,
  file_size_bytes  BIGINT,
  uploaded_by      UUID,
  uploaded_at      TIMESTAMPTZ DEFAULT NOW(),
  survey_year      INT,
  status           TEXT    DEFAULT 'pending'
    CHECK (status IN ('pending','validated','error')),
  validation_errors JSONB,
  row_count        INT,
  metadata         JSONB   DEFAULT '{}'
);

-- ================================================================
-- Step 10: 成果物レジストリ・非互換性ルール・統計分析
-- ================================================================

-- 成果物レジストリ（リネージ管理）
CREATE TABLE module_artifacts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id            UUID REFERENCES project_pdca_checkpoints(id),
  module_id                TEXT NOT NULL REFERENCES plan_modules(id),
  artifact_type            TEXT NOT NULL,
  artifact_record_id       UUID NOT NULL,
  source_artifact_ids      UUID[] DEFAULT ARRAY[]::uuid[],
  source_datasets_snapshot JSONB DEFAULT '{}',
  derivation_note          TEXT,
  evidence_id              UUID REFERENCES evidences(id),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- モジュール非互換性ルール
CREATE TABLE module_incompatibility_rules (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_a                TEXT NOT NULL REFERENCES plan_modules(id),
  module_b                TEXT NOT NULL REFERENCES plan_modules(id),
  incompatibility_type    TEXT NOT NULL
    CHECK (incompatibility_type IN (
      'missing_intermediary','no_causal_path','plan_type_mismatch','circular'
    )),
  is_blocking             BOOLEAN NOT NULL DEFAULT false,
  warning_message         TEXT    NOT NULL,
  required_intermediaries TEXT[]  DEFAULT ARRAY[]::text[],
  UNIQUE(module_a, module_b)
);

INSERT INTO module_incompatibility_rules VALUES
(gen_random_uuid(),'gap_analysis','program_evaluation','missing_intermediary',false,
 '地域分析・ギャップ分析の成果物からプログラム評価を直接実施することはできません。ロジックモデルモジュールで評価対象となる成果指標・取組を定義してください。',
 ARRAY['logic_model']),
(gen_random_uuid(),'gap_analysis','cost_efficiency','missing_intermediary',false,
 'ギャップ分析の結果からコストと効率性の評価を直接実施することはできません。課題仮説設定・ロジックモデルを通じて投入金額と施策効果を定義してください。',
 ARRAY['issue_hypothesis','logic_model']),
(gen_random_uuid(),'gap_analysis','self_evaluation','missing_intermediary',false,
 'ギャップ分析から直接自己評価シートを作成することはできません。ロジックモデルモジュールで具体的な取組と目標を定義してください。',
 ARRAY['logic_model']),
(gen_random_uuid(),'issue_hypothesis','program_evaluation','missing_intermediary',false,
 '課題仮説設定の成果物からプログラム評価を直接実施することはできません。ロジックモデルモジュールで取組・成果指標を設計してください。',
 ARRAY['logic_model']),
(gen_random_uuid(),'issue_hypothesis','cost_efficiency','missing_intermediary',false,
 '課題仮説からコストと効率性の評価を直接実施することはできません。ロジックモデルで投入量と期待される成果（3指標への効果）を定義してください。',
 ARRAY['logic_model']),
(gen_random_uuid(),'cost_efficiency','service_volume','no_causal_path',false,
 'コストと効率性の評価とサービス見込量管理は並列した評価活動であり、直接の因果関係はありません。',
 ARRAY[]::text[]),
(gen_random_uuid(),'cost_efficiency','self_evaluation','no_causal_path',false,
 'コストと効率性の評価と自己評価シートは並列した評価活動であり、直接の因果関係はありません。',
 ARRAY[]::text[]),
(gen_random_uuid(),'service_volume','self_evaluation','no_causal_path',false,
 'サービス見込量管理と自己評価シートは並列した評価活動であり、直接の因果関係はありません。',
 ARRAY[]::text[]);

-- 統計分析結果
CREATE TABLE statistical_analyses (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id       UUID    REFERENCES module_artifacts(id) ON DELETE CASCADE,
  module_id         TEXT    NOT NULL,
  analysis_type     TEXT    NOT NULL,
  indicator_name    TEXT,
  input_data        JSONB   NOT NULL,
  parameters        JSONB   DEFAULT '{}',
  results           JSONB   NOT NULL,
  calculation_steps JSONB   NOT NULL,
  interpretation    TEXT,
  caveats           TEXT,
  is_ai_generated   BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- Step 11: インデックス
-- ================================================================
CREATE INDEX idx_project_module_configs_project    ON project_module_configs(project_id);
CREATE INDEX idx_project_pdca_checkpoints_project  ON project_pdca_checkpoints(project_id);
CREATE INDEX idx_project_pdca_checkpoints_status   ON project_pdca_checkpoints(status);
CREATE INDEX idx_project_pdca_checkpoints_scheduled ON project_pdca_checkpoints(scheduled_date);
CREATE INDEX idx_gap_analyses_project              ON gap_analyses(project_id);
CREATE INDEX idx_issue_hypotheses_project          ON issue_hypotheses(project_id);
CREATE INDEX idx_logic_models_project              ON logic_models(project_id);
CREATE INDEX idx_program_evaluations_project       ON program_evaluations(project_id);
CREATE INDEX idx_program_evaluations_checkpoint    ON program_evaluations(checkpoint_id);
CREATE INDEX idx_project_datasets_project          ON project_datasets(project_id);
CREATE INDEX idx_module_artifacts_project          ON module_artifacts(project_id);
CREATE INDEX idx_module_artifacts_module           ON module_artifacts(module_id);
CREATE INDEX idx_statistical_analyses_project      ON statistical_analyses(project_id);
CREATE INDEX idx_statistical_analyses_artifact     ON statistical_analyses(artifact_id);
