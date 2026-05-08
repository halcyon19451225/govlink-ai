# GovLink 既存機能 × 新機能 統合マップ

## 前提：既存GovLinkの確認済み実装状況

| 機能 | 実装状況 | 既存テーブル/ファイル |
|---|---|---|
| 認証（Cognito） | ✅ 完成 | なし（NextAuth経由） |
| 政策管理 | ✅ 完成 | `projects` |
| KPI管理 | ✅ 完成 | `kpis` |
| 進捗報告 | ✅ 完成 | `posts` |
| **ロジックモデル（AI生成）** | ✅ 完成 | `logic_models`（既存スキーマ） |
| **5階層プログラム評価** | ✅ 完成 | （UIのみ、専用テーブルは要確認） |
| スケジュール管理（ガントチャート） | ✅ 完成 | （要確認） |
| 組織リソース管理 | ✅ 完成 | （要確認） |
| ドキュメント管理（S3） | ✅ 完成 | （要確認） |
| エビデンス管理 | ✅ 完成 | `evidences`（要確認） |
| EBPMダッシュボード | ✅ 完成 | `benchmark_values`, `policy_suggestions` |
| e-Stat / RESAS連携 | ✅ 完成 | `benchmark_values` |
| 住民向け公開フィード | ✅ 完成 | `posts` |

---

## 統合判断マトリクス

| 新プロンプトの要素 | 既存との関係 | 推奨アクション |
|---|---|---|
| `plan_modules` テーブル | 完全に新規 | **新規作成** |
| `plan_templates` テーブル | 完全に新規 | **新規作成** |
| `pdca_cycle_defs` テーブル | 完全に新規 | **新規作成** |
| `project_pdca_checkpoints` | スケジュール管理と**一部重複** | **既存ガントと連携設計が必要** |
| `project_module_configs` | 完全に新規 | **新規作成** |
| `gap_analyses` | 完全に新規 | **新規作成** |
| `issue_hypotheses` | 完全に新規 | **新規作成** |
| `logic_models`（新スキーマ） | 既存 `logic_models` と**構造衝突** | **既存テーブルをマイグレーション** |
| `program_evaluations` | 既存5階層評価と**機能重複** | **既存機能をこのテーブルに移行** |
| `cost_efficiency_records` | 完全に新規 | **新規作成** |
| `service_volume_plans` | 完全に新規 | **新規作成** |
| `self_evaluation_sheets` | 完全に新規 | **新規作成** |
| `module_artifacts` | `evidences` テーブルと**関連** | **evidencesから参照する形で新規作成** |
| `statistical_analyses` | `benchmark_values` と**一部関連** | **新規作成（benchmark_valuesを入力として参照）** |
| `dataset_definitions` | 完全に新規 | **新規作成** |
| `project_datasets` | ドキュメント管理と**一部重複** | **既存ドキュメント管理と役割分担を整理** |

---

## 競合が特に深刻な3箇所と解決策

### 競合1：`logic_models` テーブルの構造衝突

**既存スキーマ（001_init.sql）:**
```sql
logic_models: id, project_id, inputs, activities, outputs, outcomes, generated_at
```

**新スキーマ（006_care_plan_suite.sql）:**
```sql
logic_models: id, project_id, issue_hypothesis_id, name, version, status,
  purpose, basic_goal, basic_ideology, current_status, problem, challenge,
  root_cause, major_policy, activities, inputs, outputs, initial_outcomes,
  intermediate_outcomes, evidence, ...
```

**解決策：** 既存テーブルをALTER TABLEで拡張するマイグレーションを作成する。
既存の `inputs`, `activities`, `outputs`, `outcomes` カラムを新フィールドに対応付ける。

```sql
-- infra/migrations/006a_migrate_logic_models.sql
ALTER TABLE logic_models
  ADD COLUMN IF NOT EXISTS issue_hypothesis_id UUID,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS version INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
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
-- 既存の outputs → outputs（JSONB化）
-- 既存の outcomes → intermediate_outcomes に移行（データ移行スクリプト別途）
```

---

### 競合2：5階層プログラム評価の重複

