# GovLink — 地域包括ケア計画策定支援スイート 実装指示 v2

## 背景・前提（既存コードベース）

- GitHub: `halcyon19451225/govlink-ai`
- フレームワーク: Next.js 14 App Router (TypeScript)
- ホスティング: AWS Amplify (`https://main.d28aydpmu6jocl.amplifyapp.com`)
- 認証: Amazon Cognito (`ap-northeast-1_fskAOFUGZ`)
- DB: PostgreSQL（既存: `projects`, `kpis`, `evidences`, `policy_suggestions`, `benchmark_values`）
- ストレージ: AWS S3
- AI: Anthropic Claude API（`claude-sonnet-4-20250514`）
- UIテーマ: Sinap-sys ダークテーマ（背景 `#0f1117` / `#1a1d27` / アクセント `#3b82f6`）

### 設計根拠となる計画フレームワーク
- 策定方針Ⅱ①〜⑤（前期評価・地域分析・課題仮説・対照群費用・施策効果反映）
- 5階層プログラム評価（ニーズ・セオリー・プロセス・アウトカム・コストと効率性）
- QCストーリー 8ステップ（保険者の意志→現状把握→課題選定→要因分析→対策立案→実行→効果確認→D.C.継続）
- 図4 ロジックモデル（目的→基本目標→現状→問題→課題→真因→主要施策→取組→成果）
- 図5〜7 PDCAサイクル（年次2サイクル：6月評価・10月評価、3年目評価）
- 手引き（H30.7.30）サービス見込量進捗管理 3ステップ

---

## 全体設計方針

### コアコンセプト：テンプレート → プロジェクト → PDCA実行

```
テンプレート（再利用可能な設計図）
    ├── 有効モジュールの組み合わせ
    └── PDCAサイクル設計（チェックポイント付きタイムライン）
           ↓ プロジェクト作成時に「計画開始日」を与えてインスタンス化
プロジェクト（実行中の計画）
    ├── モジュール設定（テンプレートから継承・カスタマイズ可）
    └── プロジェクトPDCAチェックポイント（実際の日付が確定したスケジュール）
           ↓ 時間の経過とともに
PDCA実行（チェックポイント毎の作業）
    ├── 当該チェックポイントの評価・分析作業
    └── 次のチェックポイントへの引き継ぎ
```

### 1. モジュール型プラグインアーキテクチャ
各機能は独立した**モジュール**として実装する。モジュールは `plan_module` テーブルで定義され、テンプレートとプロジェクトに任意の組み合わせで設定できる。

### 2. テンプレートシステム
テンプレートは「モジュールの組み合わせ」と「PDCAサイクル設計」の2つから構成される再利用可能な設計図。システム提供のプリセットテンプレートと、ユーザー定義テンプレートを区別する。

### 3. PDCAサイクルの事前設計
プロジェクト開始前に「いつ、何を、どのモジュールで評価するか」を設計し、計画開始日を設定した時点で全チェックポイントの具体的な日付が自動生成される。

### 4. 計画型（planType）による汎用化
```typescript
type PlanType =
  | 'kaigo_hoken'        // 介護保険事業計画
  | 'shougai_fukushi'    // 障害福祉計画
  | 'kenko_zoshin'       // 健康増進計画
  | 'chiiki_fukushi'     // 地域福祉計画
  | 'custom';
```

---

## 実装するモジュール一覧

| # | モジュールID | 表示名 | 対応するQCステップ・工程 | 依存 |
|---|---|---|---|---|
| 1 | `dataset_manager` | データセット管理 | 全工程共通 | なし |
| 2 | `gap_analysis` | 地域分析・ギャップ分析 | QC②現状把握（Phase 2） | `dataset_manager` |
| 3 | `issue_hypothesis` | 課題仮説設定 | QC③課題選定・④要因分析（Phase 3） | `gap_analysis` |
| 4 | `logic_model` | ロジックモデル作成 | セオリー評価・ニーズ評価（Phase 3〜4） | `issue_hypothesis` |
| 5 | `program_evaluation` | プログラム評価（5階層） | QC⑦効果確認（年次PDCA・3年目） | `logic_model` |
| 6 | `cost_efficiency` | コストと効率性の評価 | 3年目評価（Phase 4・計画期間末） | `program_evaluation` |
| 7 | `service_volume` | サービス見込量管理 | QC⑦効果確認（年次PDCA） | `dataset_manager` |
| 8 | `self_evaluation` | 自己評価シート | QC⑦効果確認（年次PDCA） | `program_evaluation` |

---

## DBスキーマ

### migration 006: care_plan_suite基盤
ファイル: `infra/migrations/006_care_plan_suite.sql`

```sql
-- ================================================================
-- モジュールレジストリ
-- ================================================================
CREATE TABLE plan_modules (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  plan_types TEXT[] NOT NULL,
  depends_on TEXT[] DEFAULT ARRAY[]::text[],
  sort_order INT DEFAULT 0
);

INSERT INTO plan_modules VALUES
  ('dataset_manager','データセット管理','AI分析に必要なデータセットのアップロード・管理',
    ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],ARRAY[]::text[],1),
  ('gap_analysis','地域分析・ギャップ分析','基本目標指標の現状値収集とギャップの可視化',
    ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin'],ARRAY['dataset_manager'],2),
  ('issue_hypothesis','課題仮説設定','SWOT分析・真因分析・課題仮説シートの作成',
    ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],ARRAY['gap_analysis'],3),
  ('logic_model','ロジックモデル作成','目的・基本目標・課題・施策の論理構造を可視化',
    ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],ARRAY['issue_hypothesis'],4),
  ('program_evaluation','プログラム評価（5階層）','5階層評価（ニーズ・セオリー・プロセス・アウトカム・コスト）',
    ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],ARRAY['logic_model'],5),
  ('cost_efficiency','コストと効率性の評価','投入金額と給付費削減見込み額のコスト比率算出',
    ARRAY['kaigo_hoken'],ARRAY['program_evaluation'],6),
  ('service_volume','サービス見込量管理','サービス別計画値・実績値の比較と乖離要因分析',
    ARRAY['kaigo_hoken'],ARRAY['dataset_manager'],7),
  ('self_evaluation','自己評価シート','取組と目標の年次自己評価・進捗管理',
    ARRAY['kaigo_hoken','shougai_fukushi','kenko_zoshin','chiiki_fukushi','custom'],ARRAY['program_evaluation'],8);

-- ================================================================
-- テンプレート（再利用可能な設計図）
-- ================================================================
CREATE TABLE plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  description TEXT,
  plan_period_years INT NOT NULL DEFAULT 3,
  -- 有効モジュールとその設定
  module_config JSONB NOT NULL DEFAULT '{}',
  -- {module_id: {enabled: true, config: {}}}
  is_system_template BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- PDCAサイクル定義（テンプレートに属する）
-- ================================================================
CREATE TABLE pdca_cycle_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- 'planning_phase': 策定フェーズ (P)
  -- 'annual_june'   : 年次6月評価サイクル (C→A)
  -- 'annual_october': 年次10月評価サイクル (C→A)
  -- 'triennial'     : 3年目評価サイクル (C→A)
  -- 'custom'        : カスタム
  cycle_type TEXT NOT NULL
    CHECK (cycle_type IN ('planning_phase','annual_june','annual_october','triennial','custom')),
  phase TEXT NOT NULL CHECK (phase IN ('P','D','C','A','P-D','C-A')),
  recurrence TEXT NOT NULL DEFAULT 'once'
    CHECK (recurrence IN ('once','yearly','triennial')),
  description TEXT,
  sort_order INT DEFAULT 0
);

-- ================================================================
-- PDCAチェックポイント定義（サイクルに属する）
-- ================================================================
CREATE TABLE pdca_checkpoint_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES pdca_cycle_defs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- タイミング（計画開始日からの相対）
  -- plan_year: 0=策定年度, 1=1年目, 2=2年目, 3=3年目
  plan_year INT NOT NULL,
  month_start INT NOT NULL CHECK (month_start BETWEEN 1 AND 12),
  month_end INT CHECK (month_end BETWEEN 1 AND 12),
  -- このチェックポイントで実施する評価
  evaluation_tiers TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  -- 'needs','theory','process','outcome_initial','outcome_intermediate','cost_efficiency'
  modules_involved TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  -- QCストーリーのどのステップか
  qc_step TEXT,
  -- 'insurer_will','status_check','task_selection','factor_analysis',
  -- 'measure_planning','action','effect_check','dc_continue'
  instructions TEXT,      -- 担当者向けの実施手順メモ
  sort_order INT DEFAULT 0
);

-- ================================================================
-- プロジェクト毎のモジュール設定
-- ================================================================
CREATE TABLE project_module_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES plan_modules(id),
  is_enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  enabled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, module_id)
);

-- ================================================================
-- プロジェクトPDCAチェックポイント（実際の日付が確定したインスタンス）
-- ================================================================
CREATE TABLE project_pdca_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_def_id UUID REFERENCES pdca_checkpoint_defs(id),
  -- テンプレートからコピーされた情報（独立して編集可能）
  name TEXT NOT NULL,
  cycle_type TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('P','D','C','A','P-D','C-A')),
  description TEXT,
  evaluation_tiers TEXT[] DEFAULT ARRAY[]::text[],
  modules_involved TEXT[] DEFAULT ARRAY[]::text[],
  qc_step TEXT,
  instructions TEXT,
  -- 実際のスケジュール（plan_start_date + plan_year/month から計算）
  scheduled_date DATE,
  scheduled_date_end DATE,
  -- 実行状態
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming','in_progress','completed','skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- 当チェックポイントで作成された評価・成果物へのリンク
  linked_evaluation_ids UUID[] DEFAULT ARRAY[]::uuid[],
  completion_notes TEXT,
  sort_order INT DEFAULT 0
);

-- ================================================================
-- その他のデータテーブル（評価・分析）
-- ================================================================
CREATE TABLE gap_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  indicator_name TEXT NOT NULL,
  indicator_unit TEXT,
  data_source TEXT NOT NULL,
  current_value NUMERIC,
  current_year INT,
  target_value NUMERIC,
  target_basis TEXT,
  gap_value NUMERIC GENERATED ALWAYS AS (target_value - current_value) STORED,
  affected_population NUMERIC,
  trend TEXT CHECK (trend IN ('improving','worsening','stable','unknown')),
  priority_score INT,
  notes TEXT,
  ai_analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE issue_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  gap_analysis_id UUID REFERENCES gap_analyses(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  root_cause TEXT,
  root_cause_tree JSONB,
  priority_rank INT,
  smart_check JSONB,
  evidence_sources TEXT[],
  proposed_measures TEXT[],
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','verified','adopted','rejected')),
  ai_generated BOOLEAN DEFAULT false,
  verification_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE logic_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  issue_hypothesis_id UUID REFERENCES issue_hypotheses(id),
  name TEXT NOT NULL,
  version INT DEFAULT 1,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','reviewed','approved')),
  purpose TEXT, basic_goal TEXT, basic_ideology TEXT,
  current_status JSONB, problem TEXT, challenge TEXT, root_cause TEXT,
  major_policy TEXT, activities JSONB, inputs JSONB, outputs JSONB,
  initial_outcomes JSONB, intermediate_outcomes JSONB, evidence JSONB,
  ai_generated BOOLEAN DEFAULT false,
  ai_theory_check TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE program_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID NOT NULL REFERENCES project_pdca_checkpoints(id),
  logic_model_id UUID REFERENCES logic_models(id),
  evaluation_tier TEXT NOT NULL
    CHECK (evaluation_tier IN ('needs','theory','process','outcome_initial',
                               'outcome_intermediate','cost_efficiency')),
  fiscal_year INT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  result TEXT,
  achievement_rate NUMERIC,
  findings TEXT, success_factors TEXT, barrier_factors TEXT,
  improvement_actions TEXT, next_steps TEXT,
  flow_decision_path JSONB,
  evaluated_by TEXT, evaluated_at TIMESTAMPTZ,
  approved_by TEXT, approved_at TIMESTAMPTZ,
  ai_commentary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cost_efficiency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  program_evaluation_id UUID REFERENCES program_evaluations(id),
  major_policy_name TEXT NOT NULL,
  fiscal_year INT NOT NULL,
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN ('ex_ante','ex_post')),
  labor_cost NUMERIC DEFAULT 0, operating_cost NUMERIC DEFAULT 0,
  total_investment NUMERIC GENERATED ALWAYS AS (labor_cost + operating_cost) STORED,
  insured_n INT, utilization_rate NUMERIC, unit_benefit NUMERIC,
  delta_cert_rate NUMERIC DEFAULT 0, reduction_a NUMERIC DEFAULT 0,
  delta_recep_rate NUMERIC DEFAULT 0, reduction_b NUMERIC DEFAULT 0,
  recipient_count INT DEFAULT 0, delta_unit_benefit NUMERIC DEFAULT 0,
  reduction_c NUMERIC DEFAULT 0,
  total_reduction NUMERIC GENERATED ALWAYS AS (reduction_a+reduction_b+reduction_c) STORED,
  cost_ratio NUMERIC GENERATED ALWAYS AS (
    CASE WHEN (reduction_a+reduction_b+reduction_c)>0
    THEN (labor_cost+operating_cost)/(reduction_a+reduction_b+reduction_c)*100
    ELSE NULL END) STORED,
  actual_total_reduction NUMERIC, actual_cost_ratio NUMERIC,
  evidence_basis TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE service_volume_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  service_name TEXT NOT NULL, service_category TEXT, fiscal_year INT NOT NULL,
  planned_cert_rate NUMERIC, planned_recep_rate NUMERIC,
  planned_unit_benefit NUMERIC, planned_users INT, planned_benefit NUMERIC,
  actual_cert_rate NUMERIC, actual_recep_rate NUMERIC,
  actual_unit_benefit NUMERIC, actual_users INT, actual_benefit NUMERIC,
  cert_deviation_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN planned_cert_rate>0
    THEN (actual_cert_rate-planned_cert_rate)/planned_cert_rate*100
    ELSE NULL END) STORED,
  deviation_analysis JSONB, deviation_notes TEXT, ai_deviation_analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, service_name, fiscal_year)
);

CREATE TABLE self_evaluation_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  program_evaluation_id UUID REFERENCES program_evaluations(id),
  title TEXT NOT NULL,
  has_interim_review BOOLEAN DEFAULT true,
  background TEXT, activities TEXT, target_and_metrics TEXT,
  evaluation_method TEXT, evaluation_timing TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE self_evaluation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES self_evaluation_sheets(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('interim','final')),
  actual_activities TEXT,
  rating TEXT CHECK (rating IN ('achieved','mostly_achieved','not_achieved','ongoing')),
  rating_label TEXT,
  achievement_analysis TEXT, activity_appropriateness TEXT,
  improvement_status TEXT, ideal_gap TEXT,
  challenges TEXT, countermeasures TEXT,
  next_year_changes TEXT, prefecture_support_request TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sheet_id, fiscal_year, period_type)
);

-- Dataset tables
CREATE TABLE dataset_definitions (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  data_format TEXT NOT NULL,
  required_columns TEXT[],
  plan_types TEXT[] NOT NULL,
  used_by_modules TEXT[] NOT NULL,
  ai_analysis_types TEXT[],
  data_sensitivity TEXT DEFAULT 'internal',
  update_frequency TEXT,
  source_description TEXT
);

CREATE TABLE project_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dataset_def_id TEXT NOT NULL REFERENCES dataset_definitions(id),
  file_name TEXT NOT NULL, s3_key TEXT NOT NULL,
  file_size_bytes BIGINT, uploaded_by UUID,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  survey_year INT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','validated','error')),
  validation_errors JSONB, row_count INT, metadata JSONB DEFAULT '{}'
);

-- インデックス
CREATE INDEX idx_project_module_configs_project ON project_module_configs(project_id);
CREATE INDEX idx_project_pdca_checkpoints_project ON project_pdca_checkpoints(project_id);
CREATE INDEX idx_project_pdca_checkpoints_status ON project_pdca_checkpoints(status);
CREATE INDEX idx_project_pdca_checkpoints_scheduled ON project_pdca_checkpoints(scheduled_date);
CREATE INDEX idx_gap_analyses_project ON gap_analyses(project_id);
CREATE INDEX idx_issue_hypotheses_project ON issue_hypotheses(project_id);
CREATE INDEX idx_logic_models_project ON logic_models(project_id);
CREATE INDEX idx_program_evaluations_project ON program_evaluations(project_id);
CREATE INDEX idx_program_evaluations_checkpoint ON program_evaluations(checkpoint_id);
CREATE INDEX idx_project_datasets_project ON project_datasets(project_id);
```

