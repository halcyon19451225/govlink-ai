# GovLink AI — データ連携 修復計画（スクラップアンドビルド）

> 作成日: 2026-05-31
> 前提資料: [docs/CURRENT_STATE_ANALYSIS.md](./CURRENT_STATE_ANALYSIS.md)（棚卸しレポート）
> 本タスクの範囲: **設計文書の作成のみ。コード本体は一切修正しない。**
> 本書は実装フェーズの「設計の正本」とし、各フェーズ着手時にここを参照する。

---

## 0. 確定方針（再掲）

| # | 方針 | 要旨 |
|---|---|---|
| **方針1** | 成果物連鎖（`module_artifacts`）を**活かす** | 各モジュールがWRITE時に成果物を登録し、`source_artifact_ids` で上流を辿る。`ArtifactLineagePanel`・lineage ページを `module_artifacts` 基準に再構築 |
| **方針2** | `causal-graph.ts` を依存グラフの**正本**とする | `CAUSAL_EDGES` を唯一の正本とし、DBの `plan_modules.depends_on`・`module_incompatibility_rules` をそこから生成・同期。`compatibility-checker.ts` をUIから実呼び出し |
| **方針3** | RBAC を**全モジュールAPIに効かせる** | `requireModulePermission` ガードを全データ操作APIで呼ぶ |

---

## 1. フェーズ依存関係と推奨実施順

```
R1 (評価チェーンのデータフロー)
   └─▶ R2 (成果物連鎖)   ※R2はR1のデータフローを前提とする

R3 (causal-graph 正本化)  ── 独立して実施可能
R4 (RBAC接続)             ── 独立して実施可能
R5 (整合性の総仕上げ)      ── 最後

推奨実施順:  R1 → R2 → R4 → R3 → R5
```

| フェーズ | 依存 | 並行可否 |
|---|---|---|
| R1 | なし | — |
| R2 | **R1完了が前提**（成果物登録は上流データフローが動いていること前提）| R1後 |
| R3 | なし（独立）| R1/R2/R4と並行可 |
| R4 | なし（独立）| R1/R2/R3と並行可 |
| R5 | R1〜R4の結果を踏まえる | 最後 |

> 推奨順の意図: まず価値の根幹（R1）→ それを可視化（R2）→ セキュリティ穴を塞ぐ（R4、独立で早めに）→ 設計重複の解消（R3）→ 最後に整合性とドキュメント（R5）。

---

## フェーズ R1: 評価チェーンのデータフロー実装【最優先】

### 目的
棚卸しレポートの **H-1 / H-2 / H-3 / M-1 / M-2 / M-3** を解消する。
現状「FK列はあるが値が手動・上流の中身が読まれない」状態を、
**上流レコードをサーバー側で実際に読み込み、下流の生成・計算・プリフィルに反映する**状態へ変える。
各下流モジュールの GET は上流を JOIN し、UI に「どの値を引き継いだか」を提示する。

### 対象ファイル
- `app/src/app/api/ai/generate-logic-model/route.ts`（入力に課題仮説を追加）
- `app/src/app/api/admin/projects/[id]/logic-model/ai-generate/route.ts`（forwardBody 拡張）
- `app/src/app/api/admin/projects/[id]/logic-model/route.ts`（GET で issue_hypotheses を JOIN）
- `app/src/app/api/admin/projects/[id]/issue-hypothesis/route.ts`（AI提案で gap を読む。新設の ai-suggest が必要なら追加）
- `app/src/app/api/admin/projects/[id]/gap-analysis/route.ts`（GET 出力に下流が使う指標値を含める）
- `app/src/app/api/admin/projects/[id]/evaluations/route.ts`（GET で logic_models を JOIN、成果指標引き継ぎ）
- `app/src/app/api/admin/projects/[id]/cost-efficiency/route.ts`（GET で logic_models.inputs / program_evaluations.result を JOIN しプリフィル）
- `app/src/app/api/admin/projects/[id]/self-evaluation/route.ts`（GET で program_evaluations を JOIN）
- 対応する各ページ（`app/src/app/(admin)/projects/[id]/<module>/`）の「引き継ぎ値」表示UI

### 実装内容（連携ごと）

