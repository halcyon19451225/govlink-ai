---
module: kpi-report
title: KPI・進捗報告
menu_path: /projects/[id]/kpi-report
tables: [kpi_reports, kpis]
apis: [/api/admin/kpi-reports, /api/admin/kpi-reports/[id]]
ai_tasks: []
checks: [check:report]
migrations: [001-020]
upstream: [report-requests, schedule]
downstream: [program-evaluation, kpi-summary, ebpm]
updated: 2026-08-26
---

# KPI・進捗報告

## ① このメニューは何をするか

KPIの実績値の報告と承認を管理します。**承認された報告だけが KPI の現在値を更新**し、
評価・スコアボード・公開ページに反映されます（勝手に現在値は変わりません）。

## ② 位置づけ

```mermaid
flowchart LR
  D1(実行) --> KR(KPI・進捗報告):::here --> C1(評価)
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  IN1(手入力の報告) --> R[(kpi_reports<br/>pending)]
  IN2(実績報告の取り込み<br/>S2 — 受領済み回答から) --> R2[(kpi_reports<br/>approved で登録)]
  R --> G{承認 / 却下<br/>reviewed_by 記録}
  G -->|approved| K[(kpis.current を更新)]
  R2 --> K
  K -.-> USE(評価・スコアボード・公開ページ)
```

## ④ 状態

報告: pending → approved（現在値を更新）/ rejected。
実績報告依頼（C①）からの取り込みは、受領＋取り込みクリックが人の確認にあたるため
approved で登録されます（reported_by に依頼IDが残る）。

## ⑤ 操作手順

1. 期間・値・コメントを入れて報告（または実績報告依頼の回収で自動起票）
2. 承認者が内容を確認して承認 → KPIの現在値が更新される
3. 却下した報告は履歴に残る（現在値は変わらない）

## ⑥ 用語と判定基準

- **到達度**: 基準値からの前進量（承認後の現在値で全画面統一計算）

## ⑦ 実装メモ

- 承認時の current 更新は /api/admin/kpi-reports/[id] の PATCH が行う
- 関連する実装記録: `claude/coe-govlink.md`・`claude/coe-s2.md`（取り込み経路）

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版（S2の取り込み経路を反映）
