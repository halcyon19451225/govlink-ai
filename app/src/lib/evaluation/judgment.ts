/**
 * 評価判定の体系（図E1〜E5・様式No.1〜9）— 正本は `claude/coe-eval-report-forms.md`。
 *
 * この体系の要点:
 *   ①4つの問いで判定記号（A〜K）を出す（図E1）
 *   ②記号列が11経路のどれかに落ち、9種の報告書No.が機械的に決まる
 *   ③報告書No.から反映ルート（A校正/B再設計/C移植/D構造）と**標準処遇**が決まる
 *   ④標準処遇と異なる決定をするときだけ理由書（comply or explain）
 *
 * つまり「この施策をどうするか」は担当者の裁量ではなく、**判定から機械的に導く**。
 * 裁量は「標準処遇に従わない理由を書く」ところにだけ置く。これが形骸化への予防になる。
 *
 * ここは純粋関数だけを置く（DBもUIも持たない）。判定の入力を作るのはサーバー側、
 * 結果を表示するのは画面側。
 */

// ─── 判定記号（図E1）─────────────────────────────────────────

/**
 * A … 成果が目標値に達した
 * B … 成果が目標値に未達
 * C … （未達だが）目標値に近づいている（3か年の傾向で判定）
 * I … （未達で）近づいてもいない
 * D … 成果の変化は初期アウトカム（施策の働き）に起因しない
 * E … 成果の変化は初期アウトカムに起因する
 * F … （起因しない）別要因が不明
 * G … （起因しない）別要因を特定でき、人為的に再現可能
 * H … （起因しない）別要因は特定できたが再現不能
 * J … （起因する）財政効果率100%以上＝投入は適切
 * K … （起因する）財政効果率100%未満＝投入は不適切
 */
export type JudgmentMark = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";

export const MARK_MEANING: Record<JudgmentMark, string> = {
  A: "成果は目標値に達した",
  B: "成果は目標値に未達",
  C: "未達だが目標値に近づいている",
  I: "未達で、近づいてもいない",
  D: "成果の変化は施策の働きに起因しない",
  E: "成果の変化は施策の働きに起因する",
  F: "別の要因が不明",
  G: "別の要因を特定でき、再現可能",
  H: "別の要因は特定できたが再現不能",
  J: "財政効果率100%以上（投入は適切）",
  K: "財政効果率100%未満（投入は不適切）",
};

// ─── 4つの問い（図E1）───────────────────────────────────────

export type Q1 = "met" | "not_met"; // 成果は目標値に達したか
export type Q2 = "approaching" | "not_approaching"; // 近づいているか（3か年傾向）
export type Q3 = "attributable" | "not_attributable"; // 初期アウトカムに起因するか
export type Q4a = "reproducible" | "unknown" | "not_reproducible"; // 別要因は再現可能か
export type Q4b = "efficient" | "inefficient"; // 財政効果率100%以上か

export interface JudgmentAnswers {
  q1: Q1;
  /** q1 = not_met のときだけ */
  q2?: Q2;
  /** q2 = approaching または q1 = met のときだけ */
  q3?: Q3;
  /** q3 = not_attributable のときだけ */
  q4a?: Q4a;
  /** q3 = attributable のときだけ */
  q4b?: Q4b;
}

// ─── 反映ルート（4系統）─────────────────────────────────────

export type ReflectRoute = "A" | "B" | "C" | "D";

export const ROUTE_META: Record<
  ReflectRoute,
  { name: string; nature: string; review: string }
> = {
  A: {
    name: "校正（単一ループ）",
    nature: "理論は正しい。目標水準・展開範囲のみ調整する",
    review: "一括報告",
  },
  B: {
    name: "再設計（二重ループ）",
    nature: "理論が外れた／寄与が立たない。因果理論の作り直し・資源の引き上げ",
    review: "個別審議",
  },
  C: {
    name: "移植（知識移転）",
    nature: "実地で有効な手段を発見した。文書化し段階設計で取組にする",
    review: "段階設計の承認",
  },
  D: {
    name: "構造（費用再設計）",
    nature: "効いているが費用が回収できない。効果水準を保ったまま費用構造を組み替える",
    review: "費用計画の承認",
  },
};

// ─── 課題の所在4分類と標準フレームワーク（図E5・図7-5）──────

export type IssueClass = "I" | "II" | "III" | "IV" | "none";

