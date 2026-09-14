---
module: measure-design
title: 施策構築（EBPM）
menu_path: /projects/[id]/measure-design
tables: [measure_designs, measure_dialogues, experiment_results, indicators, dialogue_proposals, corpus_measures, corpus_evidence]
apis: [/api/admin/projects/[id]/measure-design, /api/admin/projects/[id]/measure-design/[measureId], /api/admin/projects/[id]/measure-design/[measureId]/experiment-results, /api/admin/projects/[id]/measure-dialogue, /api/admin/projects/[id]/measure-dialogue/[dialogueId]/proposals, /api/admin/projects/[id]/measure-dialogue/[dialogueId]/proposals/[proposalId]]
ai_tasks: [dialogue.measure]
checks: [check:measure, check:expresults, check:asyncturn, check:proposal]
migrations: [036, 037, 039, 055, 070]
upstream: [issue-hypothesis, evidences]
downstream: [logic-model, schedule, program-evaluation, report-requests]
updated: 2026-09-14
---

# 施策構築（EBPM）

## ① このメニューは何をするか

課題仮説の真因に効かせる施策を、**8つの区画**（A出所 / B定義 / Cエビデンス /
D実験設計 / E指標 / Fコスト / G実行 / H管理）で設計します。
エビデンスに基づく設計（EBPM）を対話AIが支援し、**エビデンスが足りない施策は
実験設計を添えない限り確定できない**仕組みで質を担保します。

## ② 位置づけ

```mermaid
flowchart LR
  P1(ギャップ分析) --> P2(現状整理) --> P3(課題仮説) --> P4(施策構築):::here --> P5(ロジックモデル)
  P5 --> D1(実行・進捗) --> C1(評価) --> A1(改善) --> P1
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  IH[(issue_hypotheses<br/>真因)] -.A区画の出所.-> MD(施策構築画面)
  CE[(corpus_evidence<br/>横断コーパスの介入エビデンス)] -.C区画へ接地.-> AI{{施策の対話<br/>dialogue.measure}}
  CM[(corpus_measures<br/>参考単価・国事業)] -.F区画へ接地.-> AI
  AI --> H{担当者が確認・採用}
  MD --> H --> T[(measure_designs<br/>8区画)]
  T --> G{確定<br/>エビデンス十分 or 実験設計あり}
  G --> CONF[確定済み施策]
  CONF -.-> LM(ロジックモデル・スケジュール・評価へ)
  ER[(experiment_results)] --> P{確認 → エビデンス昇格}
```

対話のC区画にはコーパスのエビデンス（効果量・95%CI・エビデンスレベルつき）、
F区画には類似施策の単価分布・財政効果率が接地されます（2件未満は表示しない）。

## ④ 状態

```mermaid
stateDiagram-v2
  [*] --> draft: 作成
  draft --> confirmed: 確定（エビデンス十分 or 実験設計あり）
  confirmed --> draft: 差し戻し
```

実験結果（experiment_results）は draft → confirmed → **promote（エビデンス昇格）**。
昇格は confirmed のもののみ（機械的に強制）。

## ⑤ 操作手順

1. 課題仮説（真因）を選んで施策を作成 — A区画に出所が記録される
2. 対話AIとB〜G区画を埋める（介入内容・対象・エビデンス・実験設計・SPO指標・コスト・体制）
3. エビデンスが不足なら D区画で実験設計（RCT/準実験/前後比較・検出力の目安）を書く
4. **確定** — 確定済み施策だけがスケジュール生成・評価・実績報告の対象になる
5. 実施後、実験結果を記録 → 確認 → エビデンスに昇格（次の計画の根拠になる）


> **AIの応答待ちについて** — AIの応答には数十秒〜数分かかることがあります。送信した発言は即座に保存され、画面は「AIが考えています」の表示のまま結果を待ちます（画面を再読み込みしても待ち受けは再開されます）。「AI処理に失敗しました」と出た場合は「🔁 AI処理を再試行」で、発言を再入力せずにやり直せます。

## ⑤-2 データが足りないとき — 提案 → 承認 → 待機 → 再開（D6）

対話のAIは、登録済みの指標とその最新値を**毎ターン見ています**。
必要な値が無いときは推測で話を進めず、次のどちらかをします。

| AIがすること | 何が起きるか |
|---|---|
| 登録済みの指標の値を求める | サーバがターンの後に計算し、**次の返答の冒頭に値が届きます**（このターンでは返りません） |
| 足りないデータセット・指標を**提案する** | 対話の下に**承認カード**が出ます |

```mermaid
flowchart LR
  AI{{AI: これが要る}} --> C[承認カード]
  C --> H{担当者が決める}
  H -->|承認して登録| R[(箱と指標を登録<br/>作成者=承認した担当者)]
  H -->|見送る| X[記録が残る]
  R --> W(アップロード待ち)
  W --> U[データセット管理で上げる]
  U --> V[指標を計算 → 次の返答で結果が届く]
```

**承認するまで何も作られません。** カードには「承認すると何が作られ、何が作られないか」が
書いてあります（箱を作っても、データはまだ入りません）。

- **見送った提案も消えません。** 何を提案され、なぜ採らなかったかが残ります
- **待機はブロックではありません。** データを待っている間も対話は続けられます
- 再開は2つの経路があり、**どちらでも同じ結果になります**
  （担当者が「上げました」と伝える／データセット管理で版が有効になる）。
  どちらも同じ処理を通るので、伝え忘れても上げた時点で再開します
- 承認して作られた箱と指標は、**画面から作ったものと同じ**です。
  あとから指標管理・データセット管理で編集も削除もできます。
  違いは操作履歴の経路が「AI対話（担当者が承認）」になることだけです
- 個票データの箱は対話からは提案できません（庁内の変換ツールと鍵の運用が要るため）

対話の中に点線で囲まれた青い行が出ることがあります。これは**担当者の発言ではなく**、
サーバが差し込んだ記録（計算結果・不足の案内・承認や取込の記録）です。

## ⑥ 用語と判定基準

- **エビデンスレベル**: Lv4=RCT明記 / Lv3=対照群あり / Lv2=前後比較 / Lv1=事例（正直判定）
- **SPO指標**: 構造（Structure）/ 過程（Process）/ 成果（Outcome）の三層指標
- **確定条件**: エビデンス十分（sufficient）または実験設計あり — どちらも無い施策は確定不可

## ⑦ 実装メモ

- テーブル: measure_designs（8区画・milestones/risks/experiment は JSONB）・experiment_results
- 検査: `npm run check:measure` `npm run check:expresults`
- 関連する実装記録: `claude/coe-ebpm-e1.md`〜`coe-ebpm-e5.md`

- 対話のAIターンは非同期（migration 055・`lib/ai/asyncTurn.ts`）: 発言保存→202→自己呼び出しでAI処理→画面がポーリング。Amplify の30秒応答上限の対策。検査: `check:asyncturn`

## ⑧ 更新履歴

- 2026-08-26 v1 — M2 初版
- 2026-08-29 v1.1 — 対話AIターンの非同期化（通信エラー対策・再試行ボタン）
- 2026-09-14 v1.2 — D6（指標の文脈注入・提案 → 承認 → 登録 → アップロード待ち → 再開。
  承認するまで何も作らない。承認した箱と指標は画面から作ったものと同じ）
