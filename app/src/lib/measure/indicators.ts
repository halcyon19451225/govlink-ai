/**
 * プログラム評価指標一覧（17カテゴリ）— 別紙 Excel「指標一覧」シートに対応。
 *
 * 施策構築で設定する指標は、この17カテゴリを網羅できるようにする。
 * ただし全部を埋めさせるのではなく、**評価フローが止まるものだけを必須**にし、
 * 残りは任意（未設定でも次の工程へ進める）とする。
 *
 * 必須・推奨・任意の割り当ては、評価フロー図6・図7と「評価フロー強化版」の
 * 各工程が「その指標が無いと判定できない」かどうかで決めている（根拠は reason）。
 *
 * 純粋なデータとロジックだけを置く（画面・サーバーの双方から使う）。
 */

/** 指標の層 — 図6は取組ごと、図7は主要施策ごとに回る */
export type IndicatorLevel = "work" | "measure";

/** 未設定を許すか */
export type IndicatorRequirement = "required" | "recommended" | "optional";

/** 測定頻度。計画の年次に依存しない語彙にする */
export type IndicatorFrequency =
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "plan_period"
  | "once"
  | "adhoc";

export const FREQUENCY_LABEL: Record<IndicatorFrequency, string> = {
  monthly: "月次",
  quarterly: "四半期",
  semiannual: "半期",
  annual: "年度ごと",
  plan_period: "計画期間ごと",
  once: "単発",
  adhoc: "随時",
};

/** 評価時点の種類（別紙「評価類型×指標マトリクス」の列に対応） */
export type EvaluationKind = "needs" | "theory" | "process" | "outcome" | "impact" | "cost";

export const EVALUATION_KIND_LABEL: Record<EvaluationKind, string> = {
  needs: "ニーズ評価",
  theory: "セオリー評価",
  process: "プロセス評価",
  outcome: "アウトカム評価",
  impact: "インパクト評価",
  cost: "コスト・効率性評価",
};

/** 相対指定の期（上期・下期・年度末） */
export type RelativePeriod = "first" | "second" | "end";

export const RELATIVE_PERIOD_LABEL: Record<RelativePeriod, string> = {
  first: "上期",
  second: "下期",
  end: "年度末",
};

export interface IndicatorCategory {
  /** 別紙の No.（1〜17） */
  no: number;
  /** A〜F の区分 */
  group: string;
  groupLabel: string;
  name: string;
  /** 定義・測定内容 */
  definition: string;
  /** どの層に置くか */
  level: IndicatorLevel;
  /** 既定の扱い */
  requirement: IndicatorRequirement;
  /** なぜその扱いなのか（評価フローのどの工程が使うか） */
  reason: string;
  /** 主に対応する評価類型（◎） */
  primary: EvaluationKind[];
  /** 補助的に使う評価類型（○） */
  secondary: EvaluationKind[];
  /** 既定の測定頻度 */
  frequency: IndicatorFrequency;
  /** データソースの例（自動補完の下書きに使う） */
  sourceHint: string;
}

/**
 * 必須は6件。これが無いと図6・図7のどこかで判定できなくなる。
 * 推奨は4件。強化版で追加された工程が使うが、逃げ道が用意されている。
 * 残り7件は任意 — 未設定でも図6・図7は完走する。
 */