### migration 007: システムテンプレートと dataset_definitions
ファイル: `infra/migrations/007_system_templates.sql`

```sql
-- ================================================================
-- データセット定義（14種）
-- ================================================================
INSERT INTO dataset_definitions VALUES
('needs_survey','介護予防・日常生活圏域ニーズ調査結果',
 '高齢者の健康状態・社会参加・主観的健康観・生きがい・閉じこもり・外出・サポートネットワーク・食事・住まいへの不安割合等',
 'csv',ARRAY['地域名','調査年','設問番号','選択肢','回答数','割合'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis','logic_model'],
 ARRAY['gap_analysis','hypothesis','needs_eval'],'confidential','3年毎',
 '市町村が実施する介護予防・日常生活圏域ニーズ調査（厚生労働省標準様式）の集計結果'),

('home_care_survey','在宅介護実態調査結果',
 '介護不安割合（認知症状への対応・外出付き添い・排泄等）を含む集計データ。要支援1・2別・要介護3以上別の集計が必要',
 'csv',ARRAY['要介護度区分','設問','回答割合'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis'],
 ARRAY['gap_analysis','hypothesis'],'confidential','3年毎',
 '市町村が実施する在宅介護実態調査（厚生労働省標準様式）の集計結果'),

('care_cert_anonymized','匿名化された要介護認定者一覧',
 '認定区分・認定日・有効期間・認知症自立度・障害自立度・性別・年齢・居住圏域を含む',
 'csv',ARRAY['匿名ID','認定区分','認定年月','認知症自立度','障害自立度','性別','年齢','圏域'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis','cost_efficiency'],
 ARRAY['gap_analysis','hypothesis','cost_calc'],'confidential','毎年',
 '介護保険システムから出力する認定者一覧（匿名化処理済み）'),

('care_insurance_report','介護保険事業状況報告データ',
 '要介護認定率（要介護度別）・受給率・受給者1人当たり給付費・第1号被保険者数等の時系列データ',
 'csv',ARRAY['年度','月','第1号被保険者数','認定者数','認定率','受給者数','受給率','給付費'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','service_volume','cost_efficiency'],
 ARRAY['gap_analysis','cost_calc','service_volume'],'internal','毎年',
 '介護保険事業状況報告（厚生労働省）の市町村別データ。地域包括ケア見える化システムの実行管理機能からエクスポート可'),

('mieruka_export','地域包括ケア見える化システム エクスポートデータ',
 '認定率・受給率・1人当たり給付費の県平均・全国平均との比較値。2040年推計値を含む',
 'excel',ARRAY['指標名','自市町村値','都道府県平均','全国平均','年度'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis','service_volume','cost_efficiency'],
 ARRAY['gap_analysis','benchmark','forecast'],'internal','随時',
 '地域包括ケア見える化システム（https://mieruka.mhlw.go.jp/）からのデータエクスポート'),

('residence_change_survey','居所変更実態調査結果',
 '施設での死亡率（老健除く）・自宅での死亡率（自死除く）・退院後ADL低下者割合を含む',
 'csv',ARRAY['調査年','指標名','値','単位'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis'],ARRAY['gap_analysis'],
 'confidential','3年毎','市町村が実施する居所変更実態調査の集計結果'),

('vital_statistics','人口動態統計',
 '市町村別の死亡場所（自宅・病院・施設等）別死亡者数',
 'csv',ARRAY['年','死亡場所','死亡者数'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis'],ARRAY['gap_analysis'],
 'public','毎年','厚生労働省 人口動態調査（市区町村別データ）またはe-Stat'),

('jages_data','JAGES調査結果データ',
 '日本老年学的評価研究による地域別健康格差指標。エビデンスの根拠として活用',
 'excel',ARRAY['指標','自市町村値','比較対照値','出典'],
 ARRAY['kaigo_hoken'],ARRAY['issue_hypothesis','logic_model','cost_efficiency'],
 ARRAY['hypothesis','theory_eval'],'internal','随時',
 '公益財団法人医療科学研究所 JAGES事務局から提供される各種資料'),

('dementia_medical_data','認知症関連医療情報',
 '認知症高齢者日常生活自立度Ⅱ以上の者の割合・認知症病棟長期入院者数（1年超）',
 'csv',ARRAY['調査年','指標名','値','分母'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','issue_hypothesis'],
 ARRAY['gap_analysis','hypothesis'],'confidential','毎年',
 '国保データベース（KDB）または介護情報基盤からのデータ抽出'),

('elder_housing_data','高齢者向け住まいの設置状況（都道府県提供）',
 '有料老人ホーム・サービス付き高齢者向け住宅の入居定員総数・要介護者数',
 'excel',ARRAY['施設名','所在地','入居定員','要介護者数','調査時点'],
 ARRAY['kaigo_hoken'],ARRAY['service_volume','gap_analysis'],
 ARRAY['service_volume'],'internal','随時',
 '都道府県から提供。熊本県は令和8年夏頃（7月目途）提供予定'),

('care_service_providers','介護サービス事業所一覧',
 '市町村内の介護サービス事業所の種別・所在地・定員・稼働率・利用者数',
 'csv',ARRAY['事業所名','サービス種別','所在圏域','定員','稼働率'],
 ARRAY['kaigo_hoken'],ARRAY['gap_analysis','service_volume'],
 ARRAY['gap_analysis','service_volume'],'internal','毎年',
 '介護サービス情報公表システムまたは市町村独自調査'),

('care_workforce_data','介護職員数・人材推計ワークシート',
 '介護職員数の現状と2025/2040年推計値。令和8年10月頃配布予定のR6介護職員数版を使用',
 'excel',ARRAY['職種','現状職員数','2025年推計','2040年推計','不足見込み数'],
 ARRAY['kaigo_hoken'],ARRAY['issue_hypothesis','logic_model'],
 ARRAY['hypothesis'],'internal','随時',
 '厚生労働省が配布する人材推計ワークシート（R6介護職員数版）'),

('insurance_finance_data','介護保険財政データ（前期計画実績）',
 '主要施策毎の投入金額（人件費按分含む）・給付費実績・保険料',
 'excel',ARRAY['主要施策名','年度','人件費','事業費','給付費実績'],
 ARRAY['kaigo_hoken'],ARRAY['cost_efficiency','program_evaluation'],
 ARRAY['cost_calc'],'confidential','毎年',
 '市町村の決算データ・介護保険特別会計決算書');

-- ================================================================
-- システムテンプレート 1: 介護保険事業計画（全機能）
-- ================================================================
INSERT INTO plan_templates (id, name, plan_type, description, plan_period_years,
  module_config, is_system_template, is_public) VALUES
(
  'ffffffff-0001-0000-0000-000000000001',
  '介護保険事業計画（第10期）— 策定から評価まで',
  'kaigo_hoken',
  '9期評価→10期策定→計画期間中のPDCA→次期策定まで、策定方針の全工程をカバーする標準テンプレート。5階層プログラム評価・コストと効率性の評価・サービス見込量管理を含む。',
  3,
  '{
    "dataset_manager":  {"enabled": true},
    "gap_analysis":     {"enabled": true},
    "issue_hypothesis": {"enabled": true},
    "logic_model":      {"enabled": true},
    "program_evaluation":{"enabled": true},
    "cost_efficiency":  {"enabled": true},
    "service_volume":   {"enabled": true},
    "self_evaluation":  {"enabled": true}
  }',
  true, true
);

-- テンプレート1のPDCAサイクル定義
-- サイクルA: 策定フェーズ（P）
INSERT INTO pdca_cycle_defs (id, template_id, name, cycle_type, phase, recurrence, description, sort_order) VALUES
('cccc0001-0001-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '策定フェーズ（前期評価→次期計画策定）', 'planning_phase', 'P', 'once',
 '9期計画の評価から10期計画書完成までの策定作業。QCストーリー①〜⑤に対応。', 1);

-- 策定フェーズのチェックポイント
INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0001-0001-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '前期計画評価（Phase 1）', 'QCストーリー①⑦の適用。9期計画の5階層プログラム評価を実施し、主要施策毎の継続・改変・廃止の根拠を整理する。計画初年度または策定年度上旬に実施。',
 0, 4, 7,
 ARRAY['process','outcome_initial','outcome_intermediate','cost_efficiency'],
 ARRAY['program_evaluation','cost_efficiency','self_evaluation','service_volume'],
 'insurer_will',
 '前期評価報告書・自己評価シート・サービス見込量乖離分析シートを完成させる。点検ツールを用いた評価結果を策定委員会に提示する。',
 1),

('dddd0001-0001-0002-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '現状把握・データ収集（Phase 2）', 'QCストーリー②の適用。各種実態調査・見える化システム・JAGES等からデータを収集し、基本目標指標の現状値を整理する。',
 0, 4, 9,
 ARRAY[]::text[],
 ARRAY['dataset_manager','gap_analysis'],
 'status_check',
 '必要なデータセットをすべてアップロードする。現状値一覧シートと中長期推計シート（2040年度）を作成する。',
 2),

('dddd0001-0001-0003-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '地域分析・課題仮説設定（Phase 3）', 'QCストーリー②③④の適用。SWOT分析→ギャップ可視化→ニーズ評価→真因分析の順で課題仮説シートを作成。地域ケア会議・策定委員会で検証する。',
 0, 7, 10,
 ARRAY['needs','theory'],
 ARRAY['gap_analysis','issue_hypothesis','logic_model'],
 'task_selection',
 'SWOT分析シート、課題仮説シート（課題・真因・想定施策）を完成させ、策定委員会で承認を受ける。',
 3),

('dddd0001-0001-0004-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '施策設計・見込量算定・保険料算定（Phase 4）', 'QCストーリー⑤の適用。ロジックモデル確定→対照群・費用設定→マトリクスによる優先順位付け→施策効果反映→サービス見込量算定→保険料試算。',
 0, 9, NULL,
 ARRAY['theory'],
 ARRAY['logic_model','cost_efficiency','service_volume'],
 'measure_planning',
 '主要施策一覧（対照群・費用・根拠付）、マトリクス評価表、サービス見込量算定シート、保険料試算を完成させる。コスト比率≤100%を採択の参考目安とする。',
 4),

('dddd0001-0001-0005-0000-000000000001',
 'cccc0001-0001-0000-0000-000000000001',
 '計画書作成・審議・確定（Phase 5）', '計画書草案を作成し、介護保険事業審議会・パブリックコメントを経て計画を確定・公表する。',
 1, 1, 3,
 ARRAY[]::text[],
 ARRAY['logic_model','program_evaluation'],
 'insurer_will',
 '計画書草案→審議会審議→パブコメ→計画確定→公表の順に進める。',
 5);

-- サイクルB: 年次PDCAサイクル①（前年度実績評価・6月）
INSERT INTO pdca_cycle_defs VALUES
('cccc0001-0002-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '年次PDCAサイクル①（前年度実績評価・6月）', 'annual_june', 'C-A', 'yearly',
 '手引き第1部に示す年度ごとのPDCAサイクル①。前年度の実績が6月頃確定するため、プロセス評価と初期アウトカム評価を実施し、当該年度の取組改善に活かす。', 2);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0002-0001-0000-000000000001',
 'cccc0001-0002-0000-0000-000000000001',
 '前年度実績評価（2年目・6月）', '前年度実績を確定させ、プロセス評価（図6フロー）と初期アウトカム評価を実施。自己評価シートを更新し、当該年度の取組・事業の改善等に活かす。',
 2, 6, 7,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation','service_volume'],
 'effect_check',
 '図6フローに従い「取組は予定通り実施できたか」「取組結果は目標値以上か」を確認。担当者レベルで改善策・解消方策を決定する。',
 1),

('dddd0001-0002-0002-0000-000000000001',
 'cccc0001-0002-0000-0000-000000000001',
 '前年度実績評価（3年目・6月）', '前年度実績を確定させ、プロセス評価と初期アウトカム評価を実施。3年目の上旬には中間アウトカム評価も実施する。',
 3, 6, 7,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation','service_volume'],
 'effect_check',
 '図6フローに従い実施。3年目のため、次期計画策定への引き継ぎ事項も合わせて整理する。',
 2);

-- サイクルC: 年次PDCAサイクル②（予算要求・10月）
INSERT INTO pdca_cycle_defs VALUES
('cccc0001-0003-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '年次PDCAサイクル②（中間実績評価・10月）', 'annual_october', 'C-A', 'yearly',
 '手引き第1部に示す年度ごとのPDCAサイクル②。9月末中間実績を参考に10月評価を実施し、次年度取組の改善の必要性を考察。当初予算計上も可能。', 3);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0003-0001-0000-000000000001',
 'cccc0001-0003-0000-0000-000000000001',
 '中間実績評価（2年目・10月）', '9月末時点の中間実績をもとにプロセス評価と初期アウトカム評価を実施。次年度取組・事業の改善の必要性を考察し当初予算に反映する。',
 2, 10, 12,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation'],
 'dc_continue',
 '事業や取組を開始して6か月のため成果が不十分なこともある。次年度の抜本的な立て直しが必要か判断し、当初予算に計上する。',
 1),

('dddd0001-0003-0002-0000-000000000001',
 'cccc0001-0003-0000-0000-000000000001',
 '中間実績評価（3年目・10月）', '3年目10月時点の評価。次期計画策定のための前期評価準備も並行して開始する。',
 3, 10, 12,
 ARRAY['process','outcome_initial'],
 ARRAY['program_evaluation','self_evaluation'],
 'dc_continue',
 '3年目のため、次期計画策定に向けたPhase 1前期評価の準備を同時に開始する。',
 2);

-- サイクルD: 計画期間評価（3年目・中間アウトカム＋コストと効率性）
INSERT INTO pdca_cycle_defs VALUES
('cccc0001-0004-0000-0000-000000000001',
 'ffffffff-0001-0000-0000-000000000001',
 '計画期間評価（3年目・中間アウトカム＋コストと効率性）', 'triennial', 'C-A', 'once',
 '策定方針p.12図7の「3年目の上旬に行う主要施策毎のプログラム評価」。中間アウトカム指標の達成状況とコストと効率性の評価を実施し、次期計画策定のPhase 1（前期評価）に引き継ぐ。', 4);

INSERT INTO pdca_checkpoint_defs VALUES
('dddd0001-0004-0001-0000-000000000001',
 'cccc0001-0004-0000-0000-000000000001',
 '計画期間評価・中間アウトカム＋コストと効率性（3年目・上旬）',
 '図7フローに従い主要施策毎のプログラム評価を実施。中間アウトカム指標の達成状況を確認し、コストと効率性の評価（コスト比率の再計算）を行う。結果を次期計画策定のPhase 1として引き継ぐ。',
 3, 4, 7,
 ARRAY['outcome_intermediate','cost_efficiency'],
 ARRAY['program_evaluation','cost_efficiency','service_volume'],
 'effect_check',
 '図7フロー：中間アウトカムの目標値達成確認→初期アウトカムに起因するものか→コストと効率性の評価（投入した人員と予算は適切か）の順で実施。結果を前期評価報告書にまとめ次期計画策定委員会に提示する。',
 1);

-- ================================================================
-- システムテンプレート 2: 介護保険事業計画（進捗管理特化）
-- ================================================================
INSERT INTO plan_templates VALUES
(
  'ffffffff-0002-0000-0000-000000000001',
  '介護保険事業計画（進捗管理特化）',
  'kaigo_hoken',
  'すでに計画が策定済みで、計画期間中の進捗管理のみを行うテンプレート。策定フェーズのモジュールを省略し、年次PDCAと3年目評価に特化する。',
  3,
  '{
    "dataset_manager":  {"enabled": true},
    "gap_analysis":     {"enabled": false},
    "issue_hypothesis": {"enabled": false},
    "logic_model":      {"enabled": false},
    "program_evaluation":{"enabled": true},
    "cost_efficiency":  {"enabled": true},
    "service_volume":   {"enabled": true},
    "self_evaluation":  {"enabled": true}
  }',
  true, true
);

-- テンプレート2には年次PDCAサイクル①②と計画期間評価サイクルのみ定義
-- （チェックポイント定義は同上の annual_june / annual_october / triennial に準拠）
INSERT INTO pdca_cycle_defs VALUES
('cccc0002-0002-0000-0000-000000000001',
 'ffffffff-0002-0000-0000-000000000001',
 '年次PDCAサイクル①（前年度実績評価・6月）','annual_june','C-A','yearly','前年度実績評価（6月頃）',2);
INSERT INTO pdca_cycle_defs VALUES
('cccc0002-0003-0000-0000-000000000001',
 'ffffffff-0002-0000-0000-000000000001',
 '年次PDCAサイクル②（中間実績評価・10月）','annual_october','C-A','yearly','中間実績評価と次年度予算要求（10月頃）',3);
INSERT INTO pdca_cycle_defs VALUES
('cccc0002-0004-0000-0000-000000000001',
 'ffffffff-0002-0000-0000-000000000001',
 '計画期間評価（3年目）','triennial','C-A','once','中間アウトカム＋コストと効率性の評価（3年目上旬）',4);

-- 各サイクルのチェックポイントはテンプレート1と同内容（plan_yearとevaluation_tiersは同じ）
-- ※省略：Claude Codeはテンプレート2のサイクルにも同様のチェックポイントを定義すること

-- ================================================================
-- システムテンプレート 3: 汎用行政計画（カスタム）
-- ================================================================
INSERT INTO plan_templates VALUES
(
  'ffffffff-0003-0000-0000-000000000001',
  '汎用行政計画テンプレート（カスタマイズ可）',
  'custom',
  '介護保険以外の計画（障害福祉計画・健康増進計画等）や独自の計画に使用するテンプレート。モジュールとPDCAサイクルをゼロから設計できる。',
  3,
  '{
    "dataset_manager":  {"enabled": true},
    "gap_analysis":     {"enabled": true},
    "issue_hypothesis": {"enabled": true},
    "logic_model":      {"enabled": true},
    "program_evaluation":{"enabled": true},
    "cost_efficiency":  {"enabled": false},
    "service_volume":   {"enabled": false},
    "self_evaluation":  {"enabled": true}
  }',
  true, true
);

-- テンプレート3のPDCAサイクルは空（ユーザーがデザイナーで設計する）
-- projects テーブルへのカラム追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'kaigo_hoken';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES plan_templates(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_end_date DATE;
```

