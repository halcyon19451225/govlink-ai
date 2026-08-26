---
module: kpi-summary
title: KPIサマリー
menu_path: /projects/[id]/kpi-summary
tables: [kpis, kpi_reports]
apis: [/api/admin/kpi-reports]
ai_tasks: []
checks: [check:vocab]
migrations: [001-020]
upstream: [kpi-report]
downstream: [program-evaluation]
updated: 2026-08-26
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
  K[(kpis)] -.現在値・基準値・目標.-> S(サマリー表示<br/>参照のみ)
  R[(kpi_reports)] -.報告履歴.-> S
```

## ⑤ 操作手順

1. 層ごとにKPIの到達度と直近の報告を確認
2. 気になる指標はKPI・進捗報告へ（この画面は閲覧専用）

## ⑥ 用語と判定基準

- **到達度**: 基準値からの前進量（目標の向きを考慮・全画面統一計算）

## ⑦ 実装メモ

- 到達度計算の正本: `src/lib/stats/achievement.ts`
- 関連する実装記録: `claude/coe-govlink.md`

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
