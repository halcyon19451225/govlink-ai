---
module: logic-model
title: ロジックモデル
menu_path: /projects/[id]/logic-model
tables: [logic_models, kpis, measure_designs]
apis: [/api/admin/projects/[id]/logic-model, /api/admin/projects/[id]/logic-model/ai-generate, /api/admin/projects/[id]/logic-model/revise]
ai_tasks: [generation.logic_model]
checks: [check:logicmodel, check:consistency, check:diff, check:revise]
migrations: [034]
upstream: [issue-hypothesis, measure-design]
downstream: [program-evaluation, plan-document, handover-intake]
updated: 2026-08-26
---

# ロジックモデル

## ① このメニューは何をするか

投入 → 活動 → 産出 → 初期 / 中間 / 長期アウトカムの因果仮説を図で設計します。
要素にはKPIを割り当てられ（三層アウトカムとの対応）、**版管理**により
「いつ・なぜ変えたか」が残ります。評価（図6/図7）と次期計画への引き継ぎの土台です。

## ② 位置づけ

```mermaid
flowchart LR
  P1(ギャップ分析) --> P2(現状整理) --> P3(課題仮説) --> P4(施策構築) --> P5(ロジックモデル):::here
  P5 --> D1(実行・進捗) --> C1(評価) --> A1(改善) --> P1
  classDef here fill:#6366f1,color:#fff,stroke:#818cf8
```

## ③ データフロー

```mermaid
flowchart TD
  MD[(measure_designs)] -.活動・産出の材料.-> AI{{ロジックモデル生成<br/>generation.logic_model}}
  IH[(issue_hypotheses)] -.真因.-> AI
  AI --> H{担当者が編集・確定}
  H --> LM[(logic_models<br/>版管理: version / is_current)]
  K[(kpis)] -.要素へ割当 kpi_ids.-> LM
  LM --> REV{改訂 revise<br/>新しい版を起こして適用}
  LM -.現行版を参照.-> EVAL(評価・計画書・引き継ぎ)
```

**現行版は直接上書きしない** — 変更は改訂（revise）で新しい版を起こし、
revision_reason に理由を残して適用します（L5 の定石。引き継ぎ取り込みも同じ経路）。

## ④ 状態

```mermaid
stateDiagram-v2
  [*] --> v1: 初版作成（draft）
  v1 --> v2: 改訂（理由つき）
  v2 --> v3: 改訂
  note right of v2: is_current は常に1版のみ
```

## ⑤ 操作手順

1. 「AIで生成」— 課題仮説・施策から因果チェーンの下書きを作る（確認して採用）
2. 要素の編集・因果エッジ（矢印）の張り替え・要素へのKPI割り当て
3. 変更が必要になったら**改訂** — 理由を書いて新しい版を起こす（履歴が残る）
4. 評価画面は現行版の要素・KPI対応を参照して「どの成果の評価か」を特定する

## ⑥ 用語と判定基準

- **三層アウトカム**: 短期（概ね1年・図6で年次評価）/ 中間（2〜5年・図7で計画期間評価）/
  長期（計画期間超・スコアボードで常時監視）
- **因果エッジ**: 要素間の「これがこうなるはず」という仮説の矢印。評価の判断経路が検証する

## ⑦ 実装メモ

- テーブル: logic_models（要素セクション7種＋edges JSONB・版管理列）
- 検査: check:logicmodel（要素構造）・check:consistency・check:diff・check:revise（版複製の全列運搬）
- 関連する実装記録: `claude/coe-lm-l1.md`〜`coe-lm-l5.md`・`claude/coe-logicmodel-audit.md`

## ⑧ 更新履歴

- 2026-08-26 v1 — M2 初版