---

## 新規・更新が必要な画面

### 画面A: テンプレートライブラリ
**ページ:** `app/(admin)/templates/page.tsx`

テンプレートカードのグリッドを表示する。各カードに以下を表示する。
- テンプレート名・計画型・説明
- 有効モジュールのアイコン一覧（有効＝実線アイコン、無効＝グレー）
- PDCAサイクルのミニタイムライン（横棒）
- 「このテンプレートを使用」ボタン → プロジェクト作成ウィザードへ
- 「複製して編集」ボタン → テンプレートエディタへ

---

### 画面B: テンプレートエディタ
**ページ:** `app/(admin)/templates/[id]/edit/page.tsx`

**タブ1: 基本情報**
- テンプレート名・計画型・説明・計画期間年数

**タブ2: モジュール設定**
- モジュールをカードグリッドで表示し、トグルスイッチで有効/無効を設定する
- 依存モジュールが無効になっている場合は警告を表示する

**タブ3: PDCAサイクルデザイナー（★コア機能）**

ビジュアルタイムラインエディタとして実装する。

```
レイアウト:
┌──────────────────────────────────────────────────────┐
│ [+ サイクルを追加]                                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  策定年度(0)  │  1年目  │  2年目  │  3年目            │
│  4  5  6  7  8  9  10 11 12 1  2  3 ... 4  5  6  7   │
│                                                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [P] 策定フェーズ
│ [前期評価] [現状把握] [課題仮説] [施策設計] [計画書]   │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [C-A] 年次①6月
│                                       [2年実績評価] [3年実績評価]│
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [C-A] 年次②10月
│                                         [2年中間] [3年中間]    │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [C-A] 3年目評価
│                                                    [計画期間評価]│
└──────────────────────────────────────────────────────┘
```

