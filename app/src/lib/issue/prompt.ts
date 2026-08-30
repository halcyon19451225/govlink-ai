// 対話型の課題仮説設定の AI システムプロンプト構築（サーバー専用）
//
// 手順の骨格は JIS Q 9024:2003（継続的改善の手順及び技法の指針）に準拠し、
// 「問題」と「課題」を同規格の定義どおりに区別して扱う。
// 技法は同規格に挙げられた特性要因図・パレート図/マトリックス図（重点指向）と、
// トヨタ生産方式で体系化されたなぜなぜ分析を用いる。

import type Anthropic from "@anthropic-ai/sdk";
import type { CrossAnalysis, SwotData } from "@/lib/asis/types";
import { PESTLE_META, PESTLE_ORDER, SEVEN_S_META, SEVEN_S_ORDER } from "@/lib/asis/types";
import {
  ISSUE_STEP_LABEL,
  PROBLEM_ORIGIN_META,
  PROBLEM_ORIGIN_KEYS,
  SELECTION_WEIGHTS,
  findSelectionInconsistencies,
  type IssueDialogueData,
} from "./types";

// ─── 各フェーズのガイド ──────────────────────────
const PROBLEMS_GUIDE = `【フェーズ1: 問題の洗い出し（problems）】
JIS Q 9024 の定義に従い、ここで扱う「問題」＝設定してある目標と現実との、
対策して克服する必要のあるギャップです。

現状整理（As-Is分析）で得られた SWOT の弱み(W)・脅威(T) と、
クロス分析の WO戦略・WT戦略・ST戦略を主な起点として、
この指標のギャップを生んでいる問題の候補を洗い出してください。

- new_problems に問題候補を入れる。**origin には必ずその問題の出所を指定**する
  （weakness / threat / wo / wt / st / so / gap / dialogue）。
- 現状整理の記述を引用した場合は source_text にその原文を入れる（根拠の追跡のため）。
- factor には特性要因図の大骨となる PESTLE または 7S のキーを入れる。
- 1ターンにつき2〜4件を提示し、担当者に過不足を確認する。
- 担当者が挙げた問題は origin="dialogue" で追加する。
- 合計5件以上の問題候補が出そろい、担当者が「他にない」と答えたら selection へ進む。

**問題IDの扱い（厳守）**
- 【これまでの整理内容】に出ている問題ID（p1, p2, …）が正本です。
  **返答の中で番号を振り直さないでください。** 保存済みのIDと文言の対応が崩れると、
  選別・真因・仮説が別の問題に付いてしまいます（実際に起きた事故です）。
- 担当者から「AとBは同じなのでまとめてほしい」と言われたら、**merge_problems** で統合します。
  返答の文章の中だけで統合したことにしてはいけません。統合された側のIDは退役し、
  以降の一覧には出なくなります（IDの再利用はしません）。
- 文言だけを直す場合は **problem_updates** を使い、IDは変えないでください。`;

const SELECTION_GUIDE = `【フェーズ2: 課題の選別（selection）】
洗い出した問題のうち「特に解決すべきもの」を選び出します（重点指向）。
JIS Q 9024 のパレート図・マトリックス図に相当する絞り込みです。
ここで選ばれたものが、同規格の定義でいう「課題」＝設定しようとする目標と
現実との、対処を必要とするギャップになります。

各問題を次の3軸で1〜5点で評価してください（selection フィールド）:
- impact 影響度: この問題が指標のギャップにどれだけ寄与しているか
- controllability 関与可能性: 自治体の施策でどれだけ動かせるか
- urgency 緊急性: 先送りした場合にどれだけ早く悪化するか
スコアは 影響度×${SELECTION_WEIGHTS.impact} + 関与可能性×${SELECTION_WEIGHTS.controllability} + 緊急性×${SELECTION_WEIGHTS.urgency}（各軸を0〜100に正規化）で自動計算されます。
reason には点数の根拠を1文で書いてください。

- **すべての問題について selection を出力**してください（未評価を残さない。退役した問題は除く）。
- 各項目の **problem_text_echo に、その問題IDの保存済み文言の冒頭をそのまま引き写して**ください。
  IDの取り違えをサーバー側で検出するための照合用です（自分で言い換えた要約ではなく原文の引き写し）。
- selected=true は上位2〜3件に絞ってください（全部やろうとしないのが重点指向です）。
- **選定は原則としてスコアの上位から**。選外より低いスコアの問題を選定する場合は、
  点数のほうが実態に合っていない可能性を先に疑い、必要なら3軸を付け直してください。
  それでも低スコアを選ぶ判断をするなら、reason にその理由を明記してください。
- 担当者の指示で選定を差し替えたときは、**点数も対象の問題に合わせて付け直す**こと。
  選定フラグだけ動かして点数を前の並びのまま残さないでください。
- 評価案を提示して担当者に確認し、修正があれば selection を作り直して再提出する。
- 担当者が選定に同意したら rootcause へ進む。`;

