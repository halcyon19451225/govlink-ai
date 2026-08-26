---
module: service-volume
title: サービス見込量
menu_path: /projects/[id]/service-volume
tables: [service_volume_plans, project_pdca_checkpoints]
apis: [/api/admin/projects/[id]/service-volume, /api/admin/projects/[id]/service-volume/[planId]]
ai_tasks: []
checks: [check:vocab]
migrations: [010s]
upstream: [datasets]
downstream: [program-evaluation, kpi-report]
updated: 2026-08-26
---

# サービス見込量

## ① このメニューは何をするか

サービスごと・年度ごとの見込量（認定率・受給率・利用者数・給付費など）を計画し、
実績と比較します。介護保険事業計画等の「見込量の設定と検証」に対応する画面です。

## ② 位置づけ

```mermaid
flowchart LR
  DS(データセット) --> SV(サービス見込量):::here --> D1(実行) --> C1(評価)
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  DATA[(project_datasets<br/>実績データ)] -.参照.-> SV(見込量の計画)
  SV --> H{担当者が計画値を確定} --> T[(service_volume_plans<br/>planned_* / actual_*)]
  T -.実績との差.-> EVAL(評価・チェックポイント)
```

## ⑤ 操作手順

1. サービス・年度ごとに見込量（認定率・受給率・単価・利用者数・給付費）を入力
2. 実績が入ったら計画対比を確認（チェックポイントの検証材料になる）

## ⑥ 用語と判定基準

- **見込量**: planned_*（計画値）と actual_*（実績値）の対で管理

## ⑦ 実装メモ

- テーブル: service_volume_plans（checkpoint_id で節目に紐付け可能）
- 関連する実装記録: `claude/coe-govlink.md`

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