既存GovLinkにはプログラム評価のUI・KPI分類が実装済み。
新プロンプトは `program_evaluations` テーブルを新規作成しようとしている。

**解決策：** 既存の評価データを `program_evaluations` テーブルに移行する。
既存の評価UIを `program_evaluations` テーブルのCRUDに接続し直す。

```sql
-- 既存KPIとの橋渡し
ALTER TABLE program_evaluations
  ADD COLUMN IF NOT EXISTS kpi_ids UUID[] DEFAULT ARRAY[]::uuid[];
-- 既存kpisテーブルのID配列を持つことで、KPIの達成状況と評価を連結
```

---

### 競合3：ドキュメント管理と `project_datasets` の役割重複

既存ドキュメント管理（S3アップロード・AI要約）と新規 `project_datasets`（AIデータセット管理）は
いずれも「ファイルをS3にアップロードして管理する」機能を持つ。

**解決策：** `project_datasets` はドキュメント管理の「サブカテゴリ」として実装する。
既存ドキュメント管理UIに「このドキュメントをデータセットとして登録」ボタンを追加する形が最も自然。

---

## 推奨する実装方針の変更点

### Phase 1（DBスキーマ）の修正

現在の Phase 1 プロンプトを以下に修正する:

```
1. まず既存テーブルの現状を確認する:
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema = 'public'
   ORDER BY table_name, ordinal_position;

2. 競合する既存テーブルを新スキーマに向けてマイグレーションする（DROP→CREATEではなくALTER TABLE）:
   - logic_models: ADD COLUMN で新フィールドを追加
   - 既存データは保持する

3. 完全に新規のテーブルのみ新規作成する:
   - plan_modules, plan_templates, pdca_cycle_defs, pdca_checkpoint_defs
   - project_pdca_checkpoints, project_module_configs
   - gap_analyses, issue_hypotheses, cost_efficiency_records
   - service_volume_plans, self_evaluation_sheets
   - module_artifacts, statistical_analyses, dataset_definitions, project_datasets
   - module_incompatibility_rules

4. 既存テーブルとの連携カラムを追加する:
   - projects: plan_type, template_id, plan_start_date, plan_end_date を追加
   - program_evaluations: kpi_ids（既存kpisとの連携）を追加
   - module_artifacts: evidence_id（既存evidencesとの連携）を追加
```

### Phase 5（データセット管理）の修正

既存ドキュメント管理ページに「AIデータセットとして登録」機能を追加する形で実装する。
ゼロから新UIを作るのではなく、既存UIを拡張する。

### Phase 6（ロジックモデル）の修正

既存のロジックモデル生成ページ（AIが自動生成するUI）を
新しいビジュアルエディタに「グレードアップ」する形で実装する。
新規ページを作るのではなく、既存ページを置き換える。

### Phase 7（プログラム評価）の修正

既存の5階層評価UIを `program_evaluations` テーブルに接続し直す。
「接続し直し」であり、新規作成ではない。

---

## Phase 1 プロンプトの修正版（冒頭確認ステップを追加）

```
# Phase 1: DBスキーマ実装（既存テーブルとの統合）

## 事前確認（必須・最初に実施）

以下のクエリを実行し、既存テーブルの構造を確認してください:

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

\d logic_models
\d kpis
\d projects

確認結果をもとに、以下の判断で進めてください。

## 実施事項

### Step A: 競合テーブルのマイグレーション（ALTER TABLE）
- `logic_models` に docs/SPEC.md 記載の新フィールドを ADD COLUMN で追加
- `projects` に plan_type, template_id, plan_start_date, plan_end_date を追加
- DROP TABLE は絶対に行わない

### Step B: 完全新規テーブルの作成
docs/SPEC.md の 006_care_plan_suite.sql から、
既存テーブルと名前が重複しないものだけを CREATE TABLE する

### Step C: 連携カラムの追加
- program_evaluations に kpi_ids UUID[] を追加
- module_artifacts に evidence_id UUID REFERENCES evidences(id) を追加

### 完了確認
\d logic_models で新フィールドが追加されていることを確認
既存データが失われていないことを確認
```