export const ISSUE_CLASS_META: Record<
  Exclude<IssueClass, "none">,
  { name: string; where: string; frameworks: string[]; aim: string }
> = {
  I: {
    name: "Ⅰ 実行",
    where: "取組が実施されない／量が出ない",
    frameworks: ["なぜなぜ分析（5回）", "資源監査（ヒト・カネ・時間・依存関係）"],
    aim: "実施を阻む真のボトルネックを特定し、体制側の手当てか取組差替かを決める",
  },
  II: {
    name: "Ⅱ 論理",
    where: "実施しても変化が生じない／因果が立たない",
    frameworks: [
      "ロジックツリー（Why型）",
      "特性要因図",
      "ロジックモデル再構築（インパクトマップ）",
    ],
    aim: "真因仮説を立て直し、変化が見込める介入点を選び直す",
  },
  III: {
    name: "Ⅲ 効率",
    where: "変化は生じたが投入に見合わない",
    frameworks: ["単価分解ツリー", "ECRS（排除→結合→交換→簡素化）", "ポートフォリオ4象限"],
    aim: "費用の発生源を特定し、効果を落とさず費用構造を組み替える",
  },
  IV: {
    name: "Ⅳ 測定",
    where: "判定に必要な情報がない／指標が機能しない",
    frameworks: ["対照群設計", "KPIツリー", "比較の段の引き上げ"],
    aim: "次期は判定可能なデータが自動的に貯まる状態を計画段階で作る",
  },
};

/** フレームワーク選択の4原則（図E5） */
export const FRAMEWORK_PRINCIPLES: readonly string[] = [
  "課題の所在に合わせる — 判定が示す分類（Ⅰ実行／Ⅱ論理／Ⅲ効率）と別系統の道具を選ばない",
  "順序を守る — 各様式C欄の①②③は順序に意味がある（ECRSは排除→結合→交換→簡素化）",
  "上流から下流へ — 真因の特定 → 介入点の選択 → 目標設定の順（目標設定から入らない）",
  "使わない判断も記録する — 用いない場合は代わりの根拠をC欄に記す（空欄のまま進めない）",
] as const;

// ─── 比較の段（寄与判定に用いた比較方法の格付け）────────────

export type ComparisonGrade = "A" | "B" | "C" | "D";

export const COMPARISON_GRADE_META: Record<ComparisonGrade, { name: string; detail: string }> = {
  A: {
    name: "無作為割付",
    detail: "待機者抽選（定員超過時）、展開順序の無作為化（ステップド・ウェッジ）",
  },
  B: {
    name: "設計を伴う準実験",
    detail: "傾向スコア法・差の差分析・（比較）中断時系列・合成対照法・回帰不連続",
  },
  C: {
    name: "ベースライン比較",
    detail: "自然体推計との差で効果幅Xを取る。財政効果率の算定はこの段以上が要件",
  },
  D: {
    name: "前後比較・事例・記述",
    detail: "前後比較、単一事例デザイン・GAS・事例集積。スモールN施策の標準",
  },
};

/** 実験設計（measure_designs.experiment.design）から比較の段を推定する */
export function comparisonGradeOfDesign(design: string | null | undefined): ComparisonGrade | null {
  if (!design) return null;
  switch (design) {
    case "rct":
    case "cluster_rct":
    case "stepped_wedge":
    case "waitlist":
      return "A";
    case "rdd":
    case "did":
    case "synthetic_control":
    case "matching":
    case "iv":
    case "its":
      return "B";
    case "prepost":
      return "D";
    default:
      return null;
  }
}

// ─── 報告書パターン（11経路 → 9報告書）─────────────────────

export type ReportNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ReportPattern {
  no: ReportNo;
  /** 記号列（例: "A→E→K"） */
  marks: string;
  /** 状態の意味 */
  state: string;
  /** 報告書の性格 */
  title: string;
  issueClass: IssueClass;
  /** 対策立案の型（C欄の骨） */
  approach: string;
  route: ReflectRoute;
  /** 標準処遇（初期値。異なる決定には理由書が要る） */
  standardTreatment: string;
  /** 次期計画の反映先（①課題・真因 ②施策・取組 ③指標・目標 ④資源配分 ⑤総論） */
  reflectTargets: string[];
  /** 固有の要点（早見表より） */
  keyPoint: string;
}

