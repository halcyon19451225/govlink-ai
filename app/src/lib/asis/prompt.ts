// 対話型の現状整理（As-Is分析）の AI システムプロンプト構築（サーバー専用）
import type Anthropic from "@anthropic-ai/sdk";
import type { SwotData } from "./types";
import {
  PESTLE_ORDER,
  PESTLE_META,
  SEVEN_S_ORDER,
  SEVEN_S_META,
} from "./types";

// 外部環境分析: PESTLE
const EXTERNAL_GUIDE = `【外部環境分析フェーズ（external）】
外部環境を整理します。PESTLE分析の6つの視点から、この指標に影響する外部要因を質問してください:
- P (Politics 政治): 政権の方針・政策動向・補助金制度
- E (Economy 経済): 経済情勢・財政状況・物価/人件費動向
- S (Society 社会): 人口動態・住民意識・ライフスタイル変化
- T (Technology 技術): DX・新技術・システム標準化の動き
- L (Legal 法規制): 法改正・制度改正・規制緩和/強化
- E (Environment 環境): 自然環境・気候変動・地域の地理特性

各視点について1問ずつ簡潔に質問し、回答から機会・脅威を抽出してください。
全視点を尋ねる必要はなく、指標に関連が深い3〜4視点を選んで質問してください。
抽出時は各項目にPESTLEのどの視点かをタグ付けしてください（pestle フィールド）。`;

// 内部環境分析: マッキンゼー7S
const INTERNAL_GUIDE = `【内部環境分析フェーズ（internal）】
内部環境を整理します。マッキンゼーの7Sフレームワークの視点から、自組織・地域の状況を質問してください:

ハードの3S:
- Strategy (戦略): 既存の計画・施策の方向性
- Structure (組織構造): 担当部署・連携体制・人員配置
- System (システム・制度): 業務プロセス・予算制度・情報システム

ソフトの4S:
- Shared Values (共通の価値観): 組織の理念・住民との共通認識
- Skills (スキル): 職員の専門性・組織のノウハウ
- Staff (人材): 人員の量・質・専門職の有無
- Style (組織風土): 意思決定の仕方・チャレンジへの姿勢

各視点について簡潔に質問し、回答から強み・弱みを抽出してください。
全視点を尋ねる必要はなく、指標に関連が深い3〜4視点を選んで質問してください。
抽出時は各項目に7Sのどの視点かをタグ付けしてください（seven_s フィールド）。`;

// クロス分析
const CROSS_GUIDE = `【クロス分析フェーズ（cross）】
これまでに整理した強み・弱み・機会・脅威を掛け合わせ、4つの戦略を提案してください:
- SO戦略（強み×機会）: 強みを活かして機会を最大化する積極化戦略
- WO戦略（弱み×機会）: 弱みを補強して機会を取りこぼさない改善戦略
- ST戦略（強み×脅威）: 強みで脅威に対抗する差別化戦略
- WT戦略（弱み×脅威）: 弱みと脅威による最悪シナリオを避ける防衛/撤退戦略
利用者に4戦略の要点を分かりやすく提示し、cross_analysis（so/wo/st/wt すべて1件以上）を出力したうえで completed=true としてください。

【重要な禁止事項】
cross_analysis を出力しないまま phase="done" や completed=true にすることは禁止です。
internal フェーズの質問を終えたら、必ず phase="cross" に移行し、cross_analysis の4戦略を
提示するターンを挟んでから完了してください。internal の最後の回答を受け取ったターンで
いきなり完了扱いにしてはいけません。`;

const PESTLE_LEGEND = PESTLE_ORDER.map(
  (k) => `${k}=${PESTLE_META[k].label}(${PESTLE_META[k].full})`,
).join(", ");

const SEVEN_S_LEGEND = SEVEN_S_ORDER.map(
  (k) => `${k}=${SEVEN_S_META[k].label}`,
).join(", ");

function swotSummary(swot: SwotData): string {
  const fmtExt = (items: { text: string; pestle: string }[]) =>
    items.length === 0
      ? "（まだなし）"
      : items.map((i) => `[${i.pestle}] ${i.text}`).join(" / ");
  const fmtInt = (items: { text: string; seven_s: string }[]) =>
    items.length === 0
      ? "（まだなし）"
      : items.map((i) => `[${i.seven_s}] ${i.text}`).join(" / ");
  return [
    `機会(Opportunities): ${fmtExt(swot.opportunities)}`,
    `脅威(Threats): ${fmtExt(swot.threats)}`,
    `強み(Strengths): ${fmtInt(swot.strengths)}`,
    `弱み(Weaknesses): ${fmtInt(swot.weaknesses)}`,
  ].join("\n");
}