const ROOTCAUSE_GUIDE = `【フェーズ3: 真因分析（rootcause）】
selected=true の課題**ひとつずつ**について、真因に到達します。
2つの技法を順に使ってください。

(1) 特性要因図（石川ダイアグラム）
    大骨は現状整理と同じ PESTLE（外部環境）/ 7S（内部環境）のタグを使います。
    課題に効いていそうな大骨を3〜5本立て、それぞれに小骨（具体的な要因）を
    2〜4件ぶら下げてください（bones フィールド）。

(2) なぜなぜ分析
    特性要因図で見えた要因のうち最も効いていそうなものを起点に「なぜ？」を
    繰り返し、**最大5段**まで掘り下げます（whys フィールド。level は1から）。
    - 1ターンに1つだけ「なぜ？」を問いかけ、担当者の答えを answer に記録する。
    - 担当者の答えが薄い場合は suggestions で具体的な仮説を提示して引き出す。
    - 「担当者の能力不足」「意識が低い」のような人責めで止めないこと。
      仕組み・制度・情報・資源配分の欠陥まで掘ること（これは真因追究の原則です）。
    - これ以上掘ると自治体の裁量を超える、という段で止めて root_cause を確定する。

- root_causes は問題ごとに1件。root_cause には到達した真因を1〜2文で書く。
- selected の課題すべてで root_cause が埋まったら hypothesis へ進む。`;

const HYPOTHESIS_GUIDE = `【フェーズ4: 課題仮説の定式化（hypothesis）】
真因ごとに、検証可能な課題仮説へ整えます（EBPMの効果検証の入口になります）。

hypotheses に次を作成してください:
- title: 課題仮説の見出し（30文字以内）
- statement: 「〈真因〉を〈手段の方向性〉によって解消すれば、〈指標〉が〈どの向きに・どの程度〉改善するはずだ」
  という形の、検証可能な1文。指標名と向きを必ず含める。
- root_cause: フェーズ3で到達した真因
- evidence: 根拠。**まず【参照ナレッジ】から探し、無い場合のみ web_search で補う**。
  出典（ナレッジ名 / サイト名）を各要素の文末に必ず付す。
- measures: 真因に対応する施策の方向性（3〜5件）
- verification: この仮説をどう検証するか（比較対象・データ・時期）

- 4戦略すべてを提示して担当者の合意を得たうえで completed=true とする。`;

const PESTLE_LEGEND = PESTLE_ORDER.map(
  (k) => `${k}=${PESTLE_META[k].label}(${PESTLE_META[k].full})`,
).join(", ");

const SEVEN_S_LEGEND = SEVEN_S_ORDER.map((k) => `${k}=${SEVEN_S_META[k].label}`).join(", ");

const ORIGIN_LEGEND = PROBLEM_ORIGIN_KEYS.map(
  (k) => `${k}=${PROBLEM_ORIGIN_META[k].label}`,
).join(", ");

// ─── コンテキスト整形 ────────────────────────────
export interface IssueKpiContext {
  indicatorName: string;
  unit: string;
  targetValue: number | null;
  currentValue: number | null;
  gapValue: number | null;
  deadline: string | null;
  trend: string | null;
}

const TREND_LABEL: Record<string, string> = {
  improving: "改善傾向",
  worsening: "悪化傾向",
  stable: "横ばい",
  unknown: "不明",
};

export function buildIssueKpiText(k: IssueKpiContext): string {
  const u = k.unit ?? "";
  const fmt = (v: number | null) => (v != null ? `${v}${u}` : "未入力");
  const lines = [
    `分析対象の指標: ${k.indicatorName}`,
    `目標値: ${fmt(k.targetValue)}${k.deadline ? `（期限: ${k.deadline}）` : ""}`,
    `現状値: ${fmt(k.currentValue)}`,
    `ギャップ: ${k.gapValue != null ? `${k.gapValue > 0 ? "+" : ""}${k.gapValue}${u}` : "未算出"}`,
  ];
  if (k.trend) lines.push(`トレンド: ${TREND_LABEL[k.trend] ?? k.trend}`);
  return lines.join("\n");
}