export const REPORT_PATTERNS: Record<ReportNo, ReportPattern> = {
  1: {
    no: 1,
    marks: "B→I",
    state: "未達で、近づいてもいない",
    title: "施策中止・再設計報告書",
    issueClass: "I",
    approach: "なぜなぜ分析 → ロジックモデル再構築",
    route: "B",
    standardTreatment: "廃止／他取組への差替／課題仮説からの再設計（再配分先を併記）",
    reflectTargets: ["①課題・真因", "②取組構成", "④資源配分"],
    keyPoint:
      "起点は実行起因か論理起因かの切り分け。実行起因なら実施体制の再編とセットで差し替え、前提条件表を添付する",
  },
  2: {
    no: 2,
    marks: "B→C→D→F/H",
    state: "未達だが接近。改善は施策起因でなく、要因は不明または再現不能",
    title: "外部要因依存報告書",
    issueClass: "II",
    approach: "特性要因図 → ベースライン再設計",
    route: "B",
    standardTreatment: "中止または差替。改善分は次期ベースラインへ織り込む",
    reflectTargets: ["③ベースライン・目標式", "②差替", "④資源配分"],
    keyPoint:
      "目標＝ベースライン＋上乗せ分の目標式にして「改善＝施策の手柄」の誤認を構造的に排除する",
  },
  3: {
    no: 3,
    marks: "B→C→D→G",
    state: "未達だが接近。別要因によるが再現可能",
    title: "成功要因転用報告書（発見の報告書）",
    issueClass: "II",
    approach: "メカニズム記述 → パイロット設計",
    route: "C",
    standardTreatment: "現行取組を縮小・廃止し、発見した要因を自施策内の新たな取組として組成",
    reflectTargets: ["②取組構成（新設）", "③撤退基準"],
    keyPoint:
      "移植先の選定は不要（自施策内）。看板の掛け替えになっていないか、対象者・内容の実質的な違いを確認する",
  },
  4: {
    no: 4,
    marks: "B→C→E→K",
    state: "接近中で寄与あり。財政効果率100%未満",
    title: "未達・効率改善報告書",
    issueClass: "III",
    approach: "単価分解 → ECRS",
    route: "D",
    standardTreatment: "継続。費用構造を組み替えて財政効果率100%到達を図る",
    reflectTargets: ["②統廃合", "④費用計画"],
    keyPoint:
      "圧縮分は同一施策内の量の拡大へ優先充当。利用者が過少なら削るのでなく充足が正解",
  },
  5: {
    no: 5,
    marks: "B→C→E→J",
    state: "接近中・寄与あり・費用は見合う",
    title: "順調接近・継続報告書",
    issueClass: "none",
    approach: "トレンド外挿 → 目標再設定（カリブレーション）",
    route: "A",
    standardTreatment: "現行設計のまま継続。次期目標値は実測ペースで再設定",
    reflectTargets: ["③目標再設定", "④施策効果反映（候補）"],
    keyPoint:
      "横展開・レシピ化は行わない。このパターンの存在が、高い目標設定を許容する制度的な逃がし弁になる",
  },
  6: {
    no: 6,
    marks: "A→D→F/H",
    state: "達成だが施策起因でなく、要因は不明または再現不能",
    title: "目標達成・寄与不明報告書（資源再配分）",
    issueClass: "II",
    approach: "ペイオフマトリクス → 再配分",
    route: "B",
    standardTreatment: "投入を縮小・終了し未達領域へ再配分。成果指標は監視指標へ移行",
    reflectTargets: ["④資源配分", "③監視指標化＋再参入閾値", "①地域分析への引き継ぎ"],
    keyPoint:
      "達成済みのため課題・真因には遡らない（No.1・2との違い）。達成を理由とした漫然継続の制度的な停止がこの報告書の役割",
  },
  7: {
    no: 7,
    marks: "A→D→G",
    state: "達成。別要因によるが再現可能",
    title: "目標達成・成功要因転用報告書",
    issueClass: "II",
    approach: "移植先選定マトリクス → 標準化（再現レシピ化）",
    route: "C",
    standardTreatment: "現行取組は縮小・終了。発見した要因は他の未達施策へ移植",
    reflectTargets: ["他施策の②取組構成", "⑤エビデンス台帳（様式G3）"],
    keyPoint:
      "移植先選定マトリクスが必須（No.3との決定的な違い）。主管をまたぐため協議手続で正式化し、初年度はパイロット扱い",
  },
  8: {
    no: 8,
    marks: "A→E→K",
    state: "達成・寄与あり。財政効果率100%未満",
    title: "目標達成・効率化報告書（圧縮・統廃合）",
    issueClass: "III",
    approach: "ポートフォリオ4象限 → ECRS",
    route: "D",
    standardTreatment: "達成水準は維持目標へ切り替え、費用を圧縮して他施策（未達領域）へ再配分",
    reflectTargets: ["②統廃合", "④費用の再計上・再配分先明記"],
    keyPoint: "取組別の単価内訳が不可欠。100%に僅差なら対象重点化（分子側）での到達も検討する",
  },
  9: {
    no: 9,
    marks: "A→E→J",
    state: "達成・寄与あり・費用回収（最良）",
    title: "目標達成・継続報告書（ベストプラクティス）",
    issueClass: "none",
    approach: "再現レシピ化 → 横展開",
    route: "A",
    standardTreatment:
      "継続・深化。新基準値へ引き上げ、成功要因を次期計画総論に明文化し類似施策へ横展開",
    reflectTargets: ["③新基準値", "⑤総論＋様式G3", "④施策効果反映（最有力）"],
    keyPoint: "唯一、自施策の継続と他施策への移植を同時に起動する。限界効果は逓減するため拡大は段階的に",
  },
};