// 紐付いたKPIのコンテキスト（ギャップ分析と連携）
export interface KpiContext {
  indicatorName: string;
  targetValue: number | null;
  unit: string;
  condition: "lte" | "lt" | "gte" | "gt" | "eq" | null;
  deadline: string | null; // "YYYY-MM-DD"
  currentValue: number | null;
  gapValue: number | null;
}

const CONDITION_LABEL: Record<NonNullable<KpiContext["condition"]>, string> = {
  gte: "以上",
  gt: "超",
  lte: "以下",
  lt: "未満",
  eq: "達成",
};

function fmtDeadline(d: string | null): string {
  if (!d) return "未設定";
  const [y, m] = d.split("-");
  return `${y}年${parseInt(m ?? "1", 10)}月`;
}

// KPIコンテキストを対話プロンプト用のテキストに整形
export function buildKpiContextText(k: KpiContext): string {
  const cond = k.condition ? CONDITION_LABEL[k.condition] : "以上";
  const target =
    k.targetValue != null ? `${k.targetValue}${k.unit}${cond}` : "未設定";
  const current = k.currentValue != null ? `${k.currentValue}${k.unit}` : "未入力";
  const gap =
    k.gapValue != null
      ? `${k.gapValue > 0 ? "+" : ""}${k.gapValue}${k.unit}`
      : "未算出";
  return `分析対象の指標: ${k.indicatorName}
目標: ${target}（期限: ${fmtDeadline(k.deadline)}）
現状値: ${current}
ギャップ: ${gap}
この指標のギャップが生じている要因を現状整理を通じて明らかにします。`;
}

/**
 * システムプロンプトを組み立てる。
 *
 * **並び順はプロンプトキャッシュの効き方を決める。**
 * 対話中ずっと変わらないもの（役割・工程ガイド・プロジェクト情報・参照ナレッジ・
 * コーパス接地）を stable に、毎ターン変わるもの（現在のフェーズ・整理済みのSWOT）を
 * volatile に置く。混ぜて1本にすると可変部より前しか一致せず読み出しが当たらない。
 */
export function buildSystemPrompt(opts: {
  projectTitle: string;
  kpiLabel: string | null;
  kpiContext?: KpiContext | null;
  currentStep: string;
  swot: SwotData;
  knowledgeContext?: string;
  /** 横断コーパスの接地ブロック（X4・assistモードのとき注入） */
  corpusBlock?: string | null;
}): { stable: string; volatile: string } {
  const { projectTitle, kpiLabel, kpiContext, currentStep, swot, knowledgeContext, corpusBlock } =
    opts;
  const target = kpiLabel
    ? `指標「${kpiLabel}」`
    : "プロジェクト全体の現状";
  const kpiBlock = kpiContext ? `\n\n【${buildKpiContextText(kpiContext)}】` : "";
  const knowledgeBlock = knowledgeContext
    ? `\n\n${knowledgeContext}\n`
    : "";
  const corpusGroundingBlock = corpusBlock
    ? `\n\n${corpusBlock}\n※ 上記コーパスは検収済みデータ（類似施策・エビデンスは他自治体の匿名データ、
  環境情報は政策パッケージ・制度・地域統計等の出典つき事実）です。
  情報源の探索順序: ①ナレッジ → ①' 上記コーパス → ② web_search（①・①'で不足するときだけ）。
  環境情報ブロックは、外部環境(O/T)には政策・制度・トレンドを、内部環境(S/W)には地域統計
  （自地域値と全国値の比較）を材料にしてください。使うときは「（コーパス: ◯◯）」と出所を添えて、
  当自治体との規模・体制の違いを確認してください。\n`
    : "";
  const stable = `あなたは日本の地方自治体の政策アナリストです。
担当者と対話しながら「現状整理（As-Is分析）」を進めるファシリテーターを務めます。
対象プロジェクト: ${projectTitle}
分析対象: ${target}${kpiBlock}

分析は次の順で進みます: external（外部環境/PESTLE）→ internal（内部環境/7S）→ cross（クロス分析）→ done。

${EXTERNAL_GUIDE}

${INTERNAL_GUIDE}

${CROSS_GUIDE}

【進め方の原則】
- 1ターンにつき簡潔な質問を1つだけ投げかけてください（長文・箇条書きの質問攻めは避ける）。
- 担当者の回答から要因を抽出したら record_turn ツールで構造化して返してください。
- 各フェーズで関連の深い3〜4視点を尋ね終えたら、次のフェーズへ自然に移行し phase を更新してください。
- external では new_opportunities / new_threats（pestle タグ必須）を抽出。
- internal では new_strengths / new_weaknesses（seven_s タグ必須）を抽出。
- cross では cross_analysis（so/wo/st/wt）を作成し completed=true。
- **フェーズは必ず external → internal → cross → done の順に進めてください。cross を飛ばして
  done にすること・cross_analysis 未出力のまま completed=true にすることは禁止です。**
- 既に抽出済みの項目は再度返さず、今回の回答から新たに分かった項目のみを new_* に入れてください。

【回答ヒント（suggestions）の作成 — 毎ターン必須】
質問を投げかけるターンでは、担当者が答えやすいように「回答のヒント」を2〜4件、
suggestions フィールドで必ず添えてください。書き方のルール:
- 「〜という強みがあるのではないですか？」「〜が追い風になっていませんか？」のように、
  具体的な仮説を提示して知見を引き出す疑問形で書く（1件60〜90文字程度）。
- 根拠はまず【参照ナレッジ】の記載から探す。ナレッジに関連する記載がある場合は
  必ずそれを優先し、文末に（出典: ナレッジ名）を付す。
- ナレッジに十分な材料がない場合のみ web_search ツールで最新の政策動向・統計・
  他自治体事例を調べて補完する（文末に 出典: サイト名 を付す）。検索は1ターンに
  最大2回まで。検索結果が乏しければ一般的な行政実務の知見から仮説を立ててよい
  （その場合は出典表記は不要）。
- cross フェーズと完了ターンでは suggestions は不要（空でよい）。

【タグの凡例】
PESTLE: ${PESTLE_LEGEND}
7S: ${SEVEN_S_LEGEND}

${knowledgeBlock}${corpusGroundingBlock}
応答の最後は必ず record_turn ツールで締めくくってください（web_search を使った場合も、
最終的な応答は必ず record_turn で返します）。reply には担当者へのメッセージ
（次の質問または締めくくり）を入れてください。`;

  // ここから下は毎ターン変わる。キャッシュの区切りより後ろに置く
  const volatile = `現在のフェーズ: ${currentStep}

【これまでに整理済みのSWOT】
${swotSummary(swot)}`;

  return { stable, volatile };
}