#### R1-1. issue_hypothesis → logic_model（H-1）
- `generate-logic-model` の入力 zod スキーマに `issueHypothesisId`（任意）を追加。
- 受領時、`issue_hypotheses` から該当行（`title` / `description` / `root_cause` / `root_cause_tree` / `proposed_measures`）を読み、SYSTEM_PROMPT に「課題仮説コンテキスト」として注入。
  - ※棚卸しレポートの「problem/challenge」は `issue_hypotheses` ではなく `logic_models` 側の列。課題仮説テーブルの実列は `title / description / root_cause / proposed_measures`。これらを使う。
- `saveLogicModel` の INSERT に `issue_hypothesis_id` を含め、**生成されたロジックモデルに必ず課題仮説IDを設定**する（現状は未設定）。
- `logic-model/ai-generate` の `forwardBody` に `issueHypothesisId` を中継。

#### R1-2. gap_analysis → issue_hypothesis（M-1）
- 課題仮説のAI提案エンドポイント（`issue-hypothesis/ai-suggest` を新設、または既存POSTにモード追加）で、指定 `gap_analysis_id` の `gap_analyses` 行（指標名・現状値・目標値・ギャップ量等）を読み、AIに渡して `root_cause` / `proposed_measures` を提案。
- 採用時、`issue_hypotheses.gap_analysis_id` を保存（手動指定ではなく提案元から自動設定）。

#### R1-3. logic_model → program_evaluation（M-2）
- `evaluations` POST/GET で `logic_model_id` に紐づく `logic_models` の成果指標（`initial_outcomes` / `intermediate_outcomes` / `outputs`）を読み、評価対象として引き継ぐ。
- GET 応答に「評価対象（ロジックモデル由来）」を含め、UIでプリフィル表示。

#### R1-4. logic_model（投入額）→ cost_efficiency（H-2）
- `cost-efficiency` の GET（または作成プリフィル用エンドポイント）で、紐づく `logic_models.inputs`（投入資源）を読み、`labor_cost` / `operating_cost` のプリフィル候補として返す。
- UIで「ロジックモデルの投入資源から自動算定」ボタン/初期値を提示。

#### R1-5. program_evaluation（実績）→ cost_efficiency（事後評価）（H-3）
- `cost_efficiency_records.evaluation_type = 'ex_post'` 作成時、`program_evaluation_id` 経由で `program_evaluations.result`（実績値）を読み、`actual_total_reduction` / `actual_cost_ratio` の算定に渡す。
- 事前（ex_ante）と事後（ex_post）の比較表示をUIに追加。

#### R1-6. program_evaluation → self_evaluation（M-3）
- `self-evaluation` GET で `program_evaluation_id` に紐づく `program_evaluations`（result / improvement_actions / next_steps）を読み、自己評価記入時のコンテキストとして返す。
- UIに「プログラム評価結果（参考）」セクションを表示。

### 完了条件
- [ ] ロジックモデルAI生成で課題仮説の内容がプロンプトに反映され、生成行の `issue_hypothesis_id` が非NULLで保存される。
- [ ] 課題仮説のAI提案がギャップ分析の指標値を入力として使用する。
- [ ] プログラム評価がロジックモデルの成果指標を評価対象として引き継ぐ。
- [ ] コスト効率の作成時、ロジックモデルの投入額がプリフィルされる。
- [ ] 事後コスト効率がプログラム評価の実績から算定される（ex_ante/ex_post比較が表示される）。
- [ ] 自己評価画面にプログラム評価結果が引き継ぎ表示される。
- [ ] 各下流モジュールのGETが上流をJOINし、UIに「引き継いだ値」が明示される。

---

## フェーズ R2: 成果物連鎖（module_artifacts）の実装

### 目的
方針1。棚卸しレポートの **H-4 / M-5 / L-3** を解消。
空テーブル状態の `module_artifacts` を実稼働させ、成果物のリネージ（上流・下流の追跡）と
陳腐化検出を機能させる。**R1で実装した上流→下流のデータフローを「誰が何から生成したか」として記録する。**