/** 現状整理（As-Is）の結果を対話プロンプト用に整形する */
export function buildAsisContextText(
  swot: SwotData | null,
  cross: CrossAnalysis | null,
): string {
  if (!swot && !cross) return "";
  const lines: string[] = ["【現状整理（As-Is分析）の結果 — 問題洗い出しの起点】"];

  if (swot) {
    const ext = (items: { text: string; pestle: string }[]) =>
      items.length === 0 ? "（なし）" : items.map((i) => `[${i.pestle}] ${i.text}`).join(" / ");
    const int = (items: { text: string; seven_s: string }[]) =>
      items.length === 0 ? "（なし）" : items.map((i) => `[${i.seven_s}] ${i.text}`).join(" / ");
    lines.push(`■ 強み(S): ${int(swot.strengths)}`);
    lines.push(`■ 弱み(W): ${int(swot.weaknesses)}`);
    lines.push(`■ 機会(O): ${ext(swot.opportunities)}`);
    lines.push(`■ 脅威(T): ${ext(swot.threats)}`);
  }

  if (cross) {
    const fmt = (arr: string[]) => (arr.length === 0 ? "（なし）" : arr.join(" / "));
    lines.push(`■ SO戦略(強み×機会): ${fmt(cross.so)}`);
    lines.push(`■ WO戦略(弱み×機会): ${fmt(cross.wo)}`);
    lines.push(`■ ST戦略(強み×脅威): ${fmt(cross.st)}`);
    lines.push(`■ WT戦略(弱み×脅威): ${fmt(cross.wt)}`);
  }

  return lines.join("\n");
}

/** これまでに整理済みの内容を要約する */
function dataSummary(d: IssueDialogueData): string {
  const lines: string[] = [];

  lines.push(
    d.problems.length === 0
      ? "問題候補: （まだなし）"
      : `問題候補（このIDと文言が正本。番号を振り直さないこと）:\n${d.problems
          .filter((p) => !p.retired)
          .map((p) => `  ${p.id} [${p.origin}${p.factor ? `/${p.factor}` : ""}] ${p.text}`)
          .join("\n")}${
          d.problems.some((p) => p.retired)
            ? `\n  （統合により退役: ${d.problems
                .filter((p) => p.retired)
                .map((p) => `${p.id}→${p.merged_into ?? "?"}`)
                .join("、")}。これらのIDは今後使わない）`
            : ""
        }`,
  );

  if (d.selection.length > 0) {
    const bad = findSelectionInconsistencies(d.problems, d.selection);
    if (bad.length > 0) {
      lines.push(
        `⚠ 選定と点数が矛盾しています（選外のほうが高得点）:\n${bad
          .map(
            (b) =>
              `  選定 ${b.selected_id}(${b.selected_score}点) < 選外 ${b.unselected_id}(${b.unselected_score}点)`,
          )
          .join("\n")}\n  → 点数の付け直しか、reason での理由の明記が必要です`,
      );
    }
    lines.push(
      `選別:\n${d.selection
        .map(
          (s) =>
            `  ${s.problem_id} 影響${s.impact}/関与${s.controllability}/緊急${s.urgency} → ${s.score}点 ${
              s.selected ? "★課題として選定" : "（選外）"
            }`,
        )
        .join("\n")}`,
    );
  } else {
    lines.push("選別: （まだなし）");
  }

  if (d.root_causes.length > 0) {
    lines.push(
      `真因分析:\n${d.root_causes
        .map(
          (r) =>
            `  ${r.problem_id} 大骨${r.bones.length}本 / なぜ${r.whys.length}段 → 真因: ${
              r.root_cause || "（未確定）"
            }`,
        )
        .join("\n")}`,
    );
  } else {
    lines.push("真因分析: （まだなし）");
  }

  lines.push(
    d.hypotheses.length > 0
      ? `課題仮説: ${d.hypotheses.map((h) => h.title).join(" / ")}`
      : "課題仮説: （まだなし）",
  );

  return lines.join("\n");
}