// 対話開始時の最初のメッセージ（external フェーズ）
export function openerMessage(
  kpiLabel: string | null,
  kpiContext?: KpiContext | null,
): string {
  const target = kpiLabel ? `指標「${kpiLabel}」` : "このプロジェクト";
  const contextBlock = kpiContext
    ? `${buildKpiContextText(kpiContext)}\n\n`
    : "";
  return `${contextBlock}${target}の現状整理を始めましょう。まずは外部環境（PESTLE）から確認します。\n\n直近の国・都道府県の政策動向や補助金制度のうち、この取り組みに追い風または逆風になりそうなものはありますか？`;
}

// record_turn ツール定義
export const RECORD_TURN_TOOL: Anthropic.Tool = {
  name: "record_turn",
  description:
    "対話の1ターン分の応答。担当者へのメッセージと、今回新たに抽出した要因・フェーズ状態を返す。",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "担当者へ表示するメッセージ（次の質問、または締めくくり）",
      },
      phase: {
        type: "string",
        enum: ["external", "internal", "cross", "done"],
        description: "このターン終了時点での分析フェーズ",
      },
      new_opportunities: {
        type: "array",
        description: "今回新たに抽出した機会（external フェーズ）",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            pestle: { type: "string", enum: ["P", "E", "S", "T", "L", "Env"] },
          },
          required: ["text", "pestle"],
        },
      },
      new_threats: {
        type: "array",
        description: "今回新たに抽出した脅威（external フェーズ）",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            pestle: { type: "string", enum: ["P", "E", "S", "T", "L", "Env"] },
          },
          required: ["text", "pestle"],
        },
      },
      new_strengths: {
        type: "array",
        description: "今回新たに抽出した強み（internal フェーズ）",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            seven_s: {
              type: "string",
              enum: [
                "strategy",
                "structure",
                "system",
                "shared_values",
                "skills",
                "staff",
                "style",
              ],
            },
          },
          required: ["text", "seven_s"],
        },
      },
      new_weaknesses: {
        type: "array",
        description: "今回新たに抽出した弱み（internal フェーズ）",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            seven_s: {
              type: "string",
              enum: [
                "strategy",
                "structure",
                "system",
                "shared_values",
                "skills",
                "staff",
                "style",
              ],
            },
          },
          required: ["text", "seven_s"],
        },
      },
      cross_analysis: {
        type: "object",
        description: "クロス分析の4戦略（cross フェーズで作成）",
        properties: {
          so: { type: "array", items: { type: "string" } },
          wo: { type: "array", items: { type: "string" } },
          st: { type: "array", items: { type: "string" } },
          wt: { type: "array", items: { type: "string" } },
        },
      },
      suggestions: {
        type: "array",
        description:
          "担当者への回答ヒント2〜4件。「〜という強みがあるのではないですか？」のような仮説提示の疑問形。ナレッジ→Web検索の順で根拠を取り、出典があれば文末に付す",
        items: { type: "string" },
      },
      completed: {
        type: "boolean",
        description: "現状整理が完了した場合 true",
      },
    },
    required: ["reply", "phase"],
  },
};