// ─── 判定（4つの問い → 記号列 → 報告書No.）──────────────────

export interface JudgmentResult {
  marks: JudgmentMark[];
  /** 記号列の表示（例: "A→E→K"） */
  path: string;
  pattern: ReportPattern;
}

/**
 * 回答から判定する。回答が足りなければ null（＝判定保留）。
 * 判定保留は「どのルートにも進まず処遇を行わない」— 測定課題（Ⅳ）として記録する。
 */
export function judge(a: JudgmentAnswers): JudgmentResult | null {
  const marks: JudgmentMark[] = [];

  if (a.q1 === "not_met") {
    marks.push("B");
    if (!a.q2) return null;
    if (a.q2 === "not_approaching") {
      marks.push("I");
      return done(marks, 1);
    }
    marks.push("C");
    if (!a.q3) return null;
    if (a.q3 === "not_attributable") {
      marks.push("D");
      if (!a.q4a) return null;
      if (a.q4a === "reproducible") {
        marks.push("G");
        return done(marks, 3);
      }
      marks.push(a.q4a === "unknown" ? "F" : "H");
      return done(marks, 2);
    }
    marks.push("E");
    if (!a.q4b) return null;
    if (a.q4b === "inefficient") {
      marks.push("K");
      return done(marks, 4);
    }
    marks.push("J");
    return done(marks, 5);
  }

  // 達成
  marks.push("A");
  if (!a.q3) return null;
  if (a.q3 === "not_attributable") {
    marks.push("D");
    if (!a.q4a) return null;
    if (a.q4a === "reproducible") {
      marks.push("G");
      return done(marks, 7);
    }
    marks.push(a.q4a === "unknown" ? "F" : "H");
    return done(marks, 6);
  }
  marks.push("E");
  if (!a.q4b) return null;
  if (a.q4b === "inefficient") {
    marks.push("K");
    return done(marks, 8);
  }
  marks.push("J");
  return done(marks, 9);
}

function done(marks: JudgmentMark[], no: ReportNo): JudgmentResult {
  return { marks, path: marks.join("→"), pattern: REPORT_PATTERNS[no] };
}

// ─── 財政効果率（コストと効率性の判定基準）──────────────────

export interface FiscalEffectInput {
  /** 財政効果（計画期間累計・円）。歳出削減・歳入増・将来費用の回避等の貨幣換算額 */
  fiscalEffect: number | null;
  /** 事業費（同期間累計・人件費按分込み・円） */
  totalCost: number | null;
}

export interface FiscalEffectResult {
  /** 100 を閾値とする百分率。算定不能なら null */
  rate: number | null;
  mark: "J" | "K" | null;
  /** 算定式（説明責任のため画面・報告書に出す） */
  formula: string;
  /** 推計不能のときの理由 */
  note: string;
}

/**
 * 財政効果率 = 財政効果 ÷ 事業費 × 100。
 * 100%以上→J（適切）／100%未満→K（不適切）／推計不能→保留（処遇せず測定課題Ⅳ）。
 *
 * ⚠ 改善幅Xは「実績値 − ベースライン（自然体推計）」で取る。**目標値との差ではない**
 *   （目標差＝達成評価、ベースライン差＝効果推計）。財政効果はそのXから導く。
 */