実装仕様:
- 横軸は計画年度と月を表示する（`plan_period_years`に基づいて動的生成）
- 各サイクルは横方向のレーンとして表示する
- チェックポイントはカードとしてタイムライン上に配置する
- カードはドラッグで月のポジションを変更できる
- カードをクリックするとサイドパネルが開き以下を編集できる:
  - チェックポイント名・説明
  - 実施年度（plan_year: 0〜N）
  - 開始月・終了月（スライダー）
  - 実施する評価階層（チェックボックス）
  - 使用するモジュール（チェックボックス）
  - QCストーリーのステップ（セレクトボックス）
  - 担当者向けの実施手順メモ（テキストエリア）
- 「+ チェックポイントを追加」ボタンでカードをレーンに追加できる
- ライブラリ: `react-dnd` または `@dnd-kit/core` でドラッグ&ドロップを実装する

---

### 画面C: プロジェクト作成ウィザード（更新）
**ページ:** `app/(admin)/projects/new/page.tsx`

既存のプロジェクト作成ページを4ステップウィザードに更新する。

**ステップ1: テンプレート選択**
- テンプレートライブラリのカードグリッドを表示する
- 「テンプレートなしで開始」オプションも提供する

**ステップ2: 基本情報入力**
- プロジェクト名・説明
- 計画開始日（Date Picker）← **この日付を元にチェックポイントの実際の日付を計算する**
- 例: 計画開始日 = 2027-04-01、 plan_year=2 month=6 → scheduled_date = 2029-06-01

**ステップ3: モジュールの確認・カスタマイズ**
- テンプレートから引き継いだモジュール設定を表示する
- ユーザーはここで個別にオン/オフを変更できる

**ステップ4: PDCAスケジュールの確認**
- 「計画開始日」を基に計算された全チェックポイントの日付一覧を表示する
- テーブル形式: チェックポイント名 / サイクル / 予定日 / 実施する評価 / 関連モジュール
- ユーザーはここで個別の日付を±3ヶ月の範囲で調整できる
- 「プロジェクトを作成」ボタンでプロジェクトと全チェックポイントを一括作成する

**バックエンドAPI:** `POST /api/projects`
```typescript
// プロジェクト作成時の処理
async function createProject(data: {
  name: string;
  templateId: string;
  planStartDate: Date;
  moduleOverrides: Record<string, {enabled: boolean}>;
  checkpointDateOverrides: Record<string, Date>;
}) {
  // 1. projects レコードを作成
  // 2. project_module_configs レコードをテンプレートから生成
  // 3. テンプレートのpdca_checkpoint_defsを取得
  // 4. 各チェックポイントの実際の日付を計算:
  //    scheduledDate = addMonths(planStartDate, plan_year * 12 + (month_start - planStartMonth))
  // 5. project_pdca_checkpoints レコードを一括作成
}
```

---

### 画面D: PDCAダッシュボード（プロジェクト内）
**ページ:** `app/(admin)/projects/[id]/pdca/page.tsx`

プロジェクトの現在のPDCA進捗状況を一覧できるダッシュボード。

**上部: 現在地表示**
- 計画開始から現在まで経過した時間をプログレスバーで表示する
- 「次のチェックポイント」カード: 名前・予定日・あと何日か・必要なモジュール

**中部: タイムラインビュー**
- テンプレートエディタと同じ横軸タイムライン（編集不可の閲覧モード）
- チェックポイントカードに状態バッジを表示する: `upcoming` / `in_progress` / `completed` / `skipped`
- `completed` のカードはグリーン、`in_progress` はブルー、`upcoming` はグレー
- カードをクリックするとチェックポイント詳細ページへ移動する

**下部: チェックポイント一覧テーブル**
- カラム: チェックポイント名 / サイクル / 予定日 / 状態 / 評価階層 / 担当モジュール / アクション
- 「作業を開始」ボタン → チェックポイント作業ページへ

---

### 画面E: チェックポイント作業ページ
**ページ:** `app/(admin)/projects/[id]/pdca/[checkpointId]/page.tsx`

特定のチェックポイントに紐づいた作業をまとめて行う統合ページ。

**ヘッダー**
- チェックポイント名・サイクル名・予定日
- QCストーリーのステップバッジ（保険者の意志/現状把握/課題選定/...）
- 実施手順メモ（テンプレートから引き継いだ説明文）
- 「完了にする」ボタン

**作業エリア（タブ形式）**
- このチェックポイントの `modules_involved` に応じてタブを動的生成する
- 例: evaluation_tiers に `process` と `outcome_initial` が含まれる場合:
  - タブ1: プロセス評価（program_evaluationモジュールのUIを埋め込み）
  - タブ2: 初期アウトカム評価（program_evaluationモジュールのUIを埋め込み）
  - タブ3: 自己評価シート（self_evaluationモジュールのUIを埋め込み）

**作業結果の保存**
- 各タブで作成した評価・分析結果は `checkpoint_id` を持つレコードとして保存される
- 完了時に `project_pdca_checkpoints.linked_evaluation_ids` を更新する

---

### 画面F: その他モジュール画面（checkpoint_idを追加）

既存設計の各モジュール画面（`gap_analysis`, `issue_hypothesis`, `logic_model`, `program_evaluation`, `cost_efficiency`, `service_volume`, `self_evaluation`, `dataset_manager`）に以下を追加する。

1. **チェックポイント文脈の表示**: ページ上部に「このページはチェックポイント○○の作業です」バナーを表示する
2. **チェックポイントフィルタ**: チェックポイントが指定されている場合、そのチェックポイントに関連するレコードのみを表示する
3. **作業状態の連携**: 主要なデータを保存した際に `project_pdca_checkpoints.status` を自動的に `in_progress` に更新する

---

### 画面G: モジュール設定（テンプレートからの引き継ぎ表示を追加）
**ページ:** `app/(admin)/projects/[id]/settings/modules/page.tsx`

既存設計に以下を追加する。
- 「このプロジェクトの元テンプレート」を表示する
- テンプレートのデフォルト設定と現在の設定の差分を視覚的に表示する（バッジ: 「テンプレートから変更」）
- 「テンプレートの設定に戻す」ボタン

---

## 実装手順

以下の順番で実装すること。各ステップ完了時に報告すること。

### STEP 1: DBマイグレーション
1. `infra/migrations/006_care_plan_suite.sql` を作成・適用する
2. `infra/migrations/007_system_templates.sql` を作成・適用する（システムテンプレート3種とdataset_definitions 14種を含む）
3. `projects` テーブルに `plan_type`, `template_id`, `plan_start_date`, `plan_end_date` カラムを追加する

