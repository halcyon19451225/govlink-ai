# GovLink 新設計移行 — ClaudeCodeへの渡し方

## ファイル構成

```
MIGRATION_POLICY.md   ← 必ず最初に読む。権限付与・移行原則
SPEC.md               ← 完全仕様書（1,967行）。実装の詳細はここを参照
integration_map.md    ← 既存機能と新機能の対応表

prompts/
  phase0_assess.md    ← 【最初に実行】現状把握（実装なし）
  phase1_db_schema.md ← DBスキーマ移行・新テーブル作成
  phase2_module_core.md ← モジュール基盤・既存UIの移行準備
  phase3_pdca_designer.md ← PDCAサイクルデザイナー・ウィザード
  phase4_pdca_dashboard.md ← PDCAダッシュボード・作業ページ
  phase5_modules_dataset_gap.md ← データセット管理・ギャップ分析
  phase6_modules_hypothesis_logicmodel.md ← 課題仮説・ロジックモデル
  phase7_modules_evaluation.md ← プログラム評価・コスト効率
  phase8_modules_service_selfevaluation.md ← サービス見込量・自己評価
```

## 使い方

### Step 1: リポジトリに配置する

```bash
# govlink-ai リポジトリに docs/ ディレクトリを作成
mkdir -p ~/Documents/govlink-ai/docs/prompts

# このフォルダの全ファイルを配置
cp MIGRATION_POLICY.md ~/Documents/govlink-ai/docs/
cp SPEC.md ~/Documents/govlink-ai/docs/
cp integration_map.md ~/Documents/govlink-ai/docs/
cp prompts/*.md ~/Documents/govlink-ai/docs/prompts/

# Gitにコミット
cd ~/Documents/govlink-ai
git add docs/
git commit -m "feat: add spec and migration docs for care plan suite"
```

### Step 2: ClaudeCodeを開く

```bash
cd ~/Documents/govlink-ai
claude
```

### Step 3: フェーズ順に実行する

**最初のプロンプト（フェーズ0）:**
```
docs/MIGRATION_POLICY.md と docs/SPEC.md を読んだ上で、
docs/prompts/phase0_assess.md の指示に従い、
現状の把握のみ行ってください。実装は行わないでください。
```

**Phase 0の報告を受けたら、次のプロンプト（フェーズ1）:**
```
Phase 0の確認結果をもとに、
docs/MIGRATION_POLICY.md の移行原則に従い、
docs/prompts/phase1_db_schema.md の指示に従って実装してください。
```

**以降、前フェーズ完了を確認してから次フェーズへ:**
```
Phase X が完了しました。
docs/prompts/phase(X+1)_xxx.md の指示に従って次を実装してください。
```

## 重要な注意事項

- 各フェーズの完了確認クエリ・URLチェックを必ず行ってからから次フェーズに進む
- Phase 0の「聖域」（認証・AWS設定）には絶対に触れないこと
- DBのDROP操作は必ずデータ移行後に行うこと
- 本番（Amplify）へのデプロイはすべてのフェーズ完了後に行うこと
