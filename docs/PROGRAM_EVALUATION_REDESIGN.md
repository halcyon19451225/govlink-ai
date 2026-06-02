# プログラム評価5階層への再設計（案B）

> 本ドキュメントは設計のみを定義する。コード本体・マイグレーション SQL の実装は含まない。
> 対象リポジトリ: `govlink-ai`　作成日: 2026-06-02

---

## 0. 目的と前提

プログラム評価は本来「5階層」を一体として扱う枠組みである。

| 階層 | 名称 | 問い |
|------|------|------|
| 第1階層 | ニーズ評価 | そもそも対応すべき課題・ニーズが存在するか |
| 第2階層 | セオリー評価 | 施策の論理（因果仮説）は妥当か |
| 第3階層 | プロセス評価 | 計画どおりに実施・運営されているか |
| 第4階層 | アウトカム・インパクト評価 | 成果（初期・中間・最終）は達成されたか |
| 第5階層 | 効率性評価 | 投入に見合う成果が得られているか（費用対効果） |

現状の GovLink AI では「コストと効率性の評価（cost_efficiency）」が
`program_evaluation` から独立したモジュールになっているが、
本来これは **第5階層（効率性評価）** である。これをプログラム評価へ統合する（案B）。

### 確定した設計方針（変更不可）

1. **モジュールの分散は維持する**（介護保険以外のドメインへの汎用性のため）。
2. **ギャップ分析（ニーズ評価）・課題仮説はロジックモデル生成までの一連の工程（Plan前半）** と位置づける。
3. **ロジックモデルを評価全体の「軸」とする**（＝問題3の解消）。
   プロセス評価・アウトカム評価・効率性評価のすべてがロジックモデルの構成要素
   （投入・活動・産出・成果）を参照する。
4. **効率性評価（旧コスト効率）をプログラム評価の第5階層に統合する**。
5. **評価の相互補完フィードバックループは今回は実装しない**（将来課題として明記のみ）。

---

## 1. 5階層と現行モジュールの対応表

| 階層 | 名称 | 工程区分 | 現行モジュール | 現行テーブル | `evaluation_tier` 値 |
|------|------|---------|----------------|--------------|----------------------|
| 第1階層 | ニーズ評価 | **Plan前半** | `gap_analysis` | `gap_analyses` | （独立モジュール）`needs`※1 |
| 第2階層 | セオリー評価 | **Plan前半** | `issue_hypothesis` → `logic_model` | `issue_hypotheses`, `logic_models` | （独立モジュール）`theory`※1 |
| 第3階層 | プロセス評価 | **Check** | `program_evaluation` | `program_evaluations` (`tier='process'`) | `process` |
| 第4階層 | アウトカム・インパクト評価 | **Check** | `program_evaluation` | `program_evaluations` (`tier IN ('outcome_initial','outcome_intermediate')`) | `outcome_initial`, `outcome_intermediate` |
| 第5階層 | 効率性評価 | **Check** | `cost_efficiency`（独立）→ 統合 | `cost_efficiency_records`（独立）→ 統合 | `efficiency`（新）／現行は `cost_efficiency` |

※1: 第1・第2階層は方針2により「Plan前半の工程」として扱う。
`program_evaluations` の `evaluation_tier` CHECK には現状 `'needs'` `'theory'` が存在するが、
実データは `gap_analyses` / `logic_models` 側で管理されており、`program_evaluations` 側の
`needs` / `theory` 行は基本生成されない（互換のため CHECK 値は残置する）。

### 現状の `evaluation_tier` 値（参考: `010_care_plan_suite.sql`）

```
'needs','theory','process','outcome_initial','outcome_intermediate','cost_efficiency'
```

本再設計では第5階層の tier 名を **`cost_efficiency` から `efficiency` へ統一**することを推奨する
（5階層の標準語彙に合わせる）。ただし互換のため CHECK には両値を当面併存させる（§6参照）。

### 工程フロー（再掲）

```
[Plan前半]  gap_analysis(第1) → issue_hypothesis(第2前段) → logic_model(第2/軸)
                                                              │
                                                              ▼ logic_model_id で参照
[Check]     program_evaluation ─┬─ process(第3)
                                ├─ outcome_initial / outcome_intermediate(第4)
                                └─ efficiency(第5) ← 旧 cost_efficiency を統合
```

---

## 2. ロジックモデルを軸にする具体的方法

### 2.1 ロジックモデルの構成要素

`logic_models` テーブル（`010_care_plan_suite.sql` で拡張済み）の主な要素:

