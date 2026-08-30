---
module: issue-hypothesis
title: 課題仮説設定
menu_path: /projects/[id]/issue-hypothesis
tables: [issue_hypotheses, issue_dialogues, gap_analyses, asis_analyses]
apis: [/api/admin/projects/[id]/issue-hypothesis, /api/admin/projects/[id]/issue-hypothesis/ai-suggest, /api/admin/projects/[id]/issue-dialogue]
ai_tasks: [dialogue.issue, proposal.issue_hypothesis]
checks: [check:vocab, check:asyncturn, check:issue, check:copy]
migrations: [020s, 055]
upstream: [gap-analysis, asis-analysis]
downstream: [measure-design, logic-model, improvement-actions]
updated: 2026-08-30
---

# 課題仮説設定

## ① このメニューは何をするか

ギャップ分析・現状整理の結果から「なぜそのギャップが生じているのか」の
課題仮説を立て、**真因（root cause）**まで掘り下げます。
ここで特定した真因が施策構築の出発点になり、評価・改善でも
「改善が真因に対応しているか」を見る基準になります。

## ② 位置づけ

```mermaid
flowchart LR
  P1(ギャップ分析) --> P2(現状整理) --> P3(課題仮説):::here --> P4(施策構築) --> P5(ロジックモデル)
  P5 --> D1(実行・進捗) --> C1(評価) --> A1(改善) --> P1
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  GA[(gap_analyses)] -.出所として参照.-> AI{{課題仮説の対話・提案<br/>dialogue.issue / proposal.issue_hypothesis}}
  AS[(asis_analyses)] -.出所として参照.-> AI
  CC[(corpus_context)] -.出典つき環境情報.-> AI
  AI --> H{担当者が確認・採用}
  H --> IH[(issue_hypotheses<br/>title / root_cause / priority_rank / origin)]
  IH -.真因を参照.-> M(施策構築・改善アクション)
```

仮説には **origin（どのギャップ・どの現状整理から出たか）と source_text（出典つき原文）**
が記録され、後から「なぜこの課題だと考えたか」を遡れます。

## ④ 状態

仮説行は編集自由。priority_rank で優先順位を付けます（NULL=未設定）。

## ⑤ 操作手順

1. 「AI提案」または対話で、ギャップ・現状整理から課題仮説の候補を出す
2. 候補を確認して採用（採用前に内容・出典を確認 — 勝手に保存されない）
3. 仮説ごとに「なぜ？」を繰り返して root_cause（真因）を記入
4. 優先順位を付ける — 上位の仮説から施策構築（EBPM）へ進む


> **AIの応答待ちについて** — AIの応答には数十秒〜数分かかることがあります。送信した発言は即座に保存され、画面は「AIが考えています」の表示のまま結果を待ちます（画面を再読み込みしても待ち受けは再開されます）。「AI処理に失敗しました」と出た場合は「🔁 AI処理を再試行」で、発言を再入力せずにやり直せます。

> **問題候補の統合について** — 「AとBは同じ問題なのでまとめてほしい」と伝えると、片方が統合先に吸収され、
> 一覧では「p5 → p1 に統合」と取り消し線つきで表示されます。**IDは消えずに残ります**（選別・真因・仮説が
> IDで参照しているため、消すと下流の対応が崩れるからです）。統合元の引用原文は統合先に引き継がれるので、
> 現状整理へのトレーサビリティは切れません。

> **対話のコピー** — 各発言の下の 📋 でその発言だけを、画面右上の「対話全体をコピー」で対話全体を
> クリップボードへコピーできます。役割（AI／担当者）と工程の見出しが付いたテキストになるので、
> 庁内資料への引用や、他の担当者への共有にそのまま使えます。

> **出典の確認** — AIが制度名・調査名・ガイドライン名を挙げた発言には、下部に出典が表示されます。
> 出典が無いまま固有名詞を挙げている場合は「⚠ 出典が示されていません」と警告が出るので、
> **計画書に載せる前に必ず原典を確認してください**（もっともらしい名称の取り違えが実際に起きています）。

> **選定と点数の整合** — 選定した課題より高い点数の問題が選外になっていると、
> 一覧の上に警告が出ます。書き出し時の優先順位は点数の降順で採番されるため、
> 放置すると最重要の課題が最下位で登録されます。点数を付け直すか、低い点数でも選ぶ理由をAIに明記させてください。

## ⑥ 用語と判定基準

- **課題仮説**: ギャップの原因についての検証可能な仮説
- **真因**: 掘り下げの終点。施策はこの真因に効かせる（対症療法との区別）

## ⑦ 実装メモ

- テーブル: issue_hypotheses（origin/source_text で trace 可能）・issue_dialogues（対話ログ）
- 関連する実装記録: `claude/coe-govlink.md`・`claude/coe-ca-p1.md`

- 対話のAIターンは非同期（migration 055・`lib/ai/asyncTurn.ts`）: 発言保存→202→自己呼び出しでAI処理→画面がポーリング。Amplify の30秒応答上限の対策。検査: `check:asyncturn`

- 選別の取り違え防止（2026-08-29）: `selection` は `problem_text_echo`（保存済み文言の引き写し）を必須とし、サーバーが保存済みの問題と照合する。不一致なら正しい対応表を示す追いターンで作り直させ、それでも直らなければ選別を保存せず selection フェーズに留める。統合は `merge_problems` で行い、退役した問題は `retired` / `merged_into` を持つ。検査: `check:issue`

- 対話のコピー: `components/CopyButton.tsx`（navigator.clipboard＋非セキュア環境向けフォールバック）と `lib/ai/transcript.ts`（整形は純粋関数）。検査: `check:copy`

- 出典（`references`）・出典なし警告（`needsCitation`）・重点指向の破れ（`findSelectionInconsistencies`）はいずれも `lib/issue/types.ts` の純粋関数。検査: `check:issue`

## ⑧ 更新履歴

- 2026-08-26 v1 — M2 初版
- 2026-08-29 v1.1 — 対話AIターンの非同期化（通信エラー対策・再試行ボタン）
- 2026-08-29 v1.2 — 問題候補の統合機能とID取り違えガード（誤選定の修正）
- 2026-08-30 v1.3 — 対話の発言単位／全体のクリップボードコピー
- 2026-08-30 v1.4 — 出典の記録と未出典の警告、選定と点数の整合チェック、出所の1件ずつ表示