### 対象ファイル
- `app/src/lib/modules/recordArtifact.ts`（**新設**：共通登録ヘルパ）
- `app/src/lib/modules/artifact-types.ts`（**新設**：`artifact_type` 定義の正本）
- 各モジュールのWRITE箇所（R1対象APIと同じ群：gap-analysis / issue-hypothesis / logic-model / evaluations / cost-efficiency / service-volume / self-evaluation、および `generate-logic-model`）
- `app/src/app/api/admin/projects/[id]/stats/zscore/route.ts`・`.../stats/trend/route.ts`（`artifact_id` 紐付け）
- `app/src/components/lineage/ArtifactLineagePanel.tsx`（**作り直し**）
- `app/src/app/(admin)/projects/[id]/lineage/page.tsx`・`LineageGraphClient.tsx`（**作り直し**）

### 実装内容

#### R2-1. 共通ヘルパ `recordArtifact.ts`
```
recordArtifact({
  projectId, checkpointId, moduleId,
  artifactType,            // artifact-types.ts の定数
  artifactRecordId,        // 各モジュールが作成したレコードのID
  sourceArtifactIds,       // 上流 module_artifacts.id の配列
  sourceDatasetsSnapshot,  // { dataset_def_id: uploaded_at_iso } 陳腐化検出用
  derivationNote,          // 「○○の現状値から△△を特定」等
  evidenceId?,             // 任意
}) => artifactId
```
- 各モジュールのWRITE（INSERT/更新）成功直後にトランザクション内で呼ぶ。
- 同一 `(project_id, module_id, artifact_record_id)` の再生成時は UPDATE（upsert）方針とし、`updated_at` を更新。

#### R2-2. `artifact_type` 一覧の定義（SPEC §2-A 準拠）
| module_id | artifact_type |
|---|---|
| gap_analysis | `gap_table`, `swot_matrix`, `priority_gap_list` |
| issue_hypothesis | `hypothesis_sheet`, `logic_tree` |
| logic_model | `logic_model_v{n}` |
| program_evaluation | `process_eval`, `initial_outcome_eval`, `intermediate_outcome_eval` |
| cost_efficiency | `cost_ratio_calc_ex_ante`, `cost_ratio_calc_ex_post` |
| service_volume | `deviation_analysis` |
| self_evaluation | `self_eval_sheet` |

#### R2-3. `source_artifact_ids` の記録
- R1で確立した上流参照（`gap_analysis_id` / `issue_hypothesis_id` / `logic_model_id` / `program_evaluation_id`）から、対応する上流の `module_artifacts.id` を解決して配列で記録。

#### R2-4. `source_datasets_snapshot`（陳腐化検出）
- gap_analysis 等がデータセットを使う場合、使用した `project_datasets` の `dataset_def_id` と `uploaded_at` を JSON で保存。

#### R2-5. `statistical_analyses.artifact_id` の紐付け（M-5）
- stats/zscore・trend が、対象の `module_artifacts.id`（例: gap_analysis の成果物）を `artifact_id` に設定（現状は `null` 固定）。

#### R2-6. `ArtifactLineagePanel.tsx` の作り直し（L-3）
- props で `artifactId` を受け取り、`module_artifacts` を**再帰的に辿って**上流・下流を取得（専用API `api/admin/projects/[id]/lineage` を新設想定）。
- 陳腐化チェック: `source_datasets_snapshot` の時刻と現在の `project_datasets.uploaded_at` を比較し、不一致なら黄色警告「参照元が更新されました → 再分析を推奨」。
- 下流成果物が存在する場合は赤色警告「このデータを更新すると後続分析に影響します」。

#### R2-7. lineage ページの作り直し
- 現状の「FK直結JOIN」方式を廃し、`module_artifacts` を正本にした react-flow グラフへ。
- 各ノード: 成果物名・作成日・ステータス（完成/作業中/陳腐化）。各エッジ: 引き継いだデータをホバー表示。

### 完了条件
- [ ] 全7モジュールがWRITE時に `module_artifacts` へ登録する（空テーブルでなくなる）。
- [ ] `source_artifact_ids` が上流成果物IDで埋まり、再帰探索で連鎖を辿れる。
- [ ] `source_datasets_snapshot` が記録され、陳腐化警告が表示される。
- [ ] `statistical_analyses.artifact_id` が非NULLで紐付く。
- [ ] `ArtifactLineagePanel` が `module_artifacts` 基準で上流・下流・陳腐化を表示する。
- [ ] lineage ページが `module_artifacts` 基準のグラフを表示する。