### STEP 2: テンプレート基盤
1. `lib/templates/` — テンプレート関連のユーティリティ関数群
   - `getTemplateWithCycles(templateId)` — サイクルとチェックポイントを含むテンプレート取得
   - `calculateCheckpointDates(checkpointDefs, planStartDate)` — チェックポイント日付の計算関数
   - `instantiateTemplate(projectId, templateId, planStartDate, overrides)` — テンプレートからプロジェクト生成
2. `app/(admin)/templates/page.tsx` — テンプレートライブラリ（画面A）
3. `app/api/templates/route.ts` — テンプレート一覧取得API

### STEP 3: PDCAサイクルデザイナー
1. `components/pdca/CycleDesigner.tsx` — タイムラインエディタコンポーネント（ドラッグ&ドロップ対応）
2. `components/pdca/CheckpointCard.tsx` — タイムライン上のチェックポイントカード
3. `components/pdca/CheckpointEditPanel.tsx` — サイドパネル（詳細編集フォーム）
4. `app/(admin)/templates/[id]/edit/page.tsx` — テンプレートエディタ（画面B）
5. `app/api/templates/[id]/route.ts` — テンプレートCRUD API

### STEP 4: プロジェクト作成ウィザード
1. `app/(admin)/projects/new/page.tsx` を4ステップウィザードに更新する（画面C）
2. `app/api/projects/route.ts` のPOSTハンドラを更新し、`instantiateTemplate` を呼び出す
3. チェックポイントの日付計算ロジックをテストする

### STEP 5: PDCAダッシュボード
1. `app/(admin)/projects/[id]/pdca/page.tsx` — PDCAダッシュボード（画面D）
2. `app/(admin)/projects/[id]/pdca/[checkpointId]/page.tsx` — チェックポイント作業ページ（画面E）
3. `app/api/projects/[id]/pdca-checkpoints/route.ts` — チェックポイントCRUD API

### STEP 6: データセット管理（Module 1）
1. `app/(admin)/projects/[id]/datasets/page.tsx`
2. `app/api/projects/[id]/datasets/route.ts`
3. S3アップロード処理とバリデーション

### STEP 7: ギャップ分析（Module 2）
1. `app/(admin)/projects/[id]/gap-analysis/page.tsx`（`checkpoint_id`対応を含む）
2. `app/api/projects/[id]/gap-analysis/route.ts`
3. `app/api/projects/[id]/gap-analysis/ai-analyze/route.ts`

### STEP 8: 課題仮説設定（Module 3）
1. ロジックツリービルダーコンポーネント（`reactflow`使用）
2. `app/(admin)/projects/[id]/issue-hypothesis/page.tsx`
3. `app/api/projects/[id]/issue-hypothesis/route.ts`

### STEP 9: ロジックモデル（Module 4）
1. ロジックモデルビジュアルエディタ
2. `app/(admin)/projects/[id]/logic-model/page.tsx`
3. `app/api/projects/[id]/logic-model/ai-generate/route.ts`

### STEP 10: プログラム評価（Module 5）
1. 図6・図7評価フローコンポーネント（フロー分岐ウィザード形式）
2. `app/(admin)/projects/[id]/program-evaluation/page.tsx`
3. `app/api/projects/[id]/evaluations/route.ts`

### STEP 11: コストと効率性の評価・サービス見込量・自己評価シート（Module 6・7・8）
1. Module 6: `app/(admin)/projects/[id]/cost-efficiency/page.tsx`（リアルタイム計算機付き）
2. Module 7: `app/(admin)/projects/[id]/service-volume/page.tsx`（3ステップ乖離要因分析）
3. Module 8: `app/(admin)/projects/[id]/self-evaluation/page.tsx`（PDFエクスポート付き）

### STEP 12: 統合・結合確認
1. 既存の `projects`, `kpis`, `evidences` との連携確認
2. プログラム評価結果を既存の `policy_suggestions` に連携
3. 全チェックポイントからモジュールUIへのナビゲーション確認

---

## UIデザイン要件

- 配色: 既存ダークテーマ（背景 `#0f1117` / カード `#1a1d27` / アクセント `#3b82f6`）を全画面で維持する
- PDCAタイムラインの状態カラー:
  - `upcoming`: グレー（`#888`）
  - `in_progress`: ブルー（`#3b82f6`）
  - `completed`: グリーン（`#22c55e`）
  - `skipped`: オレンジ（`#f97316`）
- 既存UIコンポーネント（ボタン・テーブル・フォーム等）を再利用する
- Skeleton UI でローディング状態を適切に実装する
- APIエラー時はトースト通知を表示する

---

## 備考

- 全APIエンドポイントは既存の認証ミドルウェアで保護すること
- AI分析APIは `project_datasets` の充足チェックを実施し、不足の場合は `{ error: 'INSUFFICIENT_DATASETS', missing: [...] }` を返すこと
- システムテンプレート（`is_system_template = true`）はUIから削除・編集できないようにする（複製のみ可）
- 他の行政計画への展開は `plan_type` と `dataset_definitions.plan_types` の設定変更で対応できる設計とすること
- `project_pdca_checkpoints.scheduled_date` の計算式:
  `planStartDate + (plan_year * 12 + (month_start - planStartMonth)) months`
  ※ 策定年度（plan_year=0）は `planStartDate` の前年度に相当するため、符号に注意すること

---

# GovLink — 成果物連鎖・統計分析・モジュール相関設計 追補指示書
# （prompt_care_plan_suite_v2.md への追加・改訂分）

---

## 1. モジュール間の因果関係マップ

### 1-A. 正式な因果グラフ定義

以下の有向グラフを `lib/modules/causal-graph.ts` として実装すること。
A → B は「Aの成果物がBの主要な入力である」ことを意味する（直接因果）。

```typescript
// lib/modules/causal-graph.ts

export type ModuleId =
  | 'dataset_manager'
  | 'gap_analysis'
  | 'issue_hypothesis'
  | 'logic_model'
  | 'program_evaluation'
  | 'cost_efficiency'
  | 'service_volume'
  | 'self_evaluation';

/**
 * 成果物の流れ（AのどのアーティファクトがBのどの入力になるか）
 */
export const CAUSAL_EDGES: CausalEdge[] = [
  // datasets → gap_analysis
  {
    from: 'dataset_manager', to: 'gap_analysis',
    output_type: 'validated_datasets',
    input_role: 'measurement_data',
    description: 'アップロード済みデータセット（ニーズ調査・認定データ等）を指標の現状値として活用する',
    is_required: true,
  },
  // datasets → service_volume
  {
    from: 'dataset_manager', to: 'service_volume',
    output_type: 'validated_datasets',
    input_role: 'utilization_data',
    description: '介護保険事業状況報告データをサービス別計画値・実績値として活用する',
    is_required: true,
  },
  // gap_analysis → issue_hypothesis
  {
    from: 'gap_analysis', to: 'issue_hypothesis',
    output_type: 'prioritized_gaps',
    input_role: 'problem_basis',
    description: '優先度スコア順の問題一覧を課題仮説設定の出発点として活用する。影響人数・悪化傾向がSMART評価に直結する。',
    is_required: true,
  },
  // gap_analysis → logic_model
  {
    from: 'gap_analysis', to: 'logic_model',
    output_type: 'current_status_data',
    input_role: 'logic_model_current_status',
    description: 'ギャップ分析の現状値データをロジックモデルの「現状」セクションに転記する',
    is_required: false,
  },
  // issue_hypothesis → logic_model
  {
    from: 'issue_hypothesis', to: 'logic_model',
    output_type: 'verified_hypotheses',
    input_role: 'challenge_and_root_cause',
    description: '検証済み課題仮説シートの「課題」「真因」をロジックモデルの対応フィールドに引き継ぐ',
    is_required: true,
  },
  // logic_model → program_evaluation
  {
    from: 'logic_model', to: 'program_evaluation',
    output_type: 'logic_model_outcomes',
    input_role: 'evaluation_targets',
    description: 'ロジックモデルの初期アウトカム・中間アウトカム・取組が評価対象の指標・活動を定義する',
    is_required: true,
  },
  // logic_model → cost_efficiency
  {
    from: 'logic_model', to: 'cost_efficiency',
    output_type: 'activities_and_inputs',
    input_role: 'investment_definition',
    description: 'ロジックモデルの「投入」（人件費・事業費）と「取組」がコスト計算の投入金額の根拠を与える',
    is_required: true,
  },
  // logic_model → self_evaluation
  {
    from: 'logic_model', to: 'self_evaluation',
    output_type: 'activities_and_targets',
    input_role: 'evaluation_framework',
    description: 'ロジックモデルの「取組」と「成果（中目標）」が自己評価シートのフェイスシート内容（具体的な取組・目標）を定義する',
    is_required: true,
  },
  // program_evaluation → cost_efficiency
  {
    from: 'program_evaluation', to: 'cost_efficiency',
    output_type: 'actual_outcome_measurements',
    input_role: 'ex_post_actual_values',
    description: '中間アウトカム指標の実績値（認定率変化・受給率変化等）を事後評価のコスト比率計算に使用する',
    is_required: false,
  },
  // program_evaluation → service_volume
  {
    from: 'program_evaluation', to: 'service_volume',
    output_type: 'outcome_attribution_data',
    input_role: 'deviation_factor_context',
    description: '施策効果の実績値（例: 介護予防事業の効果）がサービス見込量の乖離要因分析における「施策効果」要因の検証根拠になる',
    is_required: false,
  },
  // program_evaluation → self_evaluation
  {
    from: 'program_evaluation', to: 'self_evaluation',
    output_type: 'evaluation_results',
    input_role: 'objective_evaluation_context',
    description: '5階層評価の結果（達成率・所見）が自己評価シートの「自己評価結果」の客観的根拠として参照される',
    is_required: false,
  },
];

/**
 * 非因果ペア（論理構造上、直接の因果関係が成立しない組み合わせ）
 */
export const INCOMPATIBLE_PAIRS: IncompatibilityRule[] = [
  // --- 中間モジュールが欠落するケース ---
  {
    module_a: 'gap_analysis',
    module_b: 'program_evaluation',
    missing_intermediaries: ['logic_model'],
    incompatibility_type: 'missing_intermediary',
    is_blocking: false,
    warning_message:
      '地域分析・ギャップ分析の成果物からプログラム評価を直接実施することはできません。ロジックモデルモジュールで評価対象となる成果指標・取組を定義してください。',
  },
  {
    module_a: 'gap_analysis',
    module_b: 'cost_efficiency',
    missing_intermediaries: ['issue_hypothesis', 'logic_model'],
    incompatibility_type: 'missing_intermediary',
    is_blocking: false,
    warning_message:
      'ギャップ分析の結果からコストと効率性の評価を直接実施することはできません。課題仮説設定・ロジックモデルを通じて投入金額と施策効果を定義してください。',
  },
  {
    module_a: 'gap_analysis',
    module_b: 'self_evaluation',
    missing_intermediaries: ['logic_model'],
    incompatibility_type: 'missing_intermediary',
    is_blocking: false,
    warning_message:
      'ギャップ分析から直接自己評価シートを作成することはできません。ロジックモデルモジュールで具体的な取組と目標を定義してください。',
  },
  {
    module_a: 'issue_hypothesis',
    module_b: 'program_evaluation',
    missing_intermediaries: ['logic_model'],
    incompatibility_type: 'missing_intermediary',
    is_blocking: false,
    warning_message:
      '課題仮説設定の成果物からプログラム評価を直接実施することはできません。ロジックモデルモジュールで取組・成果指標を設計してください。',
  },
  {
    module_a: 'issue_hypothesis',
    module_b: 'cost_efficiency',
    missing_intermediaries: ['logic_model'],
    incompatibility_type: 'missing_intermediary',
    is_blocking: false,
    warning_message:
      '課題仮説からコストと効率性の評価を直接実施することはできません。ロジックモデルで投入量と期待される成果（3指標への効果）を定義してください。',
  },
  // --- 因果関係が存在しないケース（並列評価） ---
  {
    module_a: 'cost_efficiency',
    module_b: 'service_volume',
    missing_intermediaries: [],
    incompatibility_type: 'no_causal_path',
    is_blocking: false,
    warning_message:
      'コストと効率性の評価とサービス見込量管理は並列した評価活動であり、直接の因果関係はありません。両モジュールを同時に使用すること自体は問題ありませんが、一方の成果物が他方の入力にはなりません。',
  },
  {
    module_a: 'cost_efficiency',
    module_b: 'self_evaluation',
    missing_intermediaries: [],
    incompatibility_type: 'no_causal_path',
    is_blocking: false,
    warning_message:
      'コストと効率性の評価と自己評価シートは並列した評価活動であり、直接の因果関係はありません。',
  },
  {
    module_a: 'service_volume',
    module_b: 'self_evaluation',
    missing_intermediaries: [],
    incompatibility_type: 'no_causal_path',
    is_blocking: false,
    warning_message:
      'サービス見込量管理と自己評価シートは並列した評価活動であり、直接の因果関係はありません。',
  },
  // --- 計画型の不一致 ---
  {
    module_a: 'cost_efficiency',
    module_b: 'gap_analysis',   // gap uses shougai/kenko but cost is kaigo only
    missing_intermediaries: [],
    incompatibility_type: 'plan_type_mismatch',
    is_blocking: true,
    warning_message:
      'コストと効率性の評価は介護保険事業計画専用のモジュールです。他の計画型では使用できません。',
  },
  {
    module_a: 'service_volume',
    module_b: 'gap_analysis',
    missing_intermediaries: [],
    incompatibility_type: 'plan_type_mismatch',
    is_blocking: true,
    warning_message:
      'サービス見込量管理は介護保険事業計画専用のモジュールです。他の計画型では使用できません。',
  },
];
```

