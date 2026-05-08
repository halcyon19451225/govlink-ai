# Phase 8: Module 7（サービス見込量）・Module 8（自己評価）・最終統合

リポジトリの `docs/SPEC.md` を参照し、以下を実装してください。
Phase 1〜7 が完了済みであることが前提です。

## 実施事項

### Module 7: サービス見込量管理
1. `app/(admin)/projects/[id]/service-volume/page.tsx`
   - 乖離テーブル・要因分解分析（Oaxaca-Blinder）・需要予測グラフ
2. `app/api/projects/[id]/service-volume/route.ts`
3. `lib/stats/oaxaca-blinder.ts`
4. `lib/stats/demand-forecast.ts`

### Module 8: 自己評価シート
1. `app/(admin)/projects/[id]/self-evaluation/page.tsx`
   - フェイスシート・年度別評価入力・PDFエクスポート
2. `app/api/projects/[id]/self-evaluation/route.ts`

### 最終統合
1. プロジェクトサイドナビゲーションを有効モジュールに基づき動的生成する
2. 既存の `kpis`, `evidences`, `policy_suggestions` との連携を確認する
3. `app/api/projects/[id]/stats/interpret/route.ts`（AI統計解釈・全モジュール共通）

## 完了確認

- 全8モジュールが連携して動作する
- リネージグラフで全成果物の連鎖が可視化される
- 非互換モジュールを組み合わせようとすると警告が表示される