---

## フェーズ R3: causal-graph.ts の正本化

### 目的
方針2。棚卸しレポートの **L-1**（依存定義の二重化・デッドコード）を解消。
`causal-graph.ts` を依存グラフの唯一の正本とし、DB側（`plan_modules.depends_on` /
`module_incompatibility_rules`）を**そこから生成・同期**する。`compatibility-checker.ts` をUIから実呼び出しする。

### 対象ファイル
- `app/src/lib/modules/causal-graph.ts`（正本。必要なら `INCOMPATIBLE_PAIRS` / 非互換メタデータを拡充）
- `app/scripts/sync-causal-graph.ts`（**新設**：DB同期スクリプト）
- `infra/migrations/010_care_plan_suite.sql`（`module_incompatibility_rules` の手書きINSERTは将来スクリプト生成に委ねる旨を注記。※マイグレーション改変は最小限）
- `app/src/lib/modules/compatibility-checker.ts`（UIから呼べるよう公開・必要なら拡張）
- `app/src/app/(admin)/projects/[id]/settings/modules/page.tsx`（互換チェック呼び出し）
- `app/src/app/(admin)/templates/[id]/edit/`（テンプレート編集画面の互換チェック呼び出し）

### 実装内容
#### R3-1. 正本の整備
- `CAUSAL_EDGES` を依存関係の単一ソースとする。`module_incompatibility_rules` 相当の
  非互換メタ（type / is_blocking / warning_message / required_intermediaries）を
  `causal-graph.ts` から導出可能な形（または同ファイル内の構造化定義）に整理。

#### R3-2. 同期スクリプト `sync-causal-graph.ts`
- `CAUSAL_EDGES` から各モジュールの `depends_on` を計算し、`plan_modules.depends_on` を UPDATE。
- 非互換ルールを生成し `module_incompatibility_rules` を洗い替え（truncate→insert もしくは upsert）。
- べき等に実行可能とし、CI/デプロイ手順に組み込む想定を記述。

#### R3-3. 互換チェックのUI接続
- モジュール選択画面（settings/modules）とテンプレート編集画面で `checkModuleCompatibility(selectedIds)` を呼ぶ。
- `missingDeps`（依存欠落）/ `incompatiblePairs`（非互換）を警告表示。`is_blocking` の場合は保存をブロック。

### 完了条件
- [ ] `causal-graph.ts` が import され実際に使われる（デッドコードでなくなる）。
- [ ] `sync-causal-graph.ts` 実行で `plan_modules.depends_on` と `module_incompatibility_rules` が `CAUSAL_EDGES` と一致する。
- [ ] モジュール選択画面・テンプレート編集画面で非互換/依存欠落の警告が出る。
- [ ] 依存定義の正本が1箇所（`causal-graph.ts`）に統一される。

---

## フェーズ R4: RBAC のモジュールAPI接続

### 目的
方針3。棚卸しレポートの **X-1**（RBACがモジュールAPIで未適用＝権限機能の形骸化）を解消。
全データ操作APIに権限ガードを通し、細粒度権限を実効化する。

### 対象ファイル
- `app/src/lib/permissions.ts`（`requireModulePermission` を追加）
- 各 `app/src/app/api/admin/projects/[id]/<module>/route.ts` および配下のサブルート
  - gap_analysis（`gap-analysis/`, `gap-analysis/[gapId]`, `gap-analysis/ai-analyze`）
  - issue_hypothesis（`issue-hypothesis/`, `issue-hypothesis/[hypId]`）
  - logic_model（`logic-model/`, `logic-model/ai-generate`）
  - program_evaluation（`evaluations/`, `evaluations/[evalId]`）
  - cost_efficiency（`cost-efficiency/`）
  - service_volume（`service-volume/`, `service-volume/[planId]`）
  - self_evaluation（`self-evaluation/`, `self-evaluation/[sheetId]`, `.../entries`）

### 実装内容
#### R4-1. ガード関数
```
requireModulePermission(
  session, projectId, moduleId: ModuleId, required: PermissionLevel
) => void | throws 403
```
- 既存 `getUserEffectivePermission(userId, projectId, moduleId)` を内部利用。
- `PERMISSION_ORDER`（none<view<edit<approve<admin）で「実効権限 ≧ 要求権限」を判定。
- 不足時は 403（`{ data: null, error: "権限がありません" }`）を返す。

