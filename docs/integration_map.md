# GovLink AI — データ連携 統合マップ（設計 vs 実装）

> 最終更新: 2026-05-31
> R1〜R4 フェーズの実装結果を反映。各フェーズの詳細は `docs/REBUILD_PLAN.md` を参照。

---

## モジュール間データ連携の実装状況

| 連携（from → to） | 設計上の想定 | 実装状態 | 実装手段 | 備考 |
|---|---|---|---|---|
| **dataset_manager → gap_analysis** | データセットを読んでギャップ分析を生成 | ✅ 実装済み | `gap-analysis/ai-analyze` が `project_datasets` を読んで `gap_analyses` を生成。`source_datasets_snapshot` に更新日時を記録 | ⚙️ `module_artifacts` 登録済み（R2） |
| **gap_analysis → issue_hypothesis** | ギャップの指標値を課題仮説のAI提案に渡す | ✅ 実装済み | `issue-hypothesis/ai-suggest` が `gap_analyses` を読んで `root_cause`/`proposed_measures` を提案。手動登録時も `gap_analysis_id` を保持 | ⚙️ `source_artifact_ids` に gap 成果物IDを記録（R2） |
| **issue_hypothesis → logic_model** | 課題仮説の内容をロジックモデル生成プロンプトに注入 | ✅ 実装済み | `generate-logic-model` に `issueHypothesisId` を追加。`title`/`description`/`root_cause`/`proposed_measures` をプロンプトに注入。生成行に `issue_hypothesis_id` を保存 | ⚙️ R2 / 🔒 R4 / FK 制約は 015 マイグレーションで追加 |
| **logic_model → program_evaluation** | ロジックモデルの成果指標（outputs/outcomes）を評価対象として引き継ぐ | ✅ 実装済み | `evaluations` GET で `logic_models` を LEFT JOIN。`upstream_logic_model` として outputs/initial_outcomes/intermediate_outcomes を返す | ⚙️ R2 / 🔒 R4 |
| **logic_model（投入額）→ cost_efficiency** | ロジックモデルの inputs をコスト計算のプリフィルに渡す | ✅ 実装済み | `cost-efficiency` GET で `program_evaluations → logic_models` を二段階 JOIN。`upstream_logic_model_prefill.inputs` を返す | ⚙️ R2 / 🔒 R4 |
| **program_evaluation（実績）→ cost_efficiency（事後）** | 評価実績から `actual_total_reduction`/`actual_cost_ratio` を算定 | ✅ 実装済み | `evaluation_type='ex_post'` 作成時に `program_evaluations.achievement_rate` から自動算定。GET で `upstream_program_evaluation` を返す | ⚙️ R2 / 🔒 R4 |
| **program_evaluation → self_evaluation** | 評価結果（result/improvement_actions/next_steps）を自己評価のコンテキストに渡す | ✅ 実装済み | `self-evaluation` GET で `program_evaluations` を LEFT JOIN。`upstream_program_evaluation` を返す | ⚙️ R2 / 🔒 R4 |
| **dataset_manager → service_volume** | CAUSAL_EDGES で定義された連携 | ⚙️ 成果物連鎖記録のみ | `service_volume` POST 時に `module_artifacts` へ登録。ただし `service_volume_plans` はデータセットを読まない | データフロー（R1）は未実装 |
| **knowledge → 各 AI モジュール** | ナレッジ辞書（Tier1/2）を AI プロンプトに注入 | ✅ 実装済み | `lib/knowledge-context.ts` の `getKnowledgeContext()` が `project_knowledge_links` + `knowledge_dicts` を読み、`gap-analysis/ai-analyze` と `generate-logic-model` のプロンプトに注入 | R1 以前から稼働 |

---

## RBAC 適用状況（R4）

| モジュール | GET（view） | POST/PATCH（edit） | DELETE（edit） | AI 生成（edit） |
|---|---|---|---|---|
| gap_analysis | 🔒 | 🔒 | 🔒 | 🔒（ai-analyze） |
| issue_hypothesis | 🔒 | 🔒 | 🔒 | 🔒（ai-suggest） |
| logic_model | 🔒 | 🔒 | — | 🔒（ai-generate） |
| program_evaluation | 🔒 | 🔒 | 🔒 | — |
| cost_efficiency | 🔒 | 🔒 | — | — |
| service_volume | 🔒 | 🔒 | — | — |
| self_evaluation | 🔒 | 🔒 | — | — |

> **権限バイパス:** `isOrgAdmin`（rank ≤ 10）または `role='admin'` のユーザーは
> DB 照会なしで全操作が許可される（後方互換）。

---

## 成果物連鎖（module_artifacts）の登録状況（R2）