### 1-B. 相関関係一覧テーブル（全組み合わせ）

```
         | 1:DS | 2:GA | 3:IH | 4:LM | 5:PE | 6:CE | 7:SV | 8:SE |
---------|------|------|------|------|------|------|------|------|
1:DS     |  —   |  →   |  △   |  △   |  △   |  △   |  →   |  △   |
2:GA     |      |  —   |  →   |  →   |  ⚠¹  |  ⚠²  |  ✕   |  ⚠³  |
3:IH     |      |      |  —   |  →   |  ⚠⁴  |  ⚠⁵  |  ✕   |  ⚠⁶  |
4:LM     |      |      |      |  —   |  →   |  →   |  △   |  →   |
5:PE     |      |      |      |      |  —   |  →   |  →   |  →   |
6:CE     |      |      |      |      |      |  —   |  ‖   |  ‖   |
7:SV     |      |      |      |      |      |      |  —   |  ‖   |
8:SE     |      |      |      |      |      |      |      |  —   |

凡例:
→  直接因果あり（成果物が入力として活用される）
△  間接的な関係（因果なし・共通データソースのみ）
⚠  要注意：中間モジュールが不足（ブロッキング警告ではない）
✕  因果関係なし（計画型一致の場合のみ結合可能）
‖  並列評価（因果関係なし・警告のみ）
—  自己参照
```

---

## 2. 成果物連鎖（アーティファクト・リネージ）システム

### 2-A. DBスキーマ追加
`infra/migrations/008_artifact_lineage.sql` として作成すること。

```sql
-- ================================================================
-- モジュール成果物レジストリ
-- ================================================================
CREATE TABLE module_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id UUID REFERENCES project_pdca_checkpoints(id),
  module_id TEXT NOT NULL REFERENCES plan_modules(id),

  -- 成果物の種類（モジュール固有）
  artifact_type TEXT NOT NULL,
  -- gap_analysis: 'gap_table', 'swot_matrix', 'priority_gap_list'
  -- issue_hypothesis: 'hypothesis_sheet', 'logic_tree'
  -- logic_model: 'logic_model_v{n}'
  -- program_evaluation: 'process_eval', 'initial_outcome_eval', 'intermediate_outcome_eval'
  -- cost_efficiency: 'cost_ratio_calc_ex_ante', 'cost_ratio_calc_ex_post'
  -- service_volume: 'deviation_analysis'
  -- self_evaluation: 'self_eval_sheet'

  -- 成果物への参照（各モジュールのレコードID）
  artifact_record_id UUID NOT NULL,

  -- この成果物を生成するために使用した上流成果物
  source_artifact_ids UUID[] DEFAULT ARRAY[]::uuid[],

  -- 上流データセットの最終更新時刻（陳腐化検出に使用）
  source_datasets_snapshot JSONB DEFAULT '{}',
  -- { dataset_def_id: uploaded_at_iso_string }

  -- リネージ説明（「○○の現状値から△△の問題を特定した」等）
  derivation_note TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 非互換性ルールの永続化
-- ================================================================
CREATE TABLE module_incompatibility_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_a TEXT NOT NULL REFERENCES plan_modules(id),
  module_b TEXT NOT NULL REFERENCES plan_modules(id),
  incompatibility_type TEXT NOT NULL
    CHECK (incompatibility_type IN (
      'missing_intermediary',
      'no_causal_path',
      'plan_type_mismatch',
      'circular'
    )),
  is_blocking BOOLEAN NOT NULL DEFAULT false,
  warning_message TEXT NOT NULL,
  required_intermediaries TEXT[] DEFAULT ARRAY[]::text[],
  UNIQUE(module_a, module_b)
);

-- incompatibility_rules の初期データ（causal-graph.ts の INCOMPATIBLE_PAIRS に対応）
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

-- ================================================================
-- 統計分析結果の永続化
-- ================================================================
CREATE TABLE statistical_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id UUID REFERENCES module_artifacts(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  analysis_type TEXT NOT NULL,
  -- Module 2: 'trend_regression', 'z_score_benchmark', 'age_standardized_rate', 'gap_priority_score'
  -- Module 3: 'correlation_matrix', 'evidence_strength_score'
  -- Module 5: 'pre_post_comparison', 'diff_in_diff', 'attribution_analysis'
  -- Module 6: 'sensitivity_analysis', 'monte_carlo_simulation', 'breakeven_analysis'
  -- Module 7: 'decomposition_analysis', 'demand_forecast'
  indicator_name TEXT,              -- 分析対象の指標名
  input_data JSONB NOT NULL,        -- 実際に使用したデータ（再現性のため）
  parameters JSONB DEFAULT '{}',    -- 分析パラメータ（有意水準等）
  results JSONB NOT NULL,           -- 分析結果（統計量・p値等）
  calculation_steps JSONB NOT NULL, -- 計算過程のステップ詳細（可視化用）
  interpretation TEXT,              -- 平易な言語での解釈（日本語）
  caveats TEXT,                     -- 解釈上の注意点
  is_ai_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス追加
CREATE INDEX idx_module_artifacts_project ON module_artifacts(project_id);
CREATE INDEX idx_module_artifacts_module ON module_artifacts(module_id);
CREATE INDEX idx_statistical_analyses_project ON statistical_analyses(project_id);
CREATE INDEX idx_statistical_analyses_artifact ON statistical_analyses(artifact_id);
```

### 2-B. リネージパネルコンポーネント

**ファイル:** `components/lineage/ArtifactLineagePanel.tsx`

このコンポーネントは各モジュールページのサイドパネルとして表示する。

```
レイアウト:
┌─────────────────────────────────┐
│  成果物の連鎖関係                 │
├─────────────────────────────────┤
│ ▲ この成果物に使用された入力      │
│                                 │
│  [DS] データセット管理             │
│   └─ ニーズ調査結果（2024-10-15）  │
│      使用: 閉じこもり割合の現状値  │
│                                 │
│  [GA] ギャップ分析                │
│   └─ 優先ギャップ#3「閉じこもり高齢者」│
│      使用: 課題仮説の出発点       │
│      ⚠ 参照元が2024-11-01に更新されました│
│        → 再分析を推奨します       │
├─────────────────────────────────┤
│ ▼ この成果物を参照している後工程  │
│                                 │
│  [LM] ロジックモデル #1           │
│   └─「閉じこもり割合低減」の課題として採用│
│                                 │
└─────────────────────────────────┘
```

実装仕様:
- `artifact_id` を props として受け取る
- `module_artifacts` テーブルを再帰的に辿り、上流・下流の成果物を取得する
- 陳腐化チェック: `source_datasets_snapshot` の `uploaded_at` と現在の `project_datasets.uploaded_at` を比較し、不一致があれば黄色警告を表示する
- 下流成果物がある場合「このデータを更新すると後続の分析に影響します」という赤色警告を表示する

### 2-C. リネージグラフビュー

**ページ:** `app/(admin)/projects/[id]/lineage/page.tsx`

プロジェクト全体の成果物連鎖をフローグラフで可視化する。

```
表示形式（react-flow を使用）:

[データセット] → [ギャップ分析] → [課題仮説] → [ロジックモデル] → [プログラム評価]
                                                               ↓
                                                          [コスト評価]
                                                               ↓
                                                          [自己評価]

各ノード: 成果物名・作成日・ステータス（完成/作業中/陳腐化）
各エッジ: どのデータが引き継がれたかをホバーで表示
```

モジュール設定画面でも「モジュール相関図」タブを追加すること。
相関図はテンプレート編集画面にも表示し、非互換ペアのエッジは赤い破線で表示する。

---

## 3. 非互換性チェックシステム

### 3-A. チェックロジック

**ファイル:** `lib/modules/compatibility-checker.ts`

