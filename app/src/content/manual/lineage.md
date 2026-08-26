---
module: lineage
title: リネージグラフ
menu_path: /projects/[id]/lineage
tables: [gap_analyses, issue_hypotheses, measure_designs, logic_models, program_evaluations, improvement_actions]
apis: [/api/admin/projects/[id]/lineage]
ai_tasks: []
checks: [check:vocab]
migrations: [029]
upstream: [gap-analysis, issue-hypothesis, measure-design, logic-model, program-evaluation, improvement-actions]
downstream: []
updated: 2026-08-26
---

# リネージグラフ

## ① このメニューは何をするか

「ギャップ → 課題仮説（真因）→ 施策 → ロジックモデル → 評価 → 改善」の
**つながり（リネージ）をグラフで可視化**します。どの施策がどの真因から出て、
どんな評価を受け、どの改善につながったか — QCストーリーの一貫性を点検する画面です。

## ② 位置づけ

```mermaid
flowchart LR
  ALL(全工程のデータ):::none --> LG(リネージグラフ):::here
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  GA[(gap_analyses)] -.origin.-> IH[(issue_hypotheses)]
  IH -.真因.-> MD[(measure_designs)]
  MD -.-> LM[(logic_models)]
  MD -.評価対象.-> PE[(program_evaluations)]
  PE -.出所.-> IA[(improvement_actions)]
  GA & IH & MD & LM & PE & IA --> G(リネージグラフ表示<br/>参照のみ・編集しない)
```

## ⑤ 操作手順

1. グラフでつながりを俯瞰（切れている鎖＝出所のない施策・評価されていない施策が見える）
2. ノードから各画面へ移動して修正する（この画面自体は閲覧専用）

## ⑥ 用語と判定基準

- **リネージ**: データの出自と流れ。各テーブルの origin / source / FK 列が実体

## ⑦ 実装メモ

- 関連する実装記録: `claude/coe-ca-audit.md`（トレーサビリティ監査）

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
