# Phase 0: 現状把握（全フェーズ開始前に必ず実施）

docs/MIGRATION_POLICY.md と docs/SPEC.md をまず読んでください。
その後、以下の確認作業を実施し、結果を報告してください。実装は行いません。

## 確認事項

### Step 1: 既存DBスキーマの完全な把握

```sql
-- 全テーブルの一覧
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- 各テーブルの詳細（存在するテーブルのみ）
\d logic_models
\d projects
\d kpis
\d posts
\d evidences
```

### Step 2: 既存マイグレーションの確認

```bash
ls -la infra/migrations/
cat infra/migrations/001_init.sql
```

最新のマイグレーションまですべてのSQLファイルを確認してください。

### Step 3: 既存機能の実装ファイルの確認

```bash
# ページ構成
find app -name "page.tsx" | sort

# APIルート
find app -name "route.ts" | sort

# ロジックモデル関連
grep -r "logic_model" app/ --include="*.ts" --include="*.tsx" -l

# プログラム評価関連
grep -r "evaluation\|program_eval" app/ --include="*.ts" --include="*.tsx" -l

# スケジュール管理
grep -r "schedule\|gantt\|checkpoint" app/ --include="*.ts" --include="*.tsx" -l
```

### Step 4: パッケージ依存関係の確認

```bash
cat app/package.json | grep '"dependencies"' -A 50
```

## 報告すべき内容

確認後、以下を報告してください。

1. **DBテーブル一覧**: 存在するテーブルと、SPEC.mdの新テーブルとの競合状況
2. **マイグレーション状況**: 何番まで適用済みか
3. **競合ページの一覧**: 既存ページとSPEC.mdの新ページが重複する箇所
4. **ロジックモデル**: 現在の実装詳細（テーブル構造・UIファイルのパス）
5. **プログラム評価**: 現在の実装詳細
6. **不足パッケージ**: SPEC.mdが要求するが未インストールのもの（reactflow, @dnd-kit, katex等）

## 確認後の次ステップ

報告内容をもとに phase1_db_schema.md の指示に従い実装を開始します。
このフェーズでは実装を行わないこと。
