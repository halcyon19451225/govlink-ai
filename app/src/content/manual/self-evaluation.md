---
module: self-evaluation
title: 自己評価シート
menu_path: /projects/[id]/self-evaluation
tables: [self_evaluation_sheets, self_evaluation_entries, program_evaluations]
apis: [/api/admin/projects/[id]/self-evaluation, /api/admin/projects/[id]/self-evaluation/[sheetId], /api/admin/projects/[id]/self-evaluation/[sheetId]/entries]
ai_tasks: []
checks: [check:vocab]
migrations: [029, 030]
upstream: [program-evaluation]
downstream: [improvement-actions]
updated: 2026-08-26
---

# 自己評価シート

## ① このメニューは何をするか

都道府県報告等で使う自己評価シート（取組概要＋年度ごとの中間/最終評価）を作成します。
**印刷 / PDF保存**はブラウザ印刷方式（「送信先: PDFに保存」で日本語のままPDF化）。

## ② 位置づけ

```mermaid
flowchart LR
  C1(プログラム評価) --> SE(自己評価シート):::here --> A1(改善アクション)
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  PE[(program_evaluations)] -.リンク可能.-> SH[(self_evaluation_sheets<br/>取組の概要)]
  SH --> EN[(self_evaluation_entries<br/>年度×中間/最終・評価と分析)]
  EN --> H{記入者の評価判断}
  EN -.課題・対策から.-> IA(改善アクション起票)
  SH --> PRT(🖨 印刷 / PDF保存<br/>共通印刷CSS)
```

## ④ 状態

エントリは年度×期別（interim/final）で1件。評価（achieved/mostly_achieved/…）は記入者の判断。

## ⑤ 操作手順

1. シートを作成（背景・取組内容・目標と指標・評価方法）
2. 年度ごとに中間・最終の評価を記入（実施内容・達成分析・課題・対策・次年度の変更）
3. 「印刷 / PDF保存」— 印刷画面で「送信先: PDFに保存」を選ぶ

## ⑦ 実装メモ

- 印刷は共通CSS（`src/lib/print/printCss.ts` — 評価報告書と共用。jsPDFの文字化け対策）
- 関連する実装記録: `claude/coe-selfeval-fix.md`・`claude/coe-pl3.md`（共通CSS化）

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