export const INDICATOR_CATEGORIES: IndicatorCategory[] = [
  {
    no: 1,
    group: "A",
    groupLabel: "事業前提（ニーズ・文脈）",
    name: "ニーズ指標",
    definition: "対象集団の課題の規模・深刻度・分布。解決すべき問題の大きさと供給とのギャップ",
    level: "measure",
    requirement: "optional",
    reason: "ニーズ評価で使う。図6・図7の判定には現れない",
    primary: ["needs"],
    secondary: ["theory", "outcome"],
    frequency: "plan_period",
    sourceHint: "日常生活圏域ニーズ調査、事業状況報告、住民基本台帳、将来人口推計",
  },
  {
    no: 2,
    group: "A",
    groupLabel: "事業前提（ニーズ・文脈）",
    name: "外部条件・文脈指標",
    definition: "因果連鎖が成立するための前提条件の成否。セオリー失敗と実施失敗の切り分けに使う",
    level: "measure",
    requirement: "optional",
    reason: "図6 工程5の要因分析で参照するが、無くても工程は進む",
    primary: ["theory"],
    secondary: ["needs", "process"],
    frequency: "annual",
    sourceHint: "事業所台帳、指定・届出情報、意向調査、地域資源マップ",
  },
  {
    no: 3,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "インプット指標",
    definition: "投入される資源の量。予算・人員・物的資源・時間",
    level: "measure",
    requirement: "required",
    reason: "強化版 工程6 の執行率（決算額 ÷ 予算額）の分母分子になる",
    primary: ["cost"],
    secondary: ["process"],
    frequency: "annual",
    sourceHint: "予算書・決算書、人事データ、委託契約書",
  },
  {
    no: 4,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "ストラクチャー指標",
    definition: "実施体制・仕組みの整備状況。実施の前提となる構造の質",
    level: "work",
    requirement: "recommended",
    reason: "強化版 工程0。無くても工程1へ進めるが、実施不振の原因を体制側と切り分けられなくなる",
    primary: ["process"],
    secondary: ["theory"],
    frequency: "annual",
    sourceHint: "実施要綱、組織規程、配置記録、研修計画",
  },
  {
    no: 5,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "アクティビティ指標",
    definition: "実施した活動の量。計画に対する実施率",
    level: "work",
    requirement: "required",
    reason: "図6 工程1「予定通り実施できたか」＝ 実施記録 ÷ 計画値。これが無いと最初の分岐が判定できない",
    primary: ["process"],
    secondary: [],
    frequency: "annual",
    sourceHint: "事業実施記録、業務日報（アクティビティのタスク完了実績から数えられる）",
  },
  {
    no: 6,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "アウトプット指標",
    definition: "活動の直接的な産出量。サービスが届いた量",
    level: "work",
    requirement: "required",
    reason: "図6 工程2「取組結果は目標値以上か」",
    primary: ["process"],
    secondary: ["cost"],
    frequency: "annual",
    sourceHint: "利用実績記録、給付実績（国保連データ）",
  },
  {
    no: 7,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "初期アウトカム指標",
    definition: "参加・利用の直後に生じる変化。知識・意識・行動の初期変化",
    level: "work",
    requirement: "required",
    reason: "図6 工程3。図7 工程2の「初期アウトカムに起因するか」の突合にも使う",
    primary: ["outcome"],
    secondary: ["theory"],
    frequency: "annual",
    sourceHint: "事前事後アンケート、参加者調査",
  },
  {
    no: 8,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "中間アウトカム指標",
    definition: "行動変容の定着や状態の改善。初期変化の持続",
    level: "measure",
    requirement: "required",
    reason: "図7 工程1「中間アウトカムの目標値以上か」。計画期間評価の入口",
    primary: ["outcome"],
    secondary: ["theory"],
    frequency: "plan_period",
    sourceHint: "追跡調査、基本チェックリスト、ニーズ調査",
  },
  {
    no: 9,
    group: "B",
    groupLabel: "ロジックモデル系列",
    name: "長期アウトカム指標",
    definition: "事業が最終的に目指す状態の変化。政策目標レベルの変化",
    level: "measure",
    requirement: "optional",
    reason: "ギャップ分析のKPIがそのまま入ることが多い。図6・図7の判定そのものには使わない",
    primary: ["outcome"],
    secondary: ["cost"],
    frequency: "plan_period",
    sourceHint: "事業状況報告、給付実績、KDB",
  },
  {
    no: 10,
    group: "C",
    groupLabel: "実施の質・公平性",
    name: "カバレッジ・到達度指標",
    definition: "届くべき対象のうち実際に届いた割合。分母をニーズ側に置く点でアウトプットと異なる",
    level: "work",
    requirement: "recommended",
    reason: "強化版 工程2b。目標達成でも偏りを見逃さないための工程",
    primary: ["process"],
    secondary: ["needs"],
    frequency: "annual",
    sourceHint: "利用実績とニーズ推計の突合、追跡記録",
  },
  {
    no: 11,
    group: "C",
    groupLabel: "実施の質・公平性",
    name: "実施品質・忠実度指標",
    definition: "計画どおりの内容・頻度・質で実施されたか（フィデリティ）",
    level: "work",
    requirement: "recommended",
    reason: "強化版 工程2b。量は出たが質が伴わない場合を拾う",
    primary: ["process"],
    secondary: [],
    frequency: "annual",
    sourceHint: "実施記録の監査、満足度調査、苦情記録",
  },
  {
    no: 12,
    group: "C",
    groupLabel: "実施の質・公平性",
    name: "公平性指標",
    definition: "利用・成果の属性間格差。地域・所得・世帯構成等による偏り",
    level: "measure",
    requirement: "optional",
    reason: "強化版 工程2b で参照するが、カバレッジで代替できる場面が多い",
    primary: ["process"],
    secondary: ["needs", "outcome"],
    frequency: "annual",
    sourceHint: "給付実績の属性別集計、ニーズ調査クロス集計",
  },
  {
    no: 13,
    group: "D",
    groupLabel: "効果の検証",
    name: "インパクト指標（純効果）",
    definition: "反実仮想との差分。長期アウトカムと同じ変数を使うが、比較群・ベースラインの設計が別途必要",
    level: "measure",
    requirement: "recommended",
    reason:
      "図6 工程4。比較データが取れない場合は暫定P判定という逃げ道が図に明記されているため必須にしない。" +
      "ただし実験設計の主要評価項目と同じものになるので、実質的にはそこから自動で入る",
    primary: ["impact"],
    secondary: ["cost"],
    frequency: "plan_period",
    sourceHint: "参加者・非参加者の突合データ、他保険者比較（見える化システム）",
  },
  {
    no: 14,
    group: "D",
    groupLabel: "効果の検証",
    name: "副次効果・波及効果指標",
    definition: "意図しなかった正負の効果。他事業・他分野への波及",
    level: "measure",
    requirement: "optional",
    reason: "図6・図7の判定には現れない。負の波及に気づくための備え",
    primary: ["impact"],
    secondary: ["cost"],
    frequency: "plan_period",
    sourceHint: "家族介護者調査、KDB（医療・介護突合）、担い手登録数",
  },
  {
    no: 15,
    group: "E",
    groupLabel: "コスト・効率性",
    name: "単位コスト・効率性指標",
    definition: "投入と産出の比率。同一成果をより少ない資源で達成できているか",
    level: "measure",
    requirement: "required",
    reason: "強化版 工程6（年次）と図7 工程3-1（計画期間）。どちらもこの指標で判定する",
    primary: ["cost"],
    secondary: ["process"],
    frequency: "annual",
    sourceHint: "決算額 ÷ 実績値、他団体ベンチマーク",
  },
  {
    no: 16,
    group: "E",
    groupLabel: "コスト・効率性",
    name: "費用対効果・費用便益指標",
    definition: "成果1単位当たりの費用、または便益の金銭換算値と費用の比較",
    level: "measure",
    requirement: "optional",
    reason: "図7 工程3-3。単位コストとベンチマークで判定できる場合は省ける",
    primary: ["cost"],
    secondary: ["outcome"],
    frequency: "plan_period",
    sourceHint: "事業費とアウトカム実績の対応づけ、給付費推計",
  },
  {
    no: 17,
    group: "F",
    groupLabel: "持続性",
    name: "持続可能性指標",
    definition: "事業効果・実施体制が中長期に維持できるか",
    level: "measure",
    requirement: "optional",
    reason: "図6・図7の判定には現れない。中止・転換の検討時に効く",
    primary: [],
    secondary: ["process", "impact", "cost"],
    frequency: "plan_period",
    sourceHint: "決算分析、担い手台帳、終了後追跡調査",
  },
];

