---
module: documents
title: ドキュメント管理
menu_path: /projects/[id]/documents
tables: [documents, schedule_tasks]
apis: [/api/admin/documents, /api/admin/documents/[id]/summarize]
ai_tasks: [knowledge.summarize]
checks: [check:vocab]
migrations: [001-020]
upstream: [schedule]
downstream: []
updated: 2026-08-26
---

# ドキュメント管理

## ① このメニューは何をするか

会議資料・報告書などのファイルをプロジェクトに紐付けて保管します（S3保存）。
スケジュールタスクの「資料が必要」な期限と結びつき、AI要約で内容確認を支援します。

## ② 位置づけ

```mermaid
flowchart LR
  D1(スケジュール・実行):::none --> DOC(ドキュメント管理):::here
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  FILE(ファイル) --> UP(アップロード) --> S3[(S3)] --> T[(documents)]
  ST[(schedule_tasks<br/>document_required)] -.資料期限と紐付け.-> T
  AI{{要約<br/>knowledge.summarize}} --> H{確認} --> T
```

## ⑤ 操作手順

1. ファイルをアップロード（タスクに紐付けると資料期限の管理に乗る）
2. 「AI要約」で内容の要点を確認（結果は確認して保存）

## ⑦ 実装メモ

- テーブル: documents（schedule_task_id で工程に紐付け）
- 関連する実装記録: `claude/coe-govlink.md`

## ⑧ 更新履歴

- 2026-08-26 v1 — M3 初版