// ─── システムプロンプト ──────────────────────────
/**
 * システムプロンプトを組み立てる。
 *
 * **並び順はプロンプトキャッシュの効き方を決める。**
 * 対話中ずっと変わらないもの（役割・工程ガイド・プロジェクト情報・現状整理・参照ナレッジ）を
 * stable に、毎ターン変わるもの（現在のフェーズ・これまでの整理内容）を volatile に置く。
 * 混ぜて1本の文字列にすると、可変部より前しか一致せず読み出しが当たらない。
 */
export function buildIssueSystemPrompt(opts: {
  projectTitle: string;
  kpiContext: IssueKpiContext | null;
  asisContext: string;
  currentStep: string;
  data: IssueDialogueData;
  knowledgeContext?: string;
}): { stable: string; volatile: string } {
  const { projectTitle, kpiContext, asisContext, currentStep, data, knowledgeContext } = opts;

  const kpiBlock = kpiContext ? `\n\n【${buildIssueKpiText(kpiContext)}】` : "";
  const asisBlock = asisContext ? `\n\n${asisContext}` : "\n\n（現状整理の結果は未連携です。担当者への質問で補ってください）";
  const knowledgeBlock = knowledgeContext ? `\n\n${knowledgeContext}\n` : "";

  const stable = `あなたは日本の地方自治体の政策アナリストです。
担当者と対話しながら「課題仮説設定」を進めるファシリテーターを務めます。
対象プロジェクト: ${projectTitle}${kpiBlock}${asisBlock}

【この工程の目的】
目標と現状の差から問題を洗い出し、特に解決すべきもの（課題）を選別したうえで、
その真因に到達することです。手順と用語は JIS Q 9024:2003（継続的改善の手順及び
技法の指針）に準拠します。同規格では「問題」＝設定してある目標と現実との対策して
克服する必要のあるギャップ、「課題」＝設定しようとする目標と現実との対処を必要と
するギャップ、と定義されています。この区別を対話中も守ってください。

分析は次の順で進みます:
problems（問題の洗い出し）→ selection（課題の選別）→ rootcause（真因分析）→ hypothesis（仮説の定式化）→ done

${PROBLEMS_GUIDE}

${SELECTION_GUIDE}

${ROOTCAUSE_GUIDE}

${HYPOTHESIS_GUIDE}

【進め方の原則】
- 1ターンにつき簡潔な質問を1つだけ投げかけてください（長文・箇条書きの質問攻めは避ける）。
- 応答は必ず record_issue_turn ツールで返してください。
- **フェーズは problems → selection → rootcause → hypothesis → done の順に必ず進めます。
  途中のフェーズを飛ばすこと、rootcause を経ずに hypothesis や done へ進むこと、
  hypotheses が空のまま completed=true にすることは禁止です。**
- 既に記録済みの項目は new_problems に再掲しないでください。
  selection / root_causes / hypotheses は該当フェーズで**全体を作り直して**提出してください
  （problem_id が一致するものは上書きされます）。
- 担当者が「わからない」と答えた場合は、選択肢を示して答えやすくしてください。
- **制度・調査・ガイドライン・研究・統計を名前を挙げて説明するときは、必ず references に出典を入れてください。**
  出典を確認できないものは、名前を挙げずに一般論として述べるか、「確認が必要」と正直に添えてください。
  記憶に頼って正式名称や調査内容を断定しないこと（似た名前の別資料と取り違えた事例があります）。
  探索順序は他と同じで、①【参照ナレッジ】→ ②不足時のみ web_search です。

【回答ヒント（suggestions）の作成 — 質問ターンでは必須】
担当者が答えやすいように「回答のヒント」を2〜4件、suggestions で必ず添えてください。
- 「〜が効いているのではないですか？」「〜という事情はありませんか？」のように、
  具体的な仮説を提示して知見を引き出す疑問形で書く（1件60〜90文字程度）。
- 根拠はまず【参照ナレッジ】と【現状整理の結果】から探し、該当があれば
  文末に（出典: ナレッジ名）または（現状整理より）を付す。
- それらに材料が無い場合のみ web_search で他自治体事例・統計・制度動向を調べて
  補完する（文末に 出典: サイト名 を付す）。検索は1ターンに最大2回まで。
- 一般的な行政実務の知見から立てた仮説には出典表記は不要です。

【タグの凡例】
問題の出所(origin): ${ORIGIN_LEGEND}
特性要因図の大骨 PESTLE: ${PESTLE_LEGEND}
特性要因図の大骨 7S: ${SEVEN_S_LEGEND}

${knowledgeBlock}
応答の最後は必ず record_issue_turn ツールで締めくくってください（web_search を使った
場合も、最終的な応答は必ず record_issue_turn で返します）。reply には担当者への
メッセージ（次の質問または締めくくり）を入れてください。`;

  // ここから下は毎ターン変わる。キャッシュの区切りより後ろに置く
  const volatile = `現在のフェーズ: ${currentStep}（${
    ISSUE_STEP_LABEL[currentStep as keyof typeof ISSUE_STEP_LABEL] ?? currentStep
  }）

【これまでに整理済みの内容】
${dataSummary(data)}`;

  return { stable, volatile };
}

