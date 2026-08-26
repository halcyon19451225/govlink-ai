---
module: datasets
title: データセット管理
menu_path: /projects/[id]/datasets
tables: [project_datasets, dataset_definitions]
apis: [/api/admin/projects/[id]/datasets]
ai_tasks: []
checks: [check:vocab]
migrations: [010s]
upstream: []
downstream: [gap-analysis, asis-analysis, service-volume]
updated: 2026-08-26
---

# データセット管理

## ① このメニューは何をするか

計画種別ごとに定義されたデータセット（dataset_definitions — 必要列・書式つき）に
沿って、地域の実データを取り込み・管理します。ギャップ分析・現状整理・
サービス見込量の定量的な土台です。

## ② 位置づけ

```mermaid
flowchart LR
  DS(データセット管理):::here --> P1(ギャップ分析) --> P2(現状整理) --> P3(課題仮説)
  DS --> SV(サービス見込量)
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  DEF[(dataset_definitions<br/>計画種別ごとの定義: 必要列・書式・利用モジュール)] -.定義を参照.-> UP(取り込み)
  FILE(CSV等のファイル) --> UP --> V{列・書式の検証}
  V --> PD[(project_datasets)]
  PD -.-> USE(ギャップ分析・As-Is・見込量が参照)
```

## ⑤ 操作手順

1. 計画種別に応じて表示されるデータセット定義を確認（必要列・書式）
2. 手元のデータを定義に合わせて取り込み（検証エラーは修正して再取り込み）
3. 取り込んだデータは各分析画面から自動的に参照される

## ⑥ 用語と判定基準

- **dataset_definitions**: どの計画種別で・どのモジュールが・どんな列を使うかの定義（マスタ）

## ⑦ 実装メモ

- テーブル: project_datasets（プロジェクトの実データ）・dataset_definitions（定義マスタ）
- 関連する実装記録: `claude/coe-govlink.md`

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
