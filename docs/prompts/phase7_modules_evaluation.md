# Phase 7: Module 5（プログラム評価）・Module 6（コスト効率）

リポジトリの `docs/SPEC.md` を参照し、以下だけを実装してください。
Phase 1〜6 が完了済みであることが前提です。

## 実施事項

### Module 5: プログラム評価
1. 図6フローコンポーネント（取組毎・年次評価用ウィザード）
2. 図7フローコンポーネント（主要施策毎・3年目評価用ウィザード）
3. `app/(admin)/projects/[id]/program-evaluation/page.tsx`
   - 評価タイムラインビュー・図6/7ウィザードフォーム
   - 前後比較分析・DiD分析の統計分析ボタン
4. `app/api/projects/[id]/evaluations/route.ts`
5. `lib/stats/pre-post-comparison.ts`
6. `lib/stats/diff-in-diff.ts`

### Module 6: コストと効率性の評価
1. `app/(admin)/projects/[id]/cost-efficiency/page.tsx`
   - リアルタイム計算機（感度分析・モンテカルロ組み込み）
   - 事前/事後評価タブ
2. `app/api/projects/[id]/cost-efficiency/route.ts`
3. `lib/stats/sensitivity-analysis.ts`
4. `lib/stats/monte-carlo.ts`（Web Workers使用）
5. `components/stats/TornadoChart.tsx`
6. `components/stats/MonteCarloHistogram.tsx`

## 完了確認

- プログラム評価の図6ウィザードを完走できる
- モンテカルロシミュレーションが非同期で実行され、ヒストグラムが表示される