#### R4-2. 各APIへの適用ルール
| HTTPメソッド | 要求権限 |
|---|---|
| GET（閲覧）| `view` |
| POST / PATCH / PUT（作成・更新）| `edit` |
| 承認・確定系（status を approved 等へ）| `approve` |
| DELETE | `edit`（または運用に応じ `approve`）|

- 各 route ハンドラ冒頭、`getServerSession` の直後に `requireModulePermission` を挿入。
- AI生成系（ai-analyze / ai-generate）は実質WRITEのため `edit` を要求。

### 完了条件
- [ ] `requireModulePermission` が `lib/permissions.ts` に存在する。
- [ ] 対象7モジュールの全 route が冒頭で権限チェックを行う。
- [ ] view権限のみのユーザーが POST/PATCH で 403 を受ける（手動/テストで確認）。
- [ ] 権限不足時に一貫して 403 と日本語エラーが返る。

---

## フェーズ R5: 参照整合性とドキュメント整合【最後の総仕上げ】

### 目的
棚卸しレポートの **M-4 / L-2 / E** を解消。参照整合性を担保し、設計と実装の記述ドリフトを解消する。

### 対象ファイル
- `infra/migrations/014_fk_integrity.sql`（**新設**：FK制約追加。※連番は実際の最新に合わせる）
- `docs/SPEC.md`（ファイル名ドリフトの注記修正）
- `docs/integration_map.md`（一枚表に更新）

### 実装内容
#### R5-1. FK制約の追加（M-4）
- `logic_models.issue_hypothesis_id` に `REFERENCES issue_hypotheses(id)` を追加（`ON DELETE SET NULL` 推奨）。
- 追加前に孤児ID（存在しない `issue_hypotheses` を指す行）のクリーンアップ手順を併記。
- ※R1で `issue_hypothesis_id` が正しく設定される前提のため、R1完了後に実施する。

#### R5-2. SPEC.md のドリフト修正（L-2）
- §2-A の「`infra/migrations/008_artifact_lineage.sql` として作成」を、実体が
  `010_care_plan_suite.sql` 内に統合されている旨に注記修正（または該当記述に注釈を付す）。

#### R5-3. integration_map.md の更新（E）
- 「設計上の連携（CAUSAL_EDGES）」と「実装済みの連携（R1/R2 完了後の実態）」を
  **明確に区別した一枚表**へ更新。各連携の状態（実装済み/参照列のみ/未実装）を列で持つ。

### 完了条件
- [ ] `logic_models.issue_hypothesis_id` にFK制約が付き、孤児IDが解消されている。
- [ ] SPEC.md のマイグレーションファイル名ドリフトが解消されている。
- [ ] integration_map.md が「設計 vs 実装」を区別した最新の一枚表になっている。

---

## 付録: 棚卸しレポート課題 → フェーズ対応表

| 課題ID（CURRENT_STATE_ANALYSIS）| 内容 | 対応フェーズ |
|---|---|---|
| H-1 | issue_hypothesis → logic_model 未実装 | R1 |
| H-2 | logic_model 投入額 → cost_efficiency 未実装 | R1 |
| H-3 | program_evaluation 実績 → cost_efficiency 事後 未実装 | R1 |
| H-4 | module_artifacts 連鎖の全面未実装 | R2 |
| M-1 | gap_analysis → issue_hypothesis 参照列のみ | R1 |
| M-2 | logic_model → program_evaluation 参照列のみ | R1 |
| M-3 | program_evaluation → self_evaluation 参照列のみ | R1 |
| M-4 | issue_hypothesis_id にFK制約なし | R5 |
| M-5 | statistical_analyses.artifact_id が常にnull | R2 |
| L-1 | causal-graph.ts がデッドコード・依存定義二重化 | R3 |
| L-2 | SPEC.md ファイル名ドリフト（008→010）| R5 |
| L-3 | ArtifactLineagePanel が設計と不一致 | R2 |
| L-4 | dataset_manager → service_volume 未連携 | R1（補）/ R3で要否確認 |
| X-1 | RBAC がモジュールAPIで未適用 | R4 |
