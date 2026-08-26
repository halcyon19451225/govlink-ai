---
module: program-evaluation
title: プログラム評価
menu_path: /projects/[id]/program-evaluation
tables: [program_evaluations, kpis, kpi_reports, cost_efficiency_records, logic_models, measure_designs]
apis: [/api/admin/projects/[id]/evaluations, /api/admin/projects/[id]/evaluations/rollup, /api/admin/projects/[id]/cost-efficiency]
ai_tasks: []
checks: [check:vocab]
migrations: [029, 030, 037]
upstream: [logic-model, measure-design, kpi-report, report-requests]
downstream: [improvement-actions, self-evaluation, plan-document, handover-intake]
updated: 2026-08-26
---

# プログラム評価

## ① このメニューは何をするか

介護保険事業計画策定方針の2つの評価フロー — **図6（取組毎・年次評価）**と
**図7（主要施策毎・計画期間評価）** — を分岐ウィザードで実施します。
通った判断経路がそのまま記録され、「なぜこの判断に至ったか」の説明責任が残ります。

## ② 位置づけ

```mermaid
flowchart LR
  P1(ギャップ分析) --> P2(現状整理) --> P3(課題仮説) --> P4(施策構築) --> P5(ロジックモデル)
  P5 --> D1(実行・進捗) --> C1(評価):::here --> A1(改善) --> P1
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  MD[(measure_designs<br/>確定済み施策)] -.評価対象を選ぶ.-> W(評価ウィザード 図6/図7)
  LM[(logic_models)] -.成果とKPI対応.-> W
  KR[(kpi_reports)] -.実績値.-> W
  RR[(report_responses<br/>受領済み実績報告)] -.所見・課題を参考表示.-> W
  W --> G{担当者の判断<br/>実施状況→達成→要因→改善方向}
  G --> PE[(program_evaluations<br/>flow_decision_path・kpi_snapshot)]
  PE --> AP{承認<br/>approved_by / スナップショット固定}
  PE -.-> IA(改善アクション起票)
  PE -.-> RPT(評価報告書・引き継ぎ)
```

## ④ 状態

評価レコード: draft →（レビュー）→ approved。承認時に **kpi_snapshot を固定**し、
以後の実績更新に影響されません（監査可能性）。

## ⑤ 操作手順

1. フローを選ぶ — 図6（短期アウトカム・年2回）/ 図7（中間アウトカム・計画期間内1回）
2. **評価する施策を選ぶ**（推奨 — KPI・SPO指標・実験設計・効率性の算定式が一度に決まる）。
   受領済み実績報告があれば、その施策の所見・課題が参考表示される
3. ウィザードの設問に沿って判断（達成の自動判定は到達度の統一計算 — 確認して上書き可）
4. 保存 → 評価一覧で確認 → 承認（スナップショット固定）
5. 未達なら「改善アクション起票」へ（評価との紐付きが記録される）

## ⑥ 用語と判定基準

- **到達度**: (現在値 − 基準値) ÷ (目標値 − 基準値) × 100（目標の向きを考慮・全画面統一計算）
- **効率性評価（第5階層）**: 成果1単位あたり費用（F区画の算定式）— cost tier の評価で記録
- **rollup**: KPI階層（contributes_to）に沿って下位KPIの寄与を集計する参考表示

## ⑦ 実装メモ

- テーブル: program_evaluations（flow_decision_path JSONB＝判断経路の記録）
- フロー定義の正本: `src/lib/evaluation/flow.ts`（フロー改訂はこのファイルで完結）
- 関連する実装記録: `claude/coe-ca-p1.md`〜`coe-ca-p3.md`・`claude/coe-s2.md`（実績報告の参考表示）

## ⑧ 更新履歴

- 2026-08-26 v1 — M2 初版（S2 実績報告の参考表示を反映）