| モジュール | artifact_type | source_artifact_ids | source_datasets_snapshot |
|---|---|---|---|
| gap_analysis | `gap_table` | （なし） | ✅ 全データセットの updated_at を記録 |
| issue_hypothesis | `hypothesis_sheet` | gap_analysis の成果物ID | — |
| logic_model（手動） | `logic_model_v1` | issue_hypothesis の成果物ID | — |
| logic_model（AI生成） | `logic_model_v1` | issue_hypothesis の成果物ID | — |
| program_evaluation | `process_eval` / `initial_outcome_eval` / `intermediate_outcome_eval` | logic_model の成果物ID | — |
| cost_efficiency | `cost_ratio_calc_ex_ante` / `cost_ratio_calc_ex_post` | program_evaluation + logic_model の成果物ID | — |
| service_volume | `deviation_analysis` | （なし） | — |
| self_evaluation | `self_eval_sheet` | program_evaluation の成果物ID | — |

> **陳腐化検出:** `source_datasets_snapshot` と現在の `project_datasets.uploaded_at` を比較。
> `GET /api/admin/projects/{id}/lineage` で `is_stale` フラグとして返す。

---

## 依存グラフの正本（R3）

`causal-graph.ts` が唯一の正本。DBの `plan_modules.depends_on` と
`module_incompatibility_rules` は `scripts/sync-causal-graph.ts` で同期する。

```
dataset_manager ──→ gap_analysis ──→ issue_hypothesis ──→ logic_model ──→ program_evaluation
                                                                          ├──→ cost_efficiency
                                                                          └──→ self_evaluation
dataset_manager ──→ service_volume
```

モジュール選択画面（`projects/[id]/settings/modules`）と
テンプレート編集画面（`templates/[id]/edit`）で `checkModuleCompatibility` が呼ばれ、
依存欠落・非互換の警告を表示する。

---

## ⚠ 注記: テンプレートモジュールと EBPM 評価チェーンの二重体系

現在、システム内に **2種類の「モジュール」体系** が混在している:

| 体系 | モジュールID 例 | 管理場所 | 用途 |
|---|---|---|---|
| **テンプレートモジュール** | `kpi`, `logic_model`, `schedule`, `evidence`, `ebpm`, `documents`, `post`, `resources` | `plan_templates.module_config` (JSONB) | テンプレートが提供するプロダクト機能のON/OFF |
| **EBPM 評価チェーンモジュール** | `dataset_manager`, `gap_analysis`, `issue_hypothesis`, `logic_model`, `program_evaluation`, `cost_efficiency`, `service_volume`, `self_evaluation` | `plan_modules` テーブル / `project_module_configs` | 評価フローの各ステップのON/OFF |

`logic_model` のみが両体系に存在するが、その意味合いが異なる。
両体系の統合（ID 体系の統一・依存関係の一本化）は将来課題とする。

---

## 参照整合性の状態（R5）

| テーブル.列 | FK 制約 | 状態 |
|---|---|---|
| `logic_models.issue_hypothesis_id` | `REFERENCES issue_hypotheses(id) ON DELETE SET NULL` | 🔧 `015_fk_integrity.sql` で追加（要適用） |
| `issue_hypotheses.gap_analysis_id` | `REFERENCES gap_analyses(id)` | ✅ 010 で追加済み |
| `program_evaluations.logic_model_id` | `REFERENCES logic_models(id)` | ✅ 010 で追加済み |
| `cost_efficiency_records.program_evaluation_id` | `REFERENCES program_evaluations(id)` | ✅ 010 で追加済み |
| `self_evaluation_sheets.program_evaluation_id` | `REFERENCES program_evaluations(id)` | ✅ 010 で追加済み |
| `module_artifacts.(project_id, module_id, artifact_record_id)` | `UNIQUE` 制約 | ✅ 014 で追加済み |

---

## 旧マップ（原文保存）

以下は初期設計段階のマッピング情報。現在の実装とは乖離があるが、
設計意図の参照用として残す。

### 前提：既存GovLinkの確認済み実装状況

| 機能 | 実装状況 | 既存テーブル/ファイル |
|---|---|---|
| 認証（Cognito） | ✅ 完成 | なし（NextAuth経由） |
| 政策管理 | ✅ 完成 | `projects` |
| KPI管理 | ✅ 完成 | `kpis` |
| 進捗報告 | ✅ 完成 | `posts` |
| **ロジックモデル（AI生成）** | ✅ 完成 | `logic_models`（既存スキーマ） |
| **5階層プログラム評価** | ✅ 完成 | `program_evaluations` |
| スケジュール管理（ガントチャート） | ✅ 完成 | `project_schedules`, `schedule_tasks` |
| 組織リソース管理 | ✅ 完成 | `org_resources` |
| ドキュメント管理（S3） | ✅ 完成 | `documents` |
| エビデンス管理 | ✅ 完成 | `evidences` |
| EBPMダッシュボード | ✅ 完成 | `benchmark_values`, `policy_suggestions` |
| e-Stat / RESAS連携 | ✅ 完成 | `benchmark_values` |
| 住民向け公開フィード | ✅ 完成 | `posts` |