| 区分 | カラム | 型 |
|------|--------|-----|
| 投入 (Inputs) | `inputs` | JSONB |
| 活動 (Activities) | `activities` | JSONB |
| 産出 (Outputs) | `outputs` | JSONB |
| 成果 (Outcomes) | `initial_outcomes`, `intermediate_outcomes`, `outcomes`（旧） | JSONB |
| メタ | `name`, `version`, `status`, `purpose`, `major_policy` 等 | - |

### 2.2 各評価がどの要素を参照するか

| 評価階層 | 参照するロジックモデル要素 | 用途 |
|----------|---------------------------|------|
| 第3階層 プロセス評価 | **活動 (activities) / 産出 (outputs)** | 計画した活動が実施されたか、産出量が想定どおりか |
| 第4階層 アウトカム評価 | **成果 (initial_outcomes / intermediate_outcomes)** | 初期・中間アウトカムの達成度（`achievement_rate`, `kpi_ids`） |
| 第5階層 効率性評価 | **投入 (inputs) × 成果 (outcomes)** | 投入コスト（labor/operating）と削減効果（成果側）の費用対効果 |

すべての評価行は `program_evaluations.logic_model_id` を **必須参照** とし、
ロジックモデルの該当要素を読み込んだうえで評価値を記録する。

### 2.3 `logic_model_id` 経由の読み込み方法（読み取りモデル）

`program_evaluations.logic_model_id`（既存 FK: `REFERENCES logic_models(id)`）を起点に、
評価1件ごとに対応するロジックモデルの要素をサーバ側で JOIN／取得する。

擬似クエリ（実装時の指針。本ドキュメントでは実装しない）:

```sql
SELECT pe.*,
       lm.inputs, lm.activities, lm.outputs,
       lm.initial_outcomes, lm.intermediate_outcomes
FROM program_evaluations pe
JOIN logic_models lm ON lm.id = pe.logic_model_id
WHERE pe.project_id = $1 AND pe.evaluation_tier = $2;
```

- API レスポンスは規約どおり `{ data, error }` 形式。
- 各 tier のクライアントは「ロジックモデルの該当要素ブロック（読み取り専用）」＋
  「評価入力フォーム」を縦に並べて表示する（§4）。
- `logic_model_id` が NULL の既存評価行は「軸未設定」と表示し、
  バックフィル（§6）で最新承認済みロジックモデルに紐付ける。

---

## 3. 効率性評価の統合方法（案B）

### 現状

`cost_efficiency_records` が独立テーブルとして存在する。
ただし既に `program_evaluation_id UUID REFERENCES program_evaluations(id)` の
FK 列を持っており、`program_evaluations` 側にも `evaluation_tier='cost_efficiency'` の
CHECK 値が存在する（＝弱い紐付けは既に部分的に存在）。

`cost_efficiency_records` は介護保険ドメイン固有の計算列を多数持つ:
`labor_cost`, `operating_cost`, `total_investment`(generated), `delta_cert_rate`,
`reduction_a/b/c`, `total_reduction`(generated), `cost_ratio`(generated) 等。

### 統合2案の比較

#### 案B-1: `cost_efficiency_records` を `program_evaluations` に吸収

`evaluation_tier='efficiency'` の行として `program_evaluations` に統合し、
コスト固有のフィールドを `program_evaluations` に追加（または JSONB 列 `efficiency_detail` に格納）する。

| 観点 | 評価 |
|------|------|
| データモデルの単純さ | ◎ 評価が1テーブルに集約 |
| ロジックモデル軸との整合 | ◎ 全 tier が同一構造 |
| 介護固有の計算列（generated columns） | ✕ 汎用テーブルにドメイン固有列が混入。`cost_ratio` 等の generated column を移植困難 |
| データ移行リスク | ✕ **高**。既存 `cost_efficiency_records` 全行を変換移行。generated column の再計算・型整合が必要。失敗時ロールバックが重い |
| 汎用性（方針1） | ✕ 介護固有列が共通テーブルを汚染し汎用性を損なう |
| 後方互換 | ✕ 既存 `cost-efficiency` API/UI を全面改修 |

#### 案B-2: 別テーブル維持 + 1対1強紐付け + UI統合 ★推奨★

`cost_efficiency_records` はテーブルとして維持しつつ、
`program_evaluations`（`tier='efficiency'`）と **1対1で強く紐付け**、UI をプログラム評価へ統合する。