export function fiscalEffectRate(input: FiscalEffectInput): FiscalEffectResult {
  const { fiscalEffect, totalCost } = input;
  if (fiscalEffect == null || totalCost == null || totalCost <= 0) {
    return {
      rate: null,
      mark: null,
      formula: "財政効果 ÷ 事業費（計画期間累計・人件費按分込み）× 100",
      note:
        totalCost != null && totalCost <= 0
          ? "事業費が0のため算定できません"
          : "財政効果または事業費が未入力のため算定できません（判定保留・測定課題Ⅳとして記録）",
    };
  }
  const rate = Math.round((fiscalEffect / totalCost) * 1000) / 10;
  return {
    rate,
    mark: rate >= 100 ? "J" : "K",
    formula: `${fiscalEffect.toLocaleString()}円 ÷ ${totalCost.toLocaleString()}円 × 100 = ${rate}%`,
    note: "",
  };
}

// ─── 集約（1施策に複数の報告書が付く場合）────────────────────

/** 最も重いルートを選ぶ（B > D > C > A）。定めがない場合の既定 */
export const ROUTE_WEIGHT: Record<ReflectRoute, number> = { B: 4, D: 3, C: 2, A: 1 };

export function heaviestRoute(routes: ReflectRoute[]): ReflectRoute | null {
  if (routes.length === 0) return null;
  return routes.reduce((acc, r) => (ROUTE_WEIGHT[r] > ROUTE_WEIGHT[acc] ? r : acc), routes[0]!);
}

/** 審議区分（収束工程 2-3）— ルートから定まる */
export function reviewCategoryOf(route: ReflectRoute): string {
  return ROUTE_META[route].review;
}

/** 諮問事項（様式G4⑩）— ルートから定型選択する。漠然とした諮問にしない */
export const INQUIRY_ITEMS: Record<ReflectRoute, string[]> = {
  A: ["エ 次期目標水準"],
  B: ["ア 案の妥当性", "イ 代替案の要否", "ウ 解放資源の再配分先"],
  C: ["ア 案の妥当性", "オ 段階設計・撤退基準の可否"],
  D: ["ア 案の妥当性", "カ 費用計画の可否"],
};

// ═══════════════════════════════════════════════════════════════
// 図E1フロー（fig7e1・CA2-3改）が使う純粋関数 — migration 060 と対
// ═══════════════════════════════════════════════════════════════

// ─── 記号列の途中経過（判定保留のときも「どこまで進んだか」を出す）───

/** 回答から、確定した記号までを並べる。足りない問いは "?" で示す（例: "A→E→?"） */
export function partialPath(a: Partial<JudgmentAnswers> | null | undefined): string {
  if (!a?.q1) return "?";
  const marks: string[] = [];
  if (a.q1 === "not_met") {
    marks.push("B");
    if (!a.q2) return [...marks, "?"].join("→");
    if (a.q2 === "not_approaching") return [...marks, "I"].join("→");
    marks.push("C");
  } else {
    marks.push("A");
  }
  if (!a.q3) return [...marks, "?"].join("→");
  if (a.q3 === "not_attributable") {
    marks.push("D");
    if (!a.q4a) return [...marks, "?"].join("→");
    marks.push(a.q4a === "reproducible" ? "G" : a.q4a === "unknown" ? "F" : "H");
    return marks.join("→");
  }
  marks.push("E");
  if (!a.q4b) return [...marks, "?"].join("→");
  marks.push(a.q4b === "efficient" ? "J" : "K");
  return marks.join("→");
}

// ─── ② 目標値に近づいているか（3か年の傾向）────────────────────

export interface TrendPoint {
  fiscal_year: number;
  value: number;
}

export interface TrendJudgment {
  /** システム判定。材料不足なら null（担当者が根拠を書いて選ぶ） */
  verdict: Q2 | null;
  /** 判定に使った点数 */
  points: number;
  /** 3点以上=confirmed ／ 2点=provisional（担当者確認必須）／ 1点以下=none */
  confidence: "confirmed" | "provisional" | "none";
  /** 直近3点の年あたり変化（最小二乗の傾き）。目標方向を正に正規化 */
  slope: number | null;
  /** 画面・報告書に出す説明 */
  note: string;
  used: TrendPoint[];
}

