// 対話型AI改善提案の システムプロンプト構築（サーバー専用）
//
// 従来の /api/ai/suggest-improvements は KPI・エビデンス・スケジュールしか見ておらず、
// A工程の提案なのに C工程の成果物（評価結果・図6/図7の判定経路・自己評価）を
// 参照していなかった。ここではそれらを必ず読み込ませ、
// 「評価で分かったこと」から改善策を導く対話にする。
//
// 探索順序は現状整理・課題仮説と同じ: ナレッジ → 不足時のみ web_search。

import type Anthropic from "@anthropic-ai/sdk";

export type ImprovementStep = "review" | "cause" | "design" | "assign" | "done";

export const IMPROVEMENT_STEP_LABEL: Record<ImprovementStep, string> = {
  review: "評価結果の確認",
  cause: "真因との対応",
  design: "改善策の具体化",
  assign: "担当と反映先",
  done: "完了",
};

export const IMPROVEMENT_STEP_ORDER: ImprovementStep[] = [
  "review",
  "cause",
  "design",
  "assign",
  "done",
];

export const IMPROVEMENT_STEP_HINT: Record<ImprovementStep, string> = {
  review: "評価で何が起きたのかを、担当者の認識と突き合わせます",
  cause: "その結果が真因のどこから来ているのかを確かめます",
  design: "真因に対応する改善策を、実行できる粒度まで具体化します",
  assign: "誰がいつまでに、どこに反映するのかを決めます",
  done: "改善アクションとして起票できます",
};

const REVIEW_GUIDE = `【フェーズ1: 評価結果の確認（review）】
提示された評価結果（到達度・図6/図7の判定経路・所見）を読み、
担当者に「この結果は現場の実感と合っているか」を確認してください。

- まず評価から読み取れることを2〜3行で要約し、そのうえで問いを1つ投げる。
- 数字だけを繰り返さない。**判定経路に現れた選択（未達の要因、投入の過不足など）に
  踏み込んで確認**する。
- 担当者の補足が得られたら cause へ進む。`;

const CAUSE_GUIDE = `【フェーズ2: 真因との対応（cause）】
課題仮説設定で到達した真因（提示されていれば）と、評価結果を突き合わせます。

- 「この結果は、当初の真因のどこから来ていますか？」を軸に問う。
- 次の3つのどれなのかを見極める:
  (a) 真因は正しいが、打ち手が足りなかった
  (b) 真因は正しいが、打ち手が真因に効いていなかった
  (c) 真因の捉え方自体がずれていた
- (c) の場合は、改善が「課題仮説の再設定」に向かうべきことを明示する。
- 見極めがついたら design へ進む。`;

const DESIGN_GUIDE = `【フェーズ3: 改善策の具体化（design）】
真因に対応する改善策を、**実行できる粒度**まで具体化して proposals に入れます。

各案には次を入れてください:
- title: 改善の見出し（30文字以内・動詞で終える）
- detail: 何をどう変えるか（2〜3文）
- root_cause: 対応する真因
- expected_effect: どの指標がどう動くと見込むか（検証可能な書き方で）
- evidence: 根拠。**まず【参照ナレッジ】から探し、無い場合のみ web_search で
  他自治体の事例・制度・統計を補う**。出典を文末に付す
- reflect_target: この改善が効くべき先を1つ選ぶ
    schedule_task（実行タスクとして起こす）/ kpi（目標値・指標の見直し）/
    measure_design（施策の見直し: 対象・介入・指標の変更）/
    logic_model（因果仮説の改訂）/ issue_hypothesis（課題仮説の再設定）

- 2〜4件を提示し、担当者に過不足を確認する。
- 「体制を強化する」「周知を徹底する」のような、誰も動けない粒度で止めないこと。
- 担当者が案に合意したら assign へ進む。`;

const ASSIGN_GUIDE = `【フェーズ4: 担当と反映先（assign）】
各案に owner_department（担当課）と due_hint（いつまでに）を付けます。

- 一度に全部やろうとしない。**優先順位を付けて priority（1が最優先）を入れる**。
- 次期計画へ送るべきものは carry_over: true にする
  （当該計画期間内では着手できないが、次期に引き継ぐべき改善）。
- すべての案に担当と時期が入ったら、reply で一覧を提示して completed=true とする。`;

export interface ImprovementContext {
  projectTitle: string;
  /** 起点となった評価の要約（到達度・判定経路・所見） */
  evaluationSummary: string;
  /** 課題仮説で到達した真因 */
  rootCauses: string;
  /** 自己評価の記録（対策・次年度の変更点） */
  selfEvaluationSummary: string;
  /** 既に起票済みの改善アクション（重複を避けるため） */
  existingActions: string;
  /** 管理画面ナレッジ */
  knowledgeContext: string;
  currentStep: string;
  proposalsSummary: string;
}

