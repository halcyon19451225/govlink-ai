# Phase 1: DBスキーマ実装（既存スキーマとの統合）

docs/MIGRATION_POLICY.md と docs/SPEC.md を参照すること。
Phase 0の確認結果が前提。絶対に「聖域」（認証・ルーティング・テーマ・AWS設定）には触れないこと。

## 実施事項

### Step 1-A: 既存テーブルをSPEC.mdスキーマに向けて拡張（ALTER TABLE）

`logic_models` テーブルが存在する場合、DROPせずに以下のALTERを実行する:

```sql
ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS issue_hypothesis_id UUID,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS version INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','reviewed','approved')),
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS basic_goal TEXT,
  ADD COLUMN IF NOT EXISTS basic_ideology TEXT,
  ADD COLUMN IF NOT EXISTS current_status JSONB,
  ADD COLUMN IF NOT EXISTS problem TEXT,
  ADD COLUMN IF NOT EXISTS challenge TEXT,
  ADD COLUMN IF NOT EXISTS root_cause TEXT,
  ADD COLUMN IF NOT EXISTS major_policy TEXT,
  ADD COLUMN IF NOT EXISTS initial_outcomes JSONB,
  ADD COLUMN IF NOT EXISTS intermediate_outcomes JSONB,
  ADD COLUMN IF NOT EXISTS evidence JSONB,
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_theory_check TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 既存データの移行: outputs→outputs(JSONB化), outcomes→intermediate_outcomes
UPDATE logic_models
  SET intermediate_outcomes = to_jsonb(outcomes),
      name = 'ロジックモデル（移行データ）',
      status = 'draft'
  WHERE intermediate_outcomes IS NULL AND outcomes IS NOT NULL;
```

`projects` テーブルに新フィールドを追加する:

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'kaigo_hoken',
  ADD COLUMN IF NOT EXISTS template_id UUID,
  ADD COLUMN IF NOT EXISTS plan_start_date DATE,
  ADD COLUMN IF NOT EXISTS plan_end_date DATE;
```

### Step 1-B: 完全新規テーブルの作成

docs/SPEC.md の `006_care_plan_suite.sql` から、
以下のテーブルのみを新規作成する（既存テーブルと重複しないもの）:

- `plan_modules`（モジュールレジストリ）と INSERT データ
- `plan_templates`（テンプレート）
- `pdca_cycle_defs`（PDCAサイクル定義）
- `pdca_checkpoint_defs`（チェックポイント定義）
- `project_module_configs`（プロジェクトモジュール設定）
- `project_pdca_checkpoints`（チェックポイントインスタンス）
- `gap_analyses`（ギャップ分析）
- `issue_hypotheses`（課題仮説）
- `program_evaluations`（プログラム評価）← 新規テーブルとして作成
- `cost_efficiency_records`（コスト効率）
- `service_volume_plans`（サービス見込量）
- `self_evaluation_sheets` と `self_evaluation_entries`（自己評価シート）
- `dataset_definitions`（データセット定義）と INSERT データ14件
- `project_datasets`（プロジェクトデータセット）
- `module_artifacts`（成果物レジストリ）
- `statistical_analyses`（統計分析結果）
- `module_incompatibility_rules`（非互換ルール）と INSERT データ

### Step 1-C: 連携カラムの追加

```sql
-- エビデンスとの連携
ALTER TABLE module_artifacts
  ADD COLUMN IF NOT EXISTS evidence_id UUID REFERENCES evidences(id);

-- KPIとの連携
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS kpi_ids UUID[] DEFAULT ARRAY[]::uuid[];
```

### Step 1-D: システムテンプレートの登録

docs/SPEC.md の `007_system_templates.sql` を実行する（テンプレート3種 + チェックポイント定義）。

## 完了確認

```sql
-- 新規テーブルが作成されている
SELECT COUNT(*) FROM plan_modules;       -- 8件
SELECT COUNT(*) FROM plan_templates;     -- 3件
SELECT COUNT(*) FROM dataset_definitions; -- 14件

-- 既存テーブルが拡張されている（既存データは保持）
SELECT COUNT(*) FROM logic_models;        -- 既存件数が変わらない
\d logic_models                           -- 新フィールドが追加されている
\d projects                               -- plan_type等が追加されている

-- 既存データが失われていない
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM kpis;
```

## 実施しないこと

UIの変更はしない。既存ページは一切触れない。