| 観点 | 評価 |
|------|------|
| データモデルの単純さ | ○ テーブルは分かれるが関係は明確 |
| ロジックモデル軸との整合 | ◎ 親 `program_evaluation` が `logic_model_id` を持ち、効率性も軸を参照 |
| 介護固有の計算列 | ◎ generated column をそのまま温存できる |
| データ移行リスク | ◎ **低**。既存行は保持。親 `program_evaluation` 行を生成し FK で紐付けるのみ |
| 汎用性（方針1） | ◎ ドメイン固有テーブルを分離維持 = モジュール分散方針に合致 |
| 後方互換 | ◎ 既存 `cost_efficiency_records` の構造を破壊しない |

### 推奨: **案B-2**

理由:
1. **データ移行リスクが低い** — 既存 `cost_efficiency_records` の行・generated column を破壊せず温存。
2. **方針1（モジュール分散・汎用性）に合致** — 介護固有の計算列を汎用評価テーブルに混入させない。
3. **既に FK 列が存在** — `cost_efficiency_records.program_evaluation_id` が既にあり、
   1対1強紐付けへの移行コストが最小。
4. ロジックモデル軸（方針3）は親 `program_evaluation.logic_model_id` 経由で自然に満たせる。

#### 案B-2 における「強紐付け」の定義

- `cost_efficiency_records.program_evaluation_id` を **NOT NULL 化**（バックフィル後に制約付与）。
- 同 `program_evaluation_id` に対し **UNIQUE 制約**（1対1保証）。
- 対応する `program_evaluations` 行は `evaluation_tier='efficiency'` を持ち、
  集約値（`result`, `achievement_rate`, `findings` 等）は効率性レコードから導出して保持。
- `cost_efficiency_records` 単独の新規作成 API は段階的に「親評価行も同時生成する」フローへ寄せる。

---

## 4. プログラム評価モジュールのUI再設計

プログラム評価ページ（`app/(admin)/projects/[id]/program-evaluation/`）に、
5階層のうち **第3〜5階層** をタブで表示する。第1・第2階層は Plan前半の別画面
（gap-analysis / issue-hypothesis / logic-model）へのリンクとして案内する。

### タブ構成

```
[ 評価タイムライン ] [ プロセス評価 ] [ アウトカム・インパクト評価 ] [ 効率性評価 ]
```

| タブ | tier | 参照するロジックモデル要素（読み取り表示） | 主な入力 |
|------|------|------|----------|
| プロセス評価 | `process` | 活動・産出ブロック | 実施状況、findings、success/barrier factors |
| アウトカム・インパクト評価 | `outcome_initial` / `outcome_intermediate` | 成果（初期・中間）ブロック | achievement_rate、kpi_ids、result |
| 効率性評価 | `efficiency` | 投入×成果ブロック | 旧 cost-efficiency の入力フォーム（labor/operating cost, reduction 等）を移植 |

### 各タブ共通レイアウト

```
┌────────────────────────────────────────────┐
│ [ロジックモデル: <name> v<version> （軸）]   │  ← logic_model_id 経由・読み取り専用
│  該当要素ブロック（例: 活動/産出）           │
├────────────────────────────────────────────┤
│ 評価入力フォーム（当該 tier）                │
└────────────────────────────────────────────┘
```

### 効率性評価タブの移植方針

- 既存 `cost-efficiency/CostEfficiencyClient.tsx` の入力・計算表示 UI を
  効率性評価タブのコンポーネントとして移植する。
- データ取得は親 `program_evaluation`（tier='efficiency'）→ 紐付く `cost_efficiency_records` の順。
- 旧 `cost-efficiency` ページは当面リダイレクト or 互換表示として残す（§6）。

---

## 5. 実装フェーズの分割

> 各フェーズは独立 PR を想定。完了条件を満たすまで次フェーズに進まない。

### フェーズ P1: DBスキーマ変更（効率性評価の統合）

- **目的**: 案B-2 の強紐付けと tier 語彙統一の土台を作る。
- **対象ファイル**:
  - `infra/migrations/0XX_program_evaluation_redesign.sql`（新規）
- **内容**:
  - `program_evaluations.evaluation_tier` CHECK に `'efficiency'` を追加（`'cost_efficiency'` は併存）。
  - `cost_efficiency_records.program_evaluation_id` のバックフィル → NOT NULL + UNIQUE 制約付与。
  - 既存 `cost_efficiency` tier 行を `efficiency` へ更新（任意・互換維持なら据え置き）。
- **完了条件**: マイグレーション適用後、既存データが消失せず、
  全 `cost_efficiency_records` 行が一意な `program_evaluation_id` を持つ。