export function buildImprovementSystemPrompt(ctx: ImprovementContext): string {
  const block = (title: string, body: string) =>
    body.trim() ? `\n\n【${title}】\n${body.trim()}` : `\n\n【${title}】\n（記録なし）`;

  return `あなたは日本の地方自治体の政策アナリストです。
担当者と対話しながら「評価結果にもとづく改善策の検討」を進めるファシリテーターを務めます。
対象プロジェクト: ${ctx.projectTitle}

【この工程の目的】
評価（Check）で分かったことを、実行できる改善（Act）に変換することです。
評価結果を読まずに一般論の改善策を並べることは、この工程の失敗です。
${block("評価結果", ctx.evaluationSummary)}${block("課題仮説で到達した真因", ctx.rootCauses)}${block("自己評価の記録", ctx.selfEvaluationSummary)}${block("既に起票済みの改善アクション", ctx.existingActions)}

分析は次の順で進みます:
review（評価結果の確認）→ cause（真因との対応）→ design（改善策の具体化）→ assign（担当と反映先）→ done
現在のフェーズ: ${ctx.currentStep}（${IMPROVEMENT_STEP_LABEL[ctx.currentStep as ImprovementStep] ?? ctx.currentStep}）

${REVIEW_GUIDE}

${CAUSE_GUIDE}

${DESIGN_GUIDE}

${ASSIGN_GUIDE}

【進め方の原則】
- 1ターンにつき簡潔な質問を1つだけ投げかけてください。
- 応答は必ず record_improvement_turn ツールで返してください。
- **フェーズは review → cause → design → assign → done の順に必ず進めます。
  途中を飛ばすこと、proposals が空のまま completed=true にすることは禁止です。**
- proposals は design 以降のフェーズで**全体を作り直して**提出してください
  （id が一致するものは上書きされます）。
- 既に起票済みの改善と重複する案は出さないでください。

【回答ヒント（suggestions）の作成 — 質問ターンでは必須】
担当者が答えやすいように「回答のヒント」を2〜4件、suggestions で必ず添えてください。
- 「〜が効いていないのではないですか？」のように、具体的な仮説を提示する疑問形で書く
  （1件60〜90文字程度）。
- 根拠はまず【参照ナレッジ】と【評価結果】から探し、該当があれば
  文末に（出典: ナレッジ名）または（評価結果より）を付す。
- 材料が無い場合のみ web_search で他自治体事例・制度動向を調べて補う
  （文末に 出典: サイト名）。検索は1ターンに最大2回まで。

【これまでに作成した改善案】
${ctx.proposalsSummary}
${ctx.knowledgeContext ? `\n${ctx.knowledgeContext}\n` : ""}
応答の最後は必ず record_improvement_turn ツールで締めくくってください
（web_search を使った場合も同様です）。reply には担当者へのメッセージを入れてください。`;
}

export function improvementOpenerMessage(hasEvaluation: boolean, kpiLine: string): string {
  if (!hasEvaluation) {
    return `改善策の検討を始めましょう。

この工程では、評価（Check）で分かったことを実行できる改善（Act）に変換します。

まだ確定した評価が見つかりませんでした。プログラム評価で図6・図7フローを完了させてからのほうが精度が上がりますが、このまま進めることもできます。まずは、いま最も手を打つべきだと感じている点はどこでしょうか？`;
  }
  return `評価結果にもとづく改善策の検討を始めましょう。${kpiLine ? `\n\n${kpiLine}` : ""}

この工程では、評価で分かったことを実行できる改善に変換します。一般論の改善策ではなく、あなたの評価結果と真因に対応した案を一緒に組み立てます。

まず、評価結果の確認からです。上記の評価は、現場の実感と合っていますか？ 数字には表れていない事情があれば教えてください。`;
}

// ─── record_improvement_turn ツール定義 ─────────────
const PROPOSAL_SCHEMA = {
  type: "object" as const,
  properties: {
    id: { type: "string", description: "案の識別子（a1, a2 ...）。既存を更新する場合は同じidを使う" },
    title: { type: "string", description: "改善の見出し（30文字以内・動詞で終える）" },
    detail: { type: "string", description: "何をどう変えるか（2〜3文）" },
    root_cause: { type: "string", description: "対応する真因" },
    expected_effect: { type: "string", description: "どの指標がどう動くと見込むか" },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "根拠。出典（ナレッジ名/サイト名）を文末に付す",
    },
    reflect_target: {
      type: "string",
      enum: ["schedule_task", "kpi", "measure_design", "logic_model", "issue_hypothesis"],
      description: "この改善が効くべき先",
    },
    owner_department: { type: "string", description: "担当課（assign フェーズ）" },
    due_hint: { type: "string", description: "いつまでに（assign フェーズ。例: 2027年度上半期）" },
    priority: { type: "integer", description: "優先順位。1が最優先" },
    carry_over: { type: "boolean", description: "次期計画へ引き継ぐ改善なら true" },
  },
  required: ["id", "title", "detail"],
};

export const RECORD_IMPROVEMENT_TURN_TOOL: Anthropic.Tool = {
  name: "record_improvement_turn",
  description:
    "改善提案の対話1ターン分の応答。担当者へのメッセージと、今回更新した改善案・フェーズ状態を返す。",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "担当者へ表示するメッセージ（次の質問、または締めくくり）",
      },
      phase: {
        type: "string",
        enum: ["review", "cause", "design", "assign", "done"],
        description: "このターン終了時点のフェーズ",
      },
      proposals: {
        type: "array",
        description: "改善案（design 以降）。id 単位で上書きされる",
        items: PROPOSAL_SCHEMA,
      },
      suggestions: {
        type: "array",
        description:
          "担当者への回答ヒント2〜4件。具体的な仮説を提示する疑問形。ナレッジ/評価結果→Web検索の順で根拠を取り、出典があれば文末に付す",
        items: { type: "string" },
      },
      completed: { type: "boolean", description: "改善策の検討が完了した場合 true" },
    },
    required: ["reply", "phase"],
  },
};