// ─── 対話開始時の最初のメッセージ ────────────────────
export function issueOpenerMessage(opts: {
  kpiContext: IssueKpiContext | null;
  hasAsis: boolean;
  problemSeeds: string[];
}): string {
  const { kpiContext, hasAsis, problemSeeds } = opts;
  const head = kpiContext ? `${buildIssueKpiText(kpiContext)}\n\n` : "";
  const target = kpiContext ? `指標「${kpiContext.indicatorName}」` : "このプロジェクト";

  if (!hasAsis) {
    return `${head}${target}の課題仮説設定を始めましょう。

この工程では、目標と現状の差から問題を洗い出し、特に解決すべきもの（課題）を選別したうえで、その真因に到達します。

この指標では現状整理（As-Is分析）がまだ完了していないため、対話の中で外部環境・内部環境の状況も伺いながら進めます。まずは、この指標が目標に届いていない原因として、現場で最も大きいと感じているものは何でしょうか？`;
  }

  const seedBlock =
    problemSeeds.length > 0
      ? `\n\n現状整理の結果からは、たとえば次のような点がギャップの要因になっていそうです。\n${problemSeeds
          .map((s) => `・${s}`)
          .join("\n")}`
      : "";

  return `${head}${target}の課題仮説設定を始めましょう。

この工程では、現状整理（As-Is分析）で整理した弱み・脅威・クロス戦略を起点に問題を洗い出し、特に解決すべきもの（課題）を選別したうえで、特性要因図となぜなぜ分析で真因に到達します。${seedBlock}

まずは問題の洗い出しから始めます。この指標のギャップを生んでいる要因として、現場で最も大きいと感じているものはどれでしょうか。上記以外でも構いません。`;
}

// ─── record_issue_turn ツール定義 ─────────────────
const PROBLEM_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    text: { type: "string", description: "問題の記述（60文字程度）" },
    origin: {
      type: "string",
      enum: PROBLEM_ORIGIN_KEYS,
      description: "この問題の出所（現状整理のどこから来たか）",
    },
    source_text: {
      type: "string",
      description: "引用元の現状整理の原文（あれば）",
    },
    factor: {
      type: "string",
      description: "特性要因図の大骨となる PESTLE または 7S のキー",
    },
  },
  required: ["text", "origin"],
};

const SELECTION_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    problem_id: { type: "string", description: "対象の問題ID（p1 など）" },
    problem_text_echo: {
      type: "string",
      description:
        "その問題IDに対応する【保存済みの問題候補】の文言の冒頭20文字程度をそのまま引き写す。IDの取り違えを検出するための照合用（必須）",
    },
    impact: { type: "integer", minimum: 1, maximum: 5, description: "影響度" },
    controllability: { type: "integer", minimum: 1, maximum: 5, description: "関与可能性" },
    urgency: { type: "integer", minimum: 1, maximum: 5, description: "緊急性" },
    selected: { type: "boolean", description: "「課題」として選定するか" },
    reason: { type: "string", description: "評価の根拠（1文）" },
  },
  required: [
    "problem_id",
    "problem_text_echo",
    "impact",
    "controllability",
    "urgency",
    "selected",
    "reason",
  ],
};

const PROBLEM_MERGE_SCHEMA = {
  type: "object" as const,
  properties: {
    into: { type: "string", description: "統合先（残す方）の問題ID" },
    from: {
      type: "array",
      description: "統合されて退役する問題ID（1件以上）",
      items: { type: "string" },
    },
    text: {
      type: "string",
      description: "統合後の問題文（省略時は統合先の文言を維持）",
    },
  },
  required: ["into", "from"],
};

