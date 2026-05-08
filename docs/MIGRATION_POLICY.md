# GovLink 移行方針書
# — ClaudeCodeへの権限付与と移行原則 —
# （すべての実装フェーズの前に読むこと）

---

## ClaudeCodeへの権限付与

以下を明示的に許可する。

- **既存コードの削除・書き換え**: 新設計（docs/SPEC.md）の実現のために、
  既存のページ・コンポーネント・APIルート・DBスキーマを削除・置き換えてよい
- **既存テーブルのALTER / DROP**: 新スキーマへの移行に必要な場合、
  既存テーブルの変更・削除を行ってよい。ただし後述の「聖域」を除く
- **UIの全面刷新**: 既存UIがSPEC.mdの設計と相容れない場合、
  既存UIを廃棄して新設計に沿った実装を行ってよい

---

## 移行の最優先原則

> **新設計（SPEC.md）の機能性 > 既存コードの保全**
>
> 既存コードを保全するためにSPEC.mdの機能が損なわれることは許容しない。
> 逆に、既存コードを削除することでSPEC.mdの機能が完全に実現されるなら、削除を優先する。

---

## 絶対に変更しない「聖域」（これだけは保全する）

| 対象 | 理由 |
|---|---|
| AWS Amplify設定・`amplify.yml` | デプロイ基盤 |
| Cognito認証設定・NextAuth設定 | 本番ユーザーのセッション管理 |
| `.env.local` / Amplify環境変数 | 秘密情報 |
| `infra/` のAWS CDKスタック構成 | インフラ基盤 |
| 全体のダークテーマ配色（`#0f1117` / `#1a1d27` / `#3b82f6`） | ブランド統一 |
| `app/(admin)/` および `app/(public)/` のルーティング構造 | URLの永続性 |
| S3バケット設定 | ファイルデータの所在 |

---

## 既存機能の移行方針（機能は残す、実装は刷新する）

### 1. ロジックモデル生成機能

**現状:** 既存の `logic_models` テーブル（`inputs, activities, outputs, outcomes`）+ AIで自動生成するUI

**移行後:** SPEC.mdの拡張スキーマ（purpose, basic_goal, challenge, root_cause等のフィールドを追加）に切り替えるが、**AIによる自動生成機能は維持する**。新しいビジュアルエディタに「AIで生成」ボタンとして引き継ぐ。

**既存テーブルの扱い:** DROP不要。`ALTER TABLE logic_models ADD COLUMN ...` で拡張する。

---

### 2. 5階層プログラム評価

**現状:** UIとKPI分類が実装済み。専用テーブルが存在するか確認が必要。

**移行後:** 新しい `program_evaluations` テーブルを作成し、既存の評価UIをこのテーブルに接続し直す。既存の評価ロジック（5階層の判定・KPI分類）は`program_evaluations`の`evaluation_tier`フィールドに対応させる。

**既存テーブルの扱い:** 専用テーブルがあれば、新テーブルにデータを移行してから旧テーブルを削除する。

---

### 3. スケジュール管理（ガントチャート）

**現状:** AIによる工程生成・ガントチャート表示が実装済み。

**移行後:** `project_pdca_checkpoints` テーブルをデータソースとして、既存のガントチャートUIを接続し直す。PDCAチェックポイントをガントの「タスク」として表示する形に変更する。AIによる工程生成機能は「テンプレートからのチェックポイント自動生成」として引き継ぐ。

---

### 4. ドキュメント管理（S3アップロード・AI要約）

**現状:** ファイルのS3アップロードとAI要約が実装済み。

**移行後:** 既存のドキュメント管理機能を維持しつつ、「AIデータセットとして登録」機能を追加する。`project_datasets` は `documents` テーブルの拡張として実装し、既存のアップロードUIにデータセット登録ボタンを追加する形にする。

---

### 5. エビデンス管理

**現状:** 因果関係登録・AI妥当性評価が実装済み。`evidences` テーブルが存在する。

**移行後:** 既存の `evidences` テーブルはそのまま維持する。新しい `module_artifacts` リネージシステムが `evidence_id` 外部キーで既存テーブルを参照する形で統合する。

---

### 6. EBPMダッシュボード・e-Stat/RESAS連携

**現状:** エビデンス充足度スコア・外部API連携が実装済み。`benchmark_values`, `policy_suggestions` テーブルが存在する。

**移行後:** これらのテーブルと機能はそのまま維持する。新しいコストと効率性の評価（Module 6）とサービス見込量管理（Module 7）は `benchmark_values` を参照値として活用する。

---

## Phase 0: 実装開始前の必須確認手順

**いかなるフェーズの実装を開始する前も、必ずこの確認を行うこと。**

```bash
# 1. 既存テーブルの完全な一覧と構造を確認する
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name;
"

# 2. 競合が予測される既存テーブルの詳細を確認する
psql $DATABASE_URL -c "\d logic_models"
psql $DATABASE_URL -c "\d projects"
psql $DATABASE_URL -c "\d kpis"
psql $DATABASE_URL -c "\d evidences"

# 3. 現在のマイグレーションファイルを確認する
ls -la infra/migrations/

# 4. 主要なAPIルートとページを確認する
find app -name "*.tsx" -o -name "*.ts" | grep -E "(page|route)" | sort

# 5. 既存のロジックモデル関連コードを確認する
grep -r "logic_model" app/ --include="*.ts" --include="*.tsx" -l
grep -r "program_evaluation\|programEvaluation" app/ --include="*.ts" --include="*.tsx" -l
```

この確認結果をもとに、SPEC.mdの各フェーズを「新規作成」「ALTER拡張」「既存コード置き換え」のいずれで進めるかを判断すること。

---

## 実装の進め方

1. 必ずPhase 0確認を先に実施する
2. 確認結果とSPEC.mdを照合し、各ステップの実装方法を決定する
3. 「聖域」には絶対に触れない
4. データ破壊が伴うステップ（DROP TABLE等）の前には必ずバックアップまたはデータ移行を先行する
5. 各フェーズ完了後、既存の動作確認済みURLが引き続き動作することを確認する