```typescript
// lib/modules/compatibility-checker.ts

export function checkModuleCompatibility(
  enabledModules: ModuleId[],
  proposedAdd: ModuleId,
  incompatibilityRules: IncompatibilityRule[]
): CompatibilityCheckResult {
  const warnings: CompatibilityWarning[] = [];
  const blockers: CompatibilityWarning[] = [];

  for (const existing of enabledModules) {
    // 既存モジュールと追加モジュールの組み合わせを検査
    const rule = incompatibilityRules.find(r =>
      (r.module_a === existing && r.module_b === proposedAdd) ||
      (r.module_a === proposedAdd && r.module_b === existing)
    );

    if (rule) {
      // 必要な中間モジュールが欠落しているか確認
      if (rule.incompatibility_type === 'missing_intermediary') {
        const missingIntermediaries = rule.required_intermediaries.filter(
          mid => !enabledModules.includes(mid as ModuleId)
        );
        if (missingIntermediaries.length > 0) {
          const item = {
            rule,
            missing: missingIntermediaries,
            message: rule.warning_message,
          };
          rule.is_blocking ? blockers.push(item) : warnings.push(item);
        }
        // 中間モジュールが揃っていれば警告不要
      } else {
        const item = { rule, missing: [], message: rule.warning_message };
        rule.is_blocking ? blockers.push(item) : warnings.push(item);
      }
    }
  }

  return {
    is_allowed: blockers.length === 0,
    blockers,
    warnings,
  };
}
```

### 3-B. UI警告コンポーネント

テンプレートエディタとプロジェクトモジュール設定画面のトグルスイッチに組み込む。

- モジュールを有効化しようとした時に `checkModuleCompatibility` を呼び出す
- `is_blocking = true` の場合: 赤いエラートースト + トグルを元に戻す
  - 例: 「このモジュールはカイゴ保険事業計画専用です。計画型を変更してください。」
- `is_blocking = false` の場合: 黄色の警告バナーをページ上部に表示し、トグルは有効化を許可する
  - 例: 「⚠ この工程は、前に登録された工程と直接の関連性がありません。ロジックモデルモジュールを追加することを推奨します。」

---

## 4. 統計分析フレームワーク

各モジュールで以下の統計分析機能を実装すること。
すべての分析結果は `statistical_analyses` テーブルに保存し、
`calculation_steps` フィールドに計算過程の各ステップを記録する。

### 4-A. Module 2: 地域分析・ギャップ分析

#### (1) トレンド回帰分析

**API:** `POST /api/projects/[id]/gap-analysis/stats/trend`

**入力:** 指標の時系列データ（年度, 値）の配列（`care_insurance_report` から取得）

**モデル:** `Y_t = α + β·t + ε`

**出力と計算ステップ:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "データ確認", "detail": "n=5年（H29〜R3）, Y = [19.2, 20.1, 21.3, 21.0, 22.4]"},
    {"step": 2, "label": "最小二乗法の行列計算", "formula": "β = (X'X)⁻¹ X'Y", "values": {"XtX": "...", "XtY": "..."}},
    {"step": 3, "label": "回帰係数", "values": {"alpha": 17.4, "beta": 0.78}},
    {"step": 4, "label": "決定係数", "formula": "R² = 1 - SS_res/SS_tot", "value": 0.921},
    {"step": 5, "label": "t検定（傾きの有意性）", "formula": "t = β/SE_β", "t_stat": 6.84, "p_value": 0.023},
    {"step": 6, "label": "予測値と信頼区間", "forecast_R5": {"point": 23.2, "ci95": [21.8, 24.6]}}
  ],
  "results": {
    "alpha": 17.4, "beta": 0.78, "r_squared": 0.921,
    "t_stat": 6.84, "p_value": 0.023,
    "trend_direction": "increasing",
    "is_significant": true
  },
  "interpretation": "要介護認定率は年間0.78ポイントの上昇傾向が統計的に有意（p=0.023）。この傾向が続くと令和5年度には23.2%に達する見込み（95%CI: 21.8〜24.6%）。"
}
```

**UI:** 折れ線グラフ（実績値の散布図 + 回帰直線 + 95%信頼区間バンド）。計算ステップはアコーディオンで展開可能。

#### (2) Zスコアベンチマーク比較

**入力:** 自市町村の指標値、県内市町村の分布（`mieruka_export` から取得）

**計算:** `z = (x_local - μ_pref) / σ_pref`

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "市町村値", "value": 22.4, "unit": "%"},
    {"step": 2, "label": "県内平均", "mu": 19.8, "sigma": 2.1, "n_municipalities": 45},
    {"step": 3, "label": "Zスコア算出", "formula": "z = (22.4 - 19.8) / 2.1", "z": 1.24},
    {"step": 4, "label": "パーセンタイル順位", "percentile": 89.3}
  ],
  "results": {"z_score": 1.24, "percentile": 89.3, "is_outlier": false},
  "interpretation": "御船町の認定率（22.4%）は県内平均（19.8%）より1.24標準偏差高く、県内上位約11%に位置する。統計的外れ値（|z|>2）ではないが、要因分析が推奨される水準。"
}
```

**UI:** 正規分布曲線に市町村の位置をマーキング。

#### (3) 直接法による年齢調整率

**入力:** `care_cert_anonymized` の年齢階級別認定者数と被保険者数、標準人口（国勢調査）

**計算:**
```
粗認定率 = 認定者数合計 / 被保険者数合計
年齢調整率 = Σ(年齢階級別認定率 × 標準人口の当該年齢階級比率)
標準化比(SMR) = 実際の認定者数 / 標準認定率で期待される認定者数
```

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "年齢階級別認定率", "data": [{"age": "65-69", "rate": 0.028}, ...]},
    {"step": 2, "label": "標準人口構成", "source": "令和2年国勢調査"},
    {"step": 3, "label": "年齢調整率の計算", "formula": "ASR = Σ(r_i × w_i)"},
    {"step": 4, "label": "SMR", "formula": "SMR = 観察数 / 期待数", "value": 1.12}
  ],
  "results": {
    "crude_rate": 0.224, "age_standardized_rate": 0.198,
    "smr": 1.12, "smr_ci95": [1.05, 1.19]
  },
  "interpretation": "年齢構成を調整すると認定率は22.4%→19.8%に修正。御船町は高齢者の年齢構成が他と比べて後期高齢者の割合が高いことが高い粗認定率の主因。年齢調整後も全国平均（17.5%）を上回る（SMR=1.12）。"
}
```

#### (4) ギャップ優先度スコア（多基準スコアリング）

**計算:**
```
priority_score = w₁ × (gap_ratio) + w₂ × (affected_population_ratio) + w₃ × (urgency_score)
gap_ratio = |gap_value| / target_value
affected_population_ratio = affected_population / insured_count
urgency_score = {worsening: 1.0, stable: 0.6, improving: 0.3, unknown: 0.5}
デフォルト重み: w₁=0.4, w₂=0.4, w₃=0.2（ユーザーが調整可能）
```

**UI:** 重みのスライダー + バブルチャート（x軸: Gap率, y軸: 影響人数, バブルサイズ: 優先度スコア）

---

### 4-B. Module 3: 課題仮説設定

#### (1) 指標間相関分析

**入力:** Module 2 の gap_analyses テーブルから全指標の時系列データ

**計算:** Pearson相関係数行列。n<30の場合はSpearmanも併記。

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "データ行列", "shape": "5×8（5年×8指標）"},
    {"step": 2, "label": "Pearson r の計算", "formula": "r = Σ(x-x̄)(y-ȳ) / √[Σ(x-x̄)²Σ(y-ȳ)²]"},
    {"step": 3, "label": "有意性検定", "formula": "t = r√(n-2)/√(1-r²), df=n-2"},
    {"step": 4, "label": "相関行列", "matrix": {"認定率vs閉じこもり": 0.87, ...}}
  ],
  "results": {"correlation_matrix": {...}, "significant_pairs": [...]},
  "interpretation": "認定率と閉じこもり割合の相関が最も強い（r=0.87, p=0.026）。これらは共通の真因を持つ可能性が高い。"
}
```

**UI:** 相関係数ヒートマップ。クリックすると散布図を表示。

#### (2) ロジックツリーのエビデンス強度スコア

各「なぜ？」リンクにエビデンスを紐づけ、以下のスコアリングを実施する。

```
エビデンスレベル:
5: ランダム化比較試験（RCT）・システマティックレビュー
4: コホート研究・前後比較（対照群あり）
3: 症例対照研究・JAGES等の観察研究
2: 専門家意見・既存計画の評価結果
1: 担当者の定性的判断・ヒアリング

リンク強度 = 最高エビデンスレベル × 一致エビデンス数の加重平均
```

**UI:** ロジックツリーの各矢印に★（1〜5）を表示。★3未満のリンクにはオレンジ色のバッジ「根拠要補強」を表示。

---

### 4-C. Module 5: プログラム評価

#### (1) 前後比較分析

**入力:** 施策開始前後の指標値（`care_insurance_report` の時系列）

**計算:**
```
変化量 = Y_post - Y_pre
対応のある t 検定: t = d̄ / (S_d / √n)
効果量 Cohen's d = d̄ / S_d
```

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "施策前後の値", "pre": [20.1, 20.8, 21.3], "post": [20.5, 21.1, 21.9]},
    {"step": 2, "label": "差分 d_i", "values": [0.4, 0.3, 0.6], "mean_d": 0.43},
    {"step": 3, "label": "標準偏差 S_d", "value": 0.153},
    {"step": 4, "label": "t統計量", "formula": "t = 0.43 / (0.153/√3)", "t": 4.87, "df": 2},
    {"step": 5, "label": "p値（両側）", "p_value": 0.040},
    {"step": 6, "label": "効果量 Cohen's d", "value": 2.81, "interpretation": "大きい効果"}
  ],
  "results": {"mean_change": 0.43, "t_stat": 4.87, "p_value": 0.040, "cohens_d": 2.81, "is_significant": true},
  "interpretation": "施策前後で認定率が平均0.43ポイント上昇。対応のあるt検定により変化は統計的に有意（p=0.040）。ただし、施策以外の要因（人口動態変化等）の影響を排除できていないため解釈に注意が必要。"
}
```

#### (2) 差分の差分法（DiD）— 比較市町村データがある場合

**入力:** 処置群（御船町）と対照群（比較市町村）の前後データ（`mieruka_export` から取得）

**計算:**
```
DiD = (Y_T_post - Y_T_pre) - (Y_C_post - Y_C_pre)
SE_DiD = √(σ_T_post² + σ_T_pre² + σ_C_post² + σ_C_pre²)
t_DiD = DiD / SE_DiD
```

**出力:** 4セルDiD表 + 推定された施策効果の信頼区間

**UI:** 2グループの折れ線グラフ（施策介入時点に縦線）+ DiD推定値と信頼区間の表示

---

### 4-D. Module 6: コストと効率性の評価

#### (1) 感度分析（トルネードチャート）

**入力:** コスト比率の全パラメータの基準値

**計算:**
```
各パラメータ p_i を -20%, -10%, +10%, +20% 変化させた場合のコスト比率を計算
影響幅 = max(CR_high, CR_low) - min(CR_high, CR_low)
パラメータを影響幅の大きさで降順ソート
```

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "基準値でのコスト比率", "base_cr": 72.4},
    {"step": 2, "label": "各パラメータの変化に対する感度",
     "results": [
       {"param": "delta_cert_rate", "impact_range": [58.3, 90.1], "impact_width": 31.8},
       {"param": "unit_benefit", "impact_range": [66.1, 80.2], "impact_width": 14.1},
       ...
     ]}
  ],
  "interpretation": "コスト比率に最も大きく影響するパラメータはΔ認定率（±10%の変化でコスト比率が±15.9ポイント変動）。このパラメータの設定根拠の確認が最も重要。"
}
```

