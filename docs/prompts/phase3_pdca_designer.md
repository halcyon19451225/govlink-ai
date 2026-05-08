# Phase 3: PDCAサイクルデザイナー・プロジェクト作成ウィザード

リポジトリの `docs/SPEC.md` を参照し、以下だけを実装してください。
Phase 1・2 が完了済みであることが前提です。

## 実施事項

1. `components/pdca/CycleDesigner.tsx`
   - 横軸タイムライン（plan_period_years に基づき動的生成）
   - チェックポイントカードのドラッグ&ドロップ（@dnd-kit 使用）
   - サイドパネル（CheckpointEditPanel）

2. `app/(admin)/templates/[id]/edit/page.tsx`
   - タブ1: 基本情報
   - タブ2: モジュール設定（非互換チェック組み込み）
   - タブ3: PDCAサイクルデザイナー（CycleDesigner 埋め込み）

3. `app/(admin)/projects/new/page.tsx` を4ステップウィザードに更新
   - SPEC.md「画面C: プロジェクト作成ウィザード」参照

4. `app/api/projects/route.ts` の POST ハンドラを更新
   - instantiateTemplate() を使ってチェックポイントを一括生成

## 完了確認

新規プロジェクト作成時に、計画開始日から全チェックポイントの scheduled_date が計算され
project_pdca_checkpoints テーブルに保存されることを確認する。