### フェーズ P2: 効率性評価のプログラム評価への移植

- **目的**: API レベルで効率性を `program_evaluation` 配下に統合。
- **対象ファイル**:
  - `app/src/app/api/admin/projects/[id]/cost-efficiency/route.ts`
  - `app/src/app/api/admin/projects/[id]/cost-efficiency/[recordId]/route.ts`
  - `app/src/app/api/admin/projects/[id]/evaluations/route.ts`（efficiency tier 対応）
- **内容**: 効率性レコードの新規作成時に親 `program_evaluation`(tier='efficiency') を同時生成・紐付け。
- **完了条件**: 効率性レコード作成 → 親評価行が自動生成され `{ data, error }` 形式で返る。既存 API は後方互換。

### フェーズ P3: ロジックモデルを軸にした参照表示の実装

- **目的**: 方針3。各 tier が `logic_model_id` 経由でロジックモデル要素を読み取り表示。
- **対象ファイル**:
  - `app/src/app/api/admin/projects/[id]/evaluations/route.ts`（logic_models JOIN）
  - `app/src/lib/modules/causal-graph.ts`（軸関係の明示）
- **内容**: §2.3 の読み取りモデルを実装。`logic_model_id` NULL 行のバックフィル。
- **完了条件**: 各評価 API が対応するロジックモデル要素を同梱して返す。

### フェーズ P4: プログラム評価UIの5階層タブ化

- **目的**: §4 のタブUIを実装。
- **対象ファイル**:
  - `app/src/app/(admin)/projects/[id]/program-evaluation/ProgramEvaluationClient.tsx`
  - `app/src/app/(admin)/projects/[id]/cost-efficiency/CostEfficiencyClient.tsx`（移植元）
  - `app/src/components/ProjectModuleNav.tsx`（ナビ更新）
- **内容**: プロセス／アウトカム・インパクト／効率性タブを追加、効率性UIを移植、各タブにロジックモデル要素ブロックを表示。
- **完了条件**: 1画面で第3〜5階層を切替操作でき、各タブにロジックモデル軸が表示される。

### フェーズ P5: リネージ・整合性の更新

- **目的**: 統合後のアーティファクト関係を整合させる。
- **対象ファイル**:
  - `app/src/lib/modules/causal-graph.ts`
  - `app/src/lib/modules/artifact-types.ts`
  - `app/src/app/(admin)/projects/[id]/lineage/LineageGraphClient.tsx`
  - `app/src/components/lineage/ArtifactLineagePanel.tsx`
- **内容**: `cost_efficiency` を `program_evaluation` 配下（第5階層）として表現。
  `logic_model → program_evaluation` を「軸」エッジとして強調。非互換ルールの見直し。
- **完了条件**: リネージ図で効率性がプログラム評価の一部として表示され、循環参照・型キャスト警告が出ない。

---

## 6. 既存データ・機能への影響

### 6.1 検証用プロジェクト（`2af262ba...`）の既存データ

- 既存の `cost_efficiency_records` 行は **案B-2 により保持**される（破壊的変更なし）。
- バックフィル処理:
  1. `program_evaluation_id` が NULL の効率性レコードに対し、
     同 `project_id` / `fiscal_year` の `program_evaluation`(tier='efficiency') を生成 or 紐付け。
  2. 親評価行の `logic_model_id` には最新の承認済み（または最新版）ロジックモデルを設定。
- `program_evaluations` の既存行（process/outcome）で `logic_model_id` が NULL のものは、
  最新ロジックモデルへバックフィル。未設定時は UI で「軸未設定」と表示。

### 6.2 後方互換性の確保方法

- `evaluation_tier` CHECK は `'cost_efficiency'` と `'efficiency'` を**併存**させ、
  旧データの破棄を避ける（移行は段階的・任意）。
- 旧 `cost-efficiency` ページ／API は当面維持し、内部的に統合データを参照。
  最終的に program-evaluation の効率性タブへリダイレクトする経過措置を置く。
- `cost_efficiency_records` のスキーマ（generated column 含む）は変更しない
  （NOT NULL / UNIQUE 制約の追加のみ）。
- DB変更は `MIGRATION_POLICY.md` に従い DROP を避け、ADD COLUMN / ADD CONSTRAINT（冪等）で行う。

### 6.3 今回スコープ外（将来課題）

- 方針5により、評価階層間の **相互補完フィードバックループ**（例: 効率性結果を
  ニーズ／セオリー評価へ還流する自動更新）は本再設計では実装しない。設計余地のみ残す。