export const INDICATOR_BY_NO: Record<number, IndicatorCategory> = Object.fromEntries(
  INDICATOR_CATEGORIES.map((c) => [c.no, c]),
);

export const REQUIREMENT_LABEL: Record<IndicatorRequirement, string> = {
  required: "必須",
  recommended: "推奨",
  optional: "任意",
};

/** その層で必須のカテゴリ番号 */
export function requiredCategoryNos(level: IndicatorLevel): number[] {
  return INDICATOR_CATEGORIES.filter((c) => c.level === level && c.requirement === "required").map(
    (c) => c.no,
  );
}

/** 指標の最小要件 — 値が入っているか */
export interface IndicatorLike {
  category_no: number;
  measure_work_id?: string | null;
  label?: string | null;
  target_value?: number | null;
  /** 数値で測れない指標（有無・記載の有無）は目標を文字で持つことがある */
  unit?: string | null;
}

/** 目標が定まっているか（数値目標か、単位が「有無」等で label だけで足りるか） */
export function indicatorHasTarget(i: IndicatorLike): boolean {
  if ((i.label ?? "").trim().length === 0) return false;
  if (i.target_value != null) return true;
  // 有無で判定する指標は数値目標を持たない。単位が入っていれば設定済みとみなす
  return (i.unit ?? "").trim().length > 0;
}

