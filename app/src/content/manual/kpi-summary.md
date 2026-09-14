---
module: kpi-summary
title: KPIサマリー
menu_path: /projects/[id]/kpi-summary
tables: [indicators, indicator_targets, indicator_values, kpi_reports]
apis: [/api/admin/kpi-reports]
ai_tasks: []
checks: [check:vocab, check:indicator]
migrations: [001-020, 069]
upstream: [kpi-report]
downstream: [program-evaluation]
updated: 2026-09-14
---

# KPIサマリー

## ① このメニューは何をするか

全KPIの現在地（到達度・軌道）と報告履歴を一覧するサマリー画面です。
三層アウトカム（短期/中間/長期）ごとに整理され、評価前の全体把握に使います。

## ② 位置づけ

```mermaid
flowchart LR
  KR(KPI・進捗報告) --> KS(KPIサマリー):::here --> C1(評価)
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  K[(indicators<br/>指標の定義)] -.-> S(サマリー表示<br/>参照のみ)
  T[(indicator_targets<br/>基準値・目標値)] -.-> S
  V[(indicator_values<br/>実績値の履歴)] -.最新の1行が現在値.-> S
  R[(kpi_reports)] -.報告履歴.-> S
```

## ⑤ 操作手順

1. 層ごとにKPIの到達度と直近の報告を確認
2. 気になる指標はKPI・進捗報告へ（この画面は閲覧専用）

## ⑥ 用語と判定基準

- **到達度**: 基準値からの前進量（目標の向きを考慮・全画面統一計算）
- **現在値**: 実績値の履歴のうち、**基準日が最も新しい1行**の値。
  同じ基準日で入れ直したときは、計算・入力が新しい方を採ります

## ⑦ 実装メモ

- 到達度計算の正本: `src/lib/stats/achievement.ts`
- 関連する実装記録: `claude/coe-govlink.md`

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
- 2026-09-14 v2 — D3: KPI を指標管理に統合（目標と実績値が別の表に分かれた）