**UI:** 水平方向のトルネードチャート（影響幅が大きいパラメータが上）

#### (2) モンテカルロシミュレーション

**入力:** 各ΔパラメータとCSV正規分布仮定（σ = μ × CV, デフォルトCV=0.15）

**計算:**
```
N=10,000回のシミュレーション
各回: Δcert ~ N(μ, σ²), Δrecep ~ N(μ, σ²), Δunit ~ N(μ, σ²) からサンプリング
→ コスト比率を計算
結果: コスト比率の分布統計
P(CR ≤ 100%) = 100以下となる割合
```

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "分布仮定", "cv": 0.15},
    {"step": 2, "label": "シミュレーション回数", "n": 10000},
    {"step": 3, "label": "結果の分布統計",
     "mean": 73.2, "sd": 18.4, "p5": 44.1, "p25": 60.1, "p75": 84.2, "p95": 108.3}
  ],
  "results": {
    "mean_cr": 73.2, "sd_cr": 18.4,
    "ci95_lower": 44.1, "ci95_upper": 108.3,
    "prob_below_100": 0.847
  },
  "interpretation": "モンテカルロシミュレーション（10,000回）によると、コスト比率は平均73.2%（95%CI: 44.1〜108.3%）。コスト比率が100%以下となる確率は84.7%。"
}
```

**UI:** コスト比率のヒストグラム（100%のラインを赤い縦線で表示）+ 採算確率の大きな数字表示

---

### 4-E. Module 7: サービス見込量管理

#### (1) Oaxaca-Blinder分解（乖離要因の定量分析）

**計算:**
```
給付費乖離 = 実績 - 計画
= [N_actual × r_actual × c_actual] - [N_plan × r_plan × c_plan]

3要因分解:
人口要因 = (N_actual - N_plan) × r_plan × c_plan
受給率要因 = N_plan × (r_actual - r_plan) × c_plan
単価要因 = N_plan × r_plan × (c_actual - c_plan)
交互作用項 = 残差
```

**出力:**
```json
{
  "calculation_steps": [
    {"step": 1, "label": "給付費乖離（総額）", "value": -12000000, "unit": "円/年"},
    {"step": 2, "label": "人口要因", "value": -3200000, "pct": 26.7},
    {"step": 3, "label": "受給率要因", "value": -5800000, "pct": 48.3},
    {"step": 4, "label": "単価要因", "value": -2100000, "pct": 17.5},
    {"step": 5, "label": "交互作用項", "value": -900000, "pct": 7.5}
  ],
  "interpretation": "給付費乖離-1,200万円のうち約48%が受給率の低下（計画より利用率が低い）に起因。次に人口減少（27%）が影響している。受給率低下の要因分析（サービス代替・人材不足等）が優先課題。"
}
```

**UI:** 積み上げ棒グラフ（各要因の寄与を色分け表示）

#### (2) 需要予測（指数平滑化法）

**計算:**
```
単純指数平滑: F_{t+1} = α × Y_t + (1-α) × F_t  (α: 平滑化パラメータ, 最適値をAIC最小化で選択)
線形トレンド付き: Holt法
予測信頼区間: 残差の標準誤差から計算
```

**UI:** 実績値 + 3年間予測（点予測 + 80%/95%CI帯）の時系列グラフ

---

## 5. 統計分析UIの共通仕様

### 5-A. 計算過程パネル（`StatCalcStepsPanel`）

**ファイル:** `components/stats/StatCalcStepsPanel.tsx`

```
┌─────────────────────────────────────────────────────────┐
│  トレンド回帰分析                              [計算過程を表示 ▼]│
├─────────────────────────────────────────────────────────┤
│  [結果サマリー]                                           │
│  認定率は年間+0.78ポイントの上昇傾向（p=0.023, R²=0.92）    │
│  95%CI: [0.14, 1.42]                                    │
│                                                         │
│  ─── 計算過程 ───────────────────────────── (折りたたみ) │
│  Step 1: データ確認                                       │
│          n=5, Y=[19.2, 20.1, 21.3, 21.0, 22.4]         │
│  Step 2: 最小二乗法 β = (X'X)⁻¹ X'Y                     │
│          ... [行列計算の展開]                              │
│  Step 3: 回帰係数 α=17.4, β=0.78                         │
│  ...                                                    │
│                                                         │
│  ─── 注意事項 ──────────────────────────────────────    │
│  ⚠ n=5は小標本のため、p値の信頼性に注意。追加データの収集を推奨。│
└─────────────────────────────────────────────────────────┘
```

- 計算過程はデフォルト折りたたみ（`[計算過程を表示]` ボタン）
- 各Stepは数式（LaTeX形式を `KaTeX` でレンダリング）と実際の数値を並記
- `caveats` フィールドの内容を黄色の注意ボックスで表示
- 「この分析をCSVでエクスポート」ボタン（`input_data` + `results` を出力）

### 5-B. AI支援の統計解釈

統計分析結果を生成した後、以下のAPIで自然言語解釈を生成する。

**API:** `POST /api/projects/[id]/stats/[analysisId]/interpret`

```typescript
// Anthropic API へのプロンプト
const prompt = `
あなたは地域包括ケアの専門家として、以下の統計分析結果を行政担当者向けに解釈してください。

分析種別: ${analysis_type}
指標名: ${indicator_name}
分析結果: ${JSON.stringify(results)}

以下の形式で回答してください:
1. 結果の要約（2文以内）
2. 政策的含意（この結果が計画策定上どう重要か）
3. 解釈上の注意点（統計的限界・代替説明）
`;
```

---

## 6. 更新が必要な各モジュール画面の仕様追加

### Module 2: ギャップ分析ページへの追加要素

指標ごとのテーブル行に「統計分析」ボタンを追加する。
クリックすると統計分析パネル（アコーディオン）が展開し、トレンド回帰・Zスコア・年齢調整率の3つの分析を表示する。
`ArtifactLineagePanel` をページ右サイドバーに配置する。

### Module 3: 課題仮説ページへの追加要素

指標間相関ヒートマップを課題仮説一覧の上部に配置する（「共通根拠の発見に活用してください」の説明付き）。
ロジックツリーの各矢印に証拠強度スター（★1〜5）を表示し、★3未満の場合にオレンジバッジ「根拠要補強」を表示する。

### Module 4: ロジックモデルページへの追加要素

各ノード（課題・真因・主要施策）の入力ソース（Module 3の課題仮説シートID）を表示する。
「この課題はどの問題から来ているか」「この真因はどのギャップ分析に基づくか」をクリックで確認できる「トレース」ボタンを各ノードに追加する。

### Module 5: プログラム評価ページへの追加要素

評価実施時に「統計分析を実行」ボタンを表示する。
前後比較分析またはDiD分析の結果を `StatCalcStepsPanel` で表示する。
比較市町村データが `mieruka_export` に含まれている場合のみDiDを有効化する。

### Module 6: コストと効率性の評価ページへの追加要素

計算機入力フォームの下に以下を追加する:
- 「感度分析を実行」ボタン → トルネードチャートを表示
- 「モンテカルロシミュレーション（10,000回）を実行」ボタン → ヒストグラムと採算確率を表示
- 「ロジックモデルから数値を取り込む」ボタン → `logic_models` テーブルの `inputs` フィールドから投入金額を自動入力

### Module 7: サービス見込量ページへの追加要素

乖離分析テーブルの各行に「要因分解分析」ボタンを追加する。
クリックすると Oaxaca-Blinder 分解の積み上げ棒グラフと計算ステップパネルを表示する。
ページ下部に「3年間需要予測」セクションを追加し、指数平滑化予測グラフを表示する。

---

## 7. 追加の実装手順

v2 の STEP 1〜12 に加えて、以下を追加すること。

### STEP 13: リネージ基盤
1. `infra/migrations/008_artifact_lineage.sql` を作成・適用する
2. `lib/modules/causal-graph.ts` を作成する（CAUSAL_EDGES, INCOMPATIBLE_PAIRS の定義）
3. `lib/modules/compatibility-checker.ts` を作成する
4. `components/lineage/ArtifactLineagePanel.tsx` を作成する
5. `app/(admin)/projects/[id]/lineage/page.tsx` を作成する（react-flow使用）

### STEP 14: 非互換性チェックのUI組み込み
1. テンプレートエディタのモジュールトグルに `checkModuleCompatibility` を組み込む
2. プロジェクト設定のモジュール画面にも同様に組み込む
3. モジュール相関図タブを設定画面に追加する（有向グラフ・非互換エッジは赤破線）

### STEP 15: 統計分析フレームワーク
1. `lib/stats/` ディレクトリを作成し、以下のファイルを実装する:
   - `trend-regression.ts` — 最小二乗線形回帰
   - `z-score.ts` — Zスコアベンチマーク
   - `age-standardization.ts` — 直接法・間接法（SMR）
   - `gap-priority-scoring.ts` — 多基準スコアリング
   - `correlation-matrix.ts` — Pearson/Spearman相関
   - `pre-post-comparison.ts` — 対応のあるt検定・Cohen's d
   - `diff-in-diff.ts` — DiD推定
   - `sensitivity-analysis.ts` — パラメータ感度分析
   - `monte-carlo.ts` — モンテカルロシミュレーション（Web Workers で非同期実行）
   - `oaxaca-blinder.ts` — 3要因分解
   - `demand-forecast.ts` — Holt指数平滑化
2. `components/stats/StatCalcStepsPanel.tsx` を作成する（KaTeX使用）
3. `components/stats/TornadoChart.tsx` を作成する（recharts使用）
4. `components/stats/MonteCarloHistogram.tsx` を作成する（recharts使用）
5. `app/api/projects/[id]/stats/` 以下の各エンドポイントを実装する

### STEP 16: モジュール画面への統計分析組み込み
Module 2〜7 の各画面に、STEP 15 で作成したコンポーネントを組み込む。
リネージパネルも各画面のサイドバーに追加する。

---

## 8. ライブラリ依存関係の追加

`app/package.json` に以下を追加すること:
```json
{
  "dependencies": {
    "katex": "^0.16.x",
    "react-katex": "^3.0.x",
    "reactflow": "^11.x",
    "@dnd-kit/core": "^6.x",
    "@dnd-kit/sortable": "^7.x"
  }
}
```

KaTeX はサーバーコンポーネントでのレンダリングに対応しているため、SSR可能。
モンテカルロシミュレーション（10,000回）は `new Worker()` を使ってメインスレッドをブロックしないよう実装すること。