/**
 * 中間アウトカムの実績履歴から「近づいているか」を判定する。
 * 様式集: 「3か年の傾向で判定。単年のブレに引きずられない」。
 *   3点以上 … 直近3点の傾きが目標方向なら approaching（確定）
 *   2点     … 差分の向きで暫定判定（担当者確認必須。報告書に「暫定（2点）」と注記）
 *   1点以下 … システム判定なし（担当者が根拠を書いて選ぶ。報告書に「単年判断」と注記）
 * 判定保留にはしない（2026-09-02 決定: 計画初期に全件保留にならないように）。
 */
export function trendJudgment(
  history: TrendPoint[],
  condition: "lte" | "lt" | "gte" | "gt" | "eq",
  target: number | null,
  baseline: number | null,
): TrendJudgment {
  const byYear = new Map<number, number>();
  for (const p of history) {
    if (p.value == null || !Number.isFinite(p.value)) continue;
    byYear.set(p.fiscal_year, p.value); // 同一年度は後勝ち（履歴は時系列順に渡す）
  }
  const pts = Array.from(byYear.entries())
    .map(([fiscal_year, value]) => ({ fiscal_year, value }))
    .sort((x, y) => x.fiscal_year - y.fiscal_year);
  const used = pts.slice(-3);

  // 目標の向き: lte/lt は「下がるほど良い」。eq は目標との差の縮小で見る
  const dir = condition === "lte" || condition === "lt" ? -1 : 1;
  const distance = (v: number) => (target == null ? null : Math.abs(target - v));

  if (used.length <= 1) {
    return {
      verdict: null,
      points: used.length,
      confidence: "none",
      slope: null,
      note:
        used.length === 0
          ? "実績がありません。傾向を判定できないため、担当者が根拠を書いて選びます"
          : "実績が1点しかありません（単年判断）。傾向を判定できないため、担当者が根拠を書いて選びます",
      used,
    };
  }

  let slope: number;
  if (used.length === 2) {
    slope = (used[1]!.value - used[0]!.value) / Math.max(1, used[1]!.fiscal_year - used[0]!.fiscal_year);
  } else {
    // 最小二乗の傾き（年度を x）
    const n = used.length;
    const mx = used.reduce((s, p) => s + p.fiscal_year, 0) / n;
    const my = used.reduce((s, p) => s + p.value, 0) / n;
    const sxx = used.reduce((s, p) => s + (p.fiscal_year - mx) ** 2, 0);
    const sxy = used.reduce((s, p) => s + (p.fiscal_year - mx) * (p.value - my), 0);
    slope = sxx === 0 ? 0 : sxy / sxx;
  }

  let approaching: boolean;
  if (condition === "eq" && target != null) {
    const d0 = distance(used[0]!.value)!;
    const d1 = distance(used[used.length - 1]!.value)!;
    approaching = d1 < d0;
  } else {
    approaching = slope * dir > 0;
  }
  // 基準値（前期末）から動いていないのに傾きだけ正、は起きにくいが、基準値より悪化していれば「近づいていない」
  if (baseline != null && used.length >= 2) {
    const last = used[used.length - 1]!.value;
    if ((last - baseline) * dir < 0 && approaching && used.length === 2) approaching = false;
  }

  const confidence = used.length >= 3 ? "confirmed" : "provisional";
  const yrs = used.map((p) => p.fiscal_year).join("・");
  return {
    verdict: approaching ? "approaching" : "not_approaching",
    points: used.length,
    confidence,
    slope: Math.round(slope * 1000) / 1000,
    note:
      confidence === "confirmed"
        ? `直近3か年（${yrs}）の傾き ${slope >= 0 ? "+" : ""}${Math.round(slope * 100) / 100}/年 → ${
            approaching ? "目標値に近づいている" : "近づいていない"
          }`
        : `実績2点（${yrs}）の暫定判定（3か年の傾向には足りません。担当者の確認が必要）`,
    used,
  };
}

// ─── 寄与経路・財政効果（設計時の定義と期末の実績）─────────────

/** 寄与経路の定義（measure_designs.contribution_pathways） */
export interface ContributionPathway {
  key: string;
  label: string;
  /** 経路別推計式（例: 発生率の抑制幅 × 対象者数 × 単価） */
  formula: string;
  note?: string | null;
}

