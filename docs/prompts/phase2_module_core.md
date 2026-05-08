# Phase 2: モジュール基盤・既存UIの移行

docs/MIGRATION_POLICY.md と docs/SPEC.md を参照すること。
Phase 1（DB拡張）が完了済みであることが前提。

## 実施事項

### Step 2-A: モジュール基盤ライブラリ

1. `lib/modules/causal-graph.ts` — CAUSAL_EDGES と INCOMPATIBLE_PAIRS の定義
2. `lib/modules/compatibility-checker.ts` — `checkModuleCompatibility()` 関数
3. `lib/templates/index.ts` — テンプレートユーティリティ3関数

### Step 2-B: テンプレートライブラリページ（新規）

`app/(admin)/templates/page.tsx` と `app/api/templates/[id]/route.ts` を新規作成する。

### Step 2-C: 既存ロジックモデルUIの移行（置き換え）

**既存の** `app/(admin)/projects/[id]/logic-model/` 以下のファイルを確認し、
SPEC.mdの新設計（Phase 6で実装予定のビジュアルエディタ）に向けて移行準備を行う。

現段階での対応:
- 既存のロジックモデル生成APIを `app/api/ai/generate-logic-model/route.ts`
  （または同等のパス）から読み、新しい `logic_models` スキーマ（拡張済み）への
  保存に対応するよう更新する
- 具体的には: `generated_at` フィールド付きの既存INSERT文を、
  新フィールド（name, status, ai_generated=true 等）を含むINSERTに更新する

### Step 2-D: 既存プログラム評価UIの移行準備

既存のプログラム評価機能が `program_evaluations` テーブル（新規作成済み）に
データを保存するよう、APIルートを更新する。

既存の評価結果（旧テーブルまたは別の保存先にある場合）を
`program_evaluations` テーブルに移行するSQLを作成・実行する:

```sql
-- 既存評価データの移行（旧テーブルが存在する場合）
-- Phase 0で確認した旧テーブル名を使用する
INSERT INTO program_evaluations (project_id, evaluation_tier, fiscal_year, status, ...)
SELECT project_id, tier, year, status, ...
FROM (旧テーブル名)
ON CONFLICT DO NOTHING;
```

### Step 2-E: 既存スケジュール管理の移行準備

既存のスケジュール管理（ガントチャート）のデータソースを
`project_pdca_checkpoints` テーブルから読み込む形に変更する。

既存のスケジュールデータを `project_pdca_checkpoints` に移行する
（移行Scriptを作成し実行する）。

## 完了確認

- http://localhost:3000/templates にアクセスし3テンプレートが表示される
- 既存のロジックモデル生成が引き続き動作し、新フィールド付きでDBに保存される
- 既存のスケジュール管理ページが `project_pdca_checkpoints` からデータを読む
