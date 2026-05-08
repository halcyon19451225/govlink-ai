# Phase 6: Module 3（課題仮説）・Module 4（ロジックモデル）

リポジトリの `docs/SPEC.md` を参照し、以下だけを実装してください。
Phase 1〜5 が完了済みであることが前提です。

## 実施事項

### Module 3: 課題仮説設定
1. ロジックツリービルダーコンポーネント（reactflow使用）
2. `app/(admin)/projects/[id]/issue-hypothesis/page.tsx`
   - 相関ヒートマップ・課題仮説カード一覧
   - エビデンス強度スター表示
3. `app/api/projects/[id]/issue-hypothesis/route.ts`
4. `lib/stats/correlation-matrix.ts`

### Module 4: ロジックモデル
1. ロジックモデルビジュアルエディタ（reactflow使用）
2. `app/(admin)/projects/[id]/logic-model/page.tsx`
   - 「ロジックモデルから数値を取り込む」ボタン（コスト評価との連携）
   - 各ノードのトレースボタン（上流成果物へのリンク）
3. `app/api/projects/[id]/logic-model/route.ts`
4. `app/api/projects/[id]/logic-model/ai-generate/route.ts`
5. `app/(admin)/projects/[id]/lineage/page.tsx`（プロジェクト全体リネージグラフ）

## 完了確認

- 課題仮説シートを作成し、ロジックモデルの課題フィールドに自動引き継ぎされる
- リネージグラフで「データセット→ギャップ→課題仮説→ロジックモデル」の連鎖が表示される