/** 事前推計（measure_designs.fiscal_effect_estimates）・期末実績（program_evaluations.fiscal_effect.pathways）共通 */
export interface FiscalEffectPathwayAmount {
  pathway_key: string;
  label?: string | null;
  /** 年額（円） */
  annual: number | null;
  /** 計画期間累計（円）。財政効果率はこちらを使う */
  cumulative: number | null;
  /** 推計の根拠（X の値・単価・対象者数など） */
  basis?: string | null;
}

/** 分野を問わない既定の寄与経路（分野ごとに書き換える前提のひな形） */
export const DEFAULT_PATHWAYS: readonly ContributionPathway[] = [
  { key: "incidence", label: "発生率の抑制", formula: "発生率の抑制幅X × 対象者数 × 1人あたり費用", note: "例: 要介護認定率・疾病発生率・再犯率" },
  { key: "utilization", label: "利用率の適正化", formula: "利用率の変化幅X × 対象者数 × 1件あたり単価", note: "例: 受給率・受診率" },
  { key: "unit_cost", label: "1件あたり費用の効率化", formula: "1件あたり費用の変化幅X × 件数", note: "例: 給付単価・処理単価" },
];

/** 経路別の額を累計（円）にまとめる。1件も無ければ null（＝推計不能） */
export function sumFiscalEffect(rows: FiscalEffectPathwayAmount[] | null | undefined): number | null {
  if (!rows || rows.length === 0) return null;
  const vals = rows.map((r) => r.cumulative).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0);
}

/** 評価側に保存する財政効果の実績（program_evaluations.fiscal_effect） */
export interface StoredFiscalEffect {
  pathways: FiscalEffectPathwayAmount[];
  effect_total: number | null;
  cost_total: number | null;
  rate: number | null;
  mark: "J" | "K" | null;
  note: string;
}

// ─── 適用除外 ────────────────────────────────────────────────

export type ExemptionKind = "statutory" | "safety_net" | "small_n";

export const EXEMPTION_META: Record<ExemptionKind, { name: string; detail: string }> = {
  statutory: { name: "法定必須事業", detail: "法令で実施が義務づけられている。廃止対象としない（適用除外リスト）" },
  safety_net: { name: "セーフティネット機能", detail: "最後の受け皿となる機能を持つ。廃止対象としない（適用除外リスト）" },
  small_n: { name: "スモールN（分母下限未満）", detail: "個別支援型で分母が下限未満。単一事例デザイン・GAS・事例集積（比較の段D）で評価する" },
};

export interface JudgmentExemption {
  kind: ExemptionKind;
  reason: string;
  decided_on?: string | null;
}

// ─── 評価側に保存する判定（program_evaluations.judgment）────────

export interface StoredJudgment extends JudgmentAnswers {
  /** 各問いの根拠（担当者の記述） */
  rationale?: Partial<Record<"q1" | "q2" | "q3" | "q4a" | "q4b", string>>;
  /** システム判定の材料（後から検証できるように写す） */
  evidence?: {
    q1?: { system: Q1 | null; overridden: boolean };
    trend?: Omit<TrendJudgment, "used"> & { used: TrendPoint[] };
    fiscal?: { rate: number | null; mark: "J" | "K" | null; system: Q4b | null; overridden: boolean };
  };
}

/**
 * 保存前の正規化: 分岐上あり得ない回答（met なのに q2 がある等）を落とす。
 * 画面が何を送ってきても、DB に入る判定は図E1の分岐と矛盾しない。
 */
export function normalizeJudgment(j: StoredJudgment): StoredJudgment {
  const out: StoredJudgment = { q1: j.q1 };
  if (j.q1 === "not_met" && j.q2) out.q2 = j.q2;
  const reachQ3 = j.q1 === "met" || out.q2 === "approaching";
  if (reachQ3 && j.q3) out.q3 = j.q3;
  if (out.q3 === "not_attributable" && j.q4a) out.q4a = j.q4a;
  if (out.q3 === "attributable" && j.q4b) out.q4b = j.q4b;
  if (j.rationale) out.rationale = j.rationale;
  if (j.evidence) out.evidence = j.evidence;
  return out;
}

/** 標準処遇と決定処遇が「異なる」か（様式G1-7 の○判定）。空の決定処遇は標準どおりとみなす */
export function treatmentDiffers(standard: string | null | undefined, decided: string | null | undefined): boolean {
  const d = (decided ?? "").trim();
  if (!d) return false;
  const s = (standard ?? "").trim();
  return d !== s;
}