/**
 * 必須指標の不足を返す。
 * 取組ごとに work レベルの必須を、主要施策に measure レベルの必須を要求する。
 */
export interface IndicatorGap {
  /** 取組ID。主要施策レベルなら null */
  work_id: string | null;
  work_label: string;
  missing: IndicatorMissing[];
}

/**
 * 欠けている理由まで返す。
 * 指標の行はあるのに目標が入っていないだけ、という状態が多く、
 * 「不足」とだけ出されると担当者は何を直せばよいのか分からない（2026-09-01、実機で確認）。
 */
export interface IndicatorMissing {
  no: number;
  name: string;
  reason: "未作成" | "目標値が未設定";
}

export function indicatorGaps(
  works: { id: string; title: string; retired?: boolean }[],
  indicators: IndicatorLike[],
  measureTitle: string,
): IndicatorGap[] {
  const gaps: IndicatorGap[] = [];

  const missingOf = (rows: IndicatorLike[], no: number): IndicatorMissing | null => {
    const mine = rows.filter((i) => i.category_no === no);
    if (mine.some((i) => indicatorHasTarget(i))) return null;
    return {
      no,
      name: INDICATOR_BY_NO[no]!.name,
      // 行はあるのに目標だけ無い場合と、そもそも作っていない場合を区別する
      reason: mine.length > 0 ? "目標値が未設定" : "未作成",
    };
  };

  const measureLevel = indicators.filter((i) => !i.measure_work_id);
  const measureMissing = requiredCategoryNos("measure")
    .map((no) => missingOf(measureLevel, no))
    .filter((x): x is IndicatorMissing => x != null);
  if (measureMissing.length > 0) {
    gaps.push({ work_id: null, work_label: measureTitle, missing: measureMissing });
  }

  for (const w of works) {
    if (w.retired) continue;
    const mine = indicators.filter((i) => i.measure_work_id === w.id);
    const missing = requiredCategoryNos("work")
      .map((no) => missingOf(mine, no))
      .filter((x): x is IndicatorMissing => x != null);
    if (missing.length > 0) {
      gaps.push({ work_id: w.id, work_label: w.title, missing });
    }
  }
  return gaps;
}

/** 画面と 422 に出す一文 */
export function describeIndicatorGaps(gaps: IndicatorGap[]): string {
  return gaps
    .map((g) => `${g.work_label}: ${g.missing.map((m) => `${m.no} ${m.name}（${m.reason}）`).join("・")}`)
    .join(" / ");
}

// ─── 年度の表記 ─────────────────────────────────────────

/**
 * 年度の開始西暦年を和暦の年度表記にする（2026 → 令和8年度）。
 * 元号の切り替えは施行日で決まるため、令和（2019年5月1日〜）だけを扱い、
 * それ以前は西暦のまま返す。将来の改元時はここに足す。
 */
export function fiscalYearLabel(startYear: number): string {
  if (startYear >= 2019) return `令和${startYear - 2018}年度`;
  return `${startYear}年度`;
}

/** 計画開始年度からの相対年次（1始まり） */
export function relativeYearOf(startYear: number, fiscalYear: number): number {
  return fiscalYear - startYear + 1;
}

/** 財源の区分 */
export const FUNDING_SOURCES = [
  { key: "national", label: "国庫支出金" },
  { key: "prefectural", label: "県支出金" },
  { key: "special_account", label: "介護保険特別会計" },
  { key: "general", label: "一般財源" },
  { key: "other", label: "その他" },
] as const;

export type FundingKey = (typeof FUNDING_SOURCES)[number]["key"];

/** 財源内訳の合計。事業費計と一致しない年度は画面で知らせる */
export function fundingTotal(funding: Partial<Record<FundingKey, number | null>>): number {
  return FUNDING_SOURCES.reduce((sum, s) => sum + (funding[s.key] ?? 0), 0);
}

/** 事業費計と財源内訳が食い違う年度を返す */
export function fundingMismatchYears(
  rows: { fiscal_year: number; total_amount?: number | null; funding?: Partial<Record<FundingKey, number | null>> }[],
): number[] {
  return rows
    .filter((r) => {
      const total = r.total_amount ?? 0;
      return total !== fundingTotal(r.funding ?? {});
    })
    .map((r) => r.fiscal_year);
}
