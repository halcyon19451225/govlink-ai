# Phase 5: Module 1（データセット管理）・Module 2（ギャップ分析）

リポジトリの `docs/SPEC.md` を参照し、以下だけを実装してください。
Phase 1〜4 が完了済みであることが前提です。

## 実施事項

### Module 1: データセット管理
1. `app/(admin)/projects/[id]/datasets/page.tsx`
   - データセット定義一覧（充足度サマリー付き）
   - ドラッグ&ドロップアップロード・バリデーション
2. `app/api/projects/[id]/datasets/route.ts`（S3アップロード含む）

### Module 2: ギャップ分析
1. `app/(admin)/projects/[id]/gap-analysis/page.tsx`
   - 5基本目標タブ・ギャップテーブル・ArtifactLineagePanel（サイドバー）
   - 統計分析ボタン（トレンド回帰・Zスコア・年齢調整率）
2. `app/api/projects/[id]/gap-analysis/route.ts`
3. `app/api/projects/[id]/gap-analysis/ai-analyze/route.ts`
4. `app/api/projects/[id]/stats/trend/route.ts`
5. `app/api/projects/[id]/stats/zscore/route.ts`

### 統計ライブラリ（このフェーズで作成）
- `lib/stats/trend-regression.ts`
- `lib/stats/z-score.ts`
- `lib/stats/age-standardization.ts`
- `lib/stats/gap-priority-scoring.ts`

### 共通コンポーネント（このフェーズで作成）
- `components/stats/StatCalcStepsPanel.tsx`（KaTeX使用）
- `components/lineage/ArtifactLineagePanel.tsx`

## 完了確認

- ニーズ調査CSVをアップロードし、ギャップ分析にデータが反映される
- トレンド回帰分析を実行し、計算過程が折りたたみで表示される