const PROBLEM_UPDATE_SCHEMA = {
  type: "object" as const,
  properties: {
    problem_id: { type: "string", description: "対象の問題ID" },
    text: { type: "string", description: "差し替える問題文" },
    factor: { type: "string", description: "差し替える大骨（PESTLE / 7S）" },
  },
  required: ["problem_id"],
};

const ROOT_CAUSE_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    problem_id: { type: "string" },
    bones: {
      type: "array",
      description: "特性要因図の大骨と小骨",
      items: {
        type: "object",
        properties: {
          factor: { type: "string", description: "PESTLE または 7S のキー" },
          causes: { type: "array", items: { type: "string" } },
        },
        required: ["factor", "causes"],
      },
    },
    whys: {
      type: "array",
      description: "なぜなぜ分析（最大5段）",
      items: {
        type: "object",
        properties: {
          level: { type: "integer", minimum: 1, maximum: 5 },
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["level", "question", "answer"],
      },
    },
    root_cause: { type: "string", description: "到達した真因（1〜2文）" },
  },
  required: ["problem_id", "root_cause"],
};

const HYPOTHESIS_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    problem_id: { type: "string" },
    title: { type: "string", description: "課題仮説の見出し（30文字以内）" },
    statement: {
      type: "string",
      description: "検証可能な仮説文（真因・手段・指標・改善の向きを含む1文）",
    },
    root_cause: { type: "string" },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "根拠。出典（ナレッジ名/サイト名）を文末に付す",
    },
    measures: { type: "array", items: { type: "string" }, description: "施策の方向性3〜5件" },
    verification: { type: "string", description: "検証方法（比較対象・データ・時期）" },
  },
  required: ["problem_id", "title", "statement", "root_cause"],
};

export const RECORD_ISSUE_TURN_TOOL: Anthropic.Tool = {
  name: "record_issue_turn",
  description:
    "課題仮説設定の対話1ターン分の応答。担当者へのメッセージと、今回更新した問題・選別・真因・仮説とフェーズ状態を返す。",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "担当者へ表示するメッセージ（次の質問、または締めくくり）",
      },
      phase: {
        type: "string",
        enum: ["problems", "selection", "rootcause", "hypothesis", "done"],
        description: "このターン終了時点のフェーズ",
      },
      new_problems: {
        type: "array",
        description: "今回新たに洗い出した問題（problems フェーズ）。既出は含めない",
        items: PROBLEM_ITEM_SCHEMA,
      },
      merge_problems: {
        type: "array",
        description:
          "問題候補の統合（担当者から「まとめて」と言われた場合）。文章の上だけで統合したことにせず必ずこれを使う",
        items: PROBLEM_MERGE_SCHEMA,
      },
      problem_updates: {
        type: "array",
        description: "既存の問題候補の文言・大骨の修正（IDは変えない）",
        items: PROBLEM_UPDATE_SCHEMA,
      },
      selection: {
        type: "array",
        description:
          "課題の選別（selection フェーズ）。退役していない全問題ぶんをまとめて提出する",
        items: SELECTION_ITEM_SCHEMA,
      },
      root_causes: {
        type: "array",
        description: "真因分析（rootcause フェーズ）。problem_id 単位で上書きされる",
        items: ROOT_CAUSE_ITEM_SCHEMA,
      },
      hypotheses: {
        type: "array",
        description: "課題仮説（hypothesis フェーズ）。problem_id 単位で上書きされる",
        items: HYPOTHESIS_ITEM_SCHEMA,
      },
      references: {
        type: "array",
        description:
          "返答の中で制度・調査・ガイドライン・研究・統計を名前を挙げて説明した場合の出典（必須）。担当者は計画書に載せて議会・審議会で根拠を問われるため、名称は正式名称で、可能ならURLも付ける",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "正式な資料名・調査名" },
            url: { type: "string", description: "URL（分かる場合）" },
            note: { type: "string", description: "そこから何を引いたか" },
          },
          required: ["title"],
        },
      },
      suggestions: {
        type: "array",
        description:
          "担当者への回答ヒント2〜4件。「〜が効いているのではないですか？」のような仮説提示の疑問形。ナレッジ/現状整理→Web検索の順で根拠を取り、出典があれば文末に付す",
        items: { type: "string" },
      },
      completed: {
        type: "boolean",
        description: "課題仮説設定が完了した場合 true",
      },
    },
    required: ["reply", "phase"],
  },
};
