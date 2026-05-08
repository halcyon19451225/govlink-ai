# Phase 4: PDCAダッシュボード・チェックポイント作業ページ

リポジトリの `docs/SPEC.md` を参照し、以下だけを実装してください。
Phase 1〜3 が完了済みであることが前提です。

## 実施事項

1. `app/(admin)/projects/[id]/pdca/page.tsx`
   - 現在地表示（プログレスバー・次のチェックポイントカード）
   - タイムラインビュー（状態バッジ付き閲覧モード）
   - チェックポイント一覧テーブル
   - SPEC.md「画面D」参照

2. `app/(admin)/projects/[id]/pdca/[checkpointId]/page.tsx`
   - modules_involved に応じたタブの動的生成
   - 「完了にする」ボタン（status を completed に更新）
   - SPEC.md「画面E」参照

3. `app/api/projects/[id]/pdca-checkpoints/route.ts`（CRUD）

4. `app/(admin)/projects/[id]/settings/modules/page.tsx` を更新
   - モジュール相関図タブ（react-flow 使用、非互換エッジは赤破線）

## 完了確認

- /projects/[id]/pdca にアクセスしチェックポイントタイムラインが表示される
- チェックポイントをクリックして作業ページに遷移できる
