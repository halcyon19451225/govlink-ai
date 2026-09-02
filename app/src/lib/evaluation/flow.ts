// 評価フロー（図6・図7）の定義
//
// 介護保険事業計画策定方針に示された2つの評価フローを、分岐ウィザードとして
// データ駆動で表現する。通った経路は program_evaluations.flow_decision_path に
// 保存され、「なぜこの判断に至ったか」の説明責任の記録になる。
//
//   図6: 取組毎・年次評価（短期アウトカム）
//        実施できたか → 目標値以上か → 担当者レベルの改善策
//        テンプレートのサイクルB/C（2年目・3年目の6月／10月）に対応
//
//   図7: 主要施策毎・計画期間評価（中間アウトカム）
//        中間アウトカムの達成確認 → 初期アウトカムに起因するか
//        → 投入した人員と予算は適切か → 次期計画へ引き継ぐ
//        テンプレートのサイクルD（3年目上旬）に対応
//
// UI はこの定義を読んで描画するだけなので、フローの改訂はこのファイルで完結する。

export type FlowKey = "fig6" | "fig7" | "fig6v2" | "fig7v2" | "fig7e1";

/** どのカラムへ書き出すか。保存時に評価レコードの各列へ振り分ける */
export type FlowTarget =
  | "findings"
  | "improvement_actions"
  | "next_steps"
  | "success_factors"
  | "barrier_factors"
  | "result";

export interface FlowOption {
  value: string;
  label: string;
  /** 選択後に進むステップ。省略時は step.next */
  next?: string;
  /** 表示のトーン。判定の良し悪しを色だけでなくラベルでも示す */
  tone?: "good" | "warn" | "bad" | "neutral";
  /** この選択肢を選んだとき、補足記述を必須にする */
  requiresNote?: boolean;
}

export interface FlowStep {
  id: string;
  /** 「1. 実施状況」のような見出し */
  section: string;
  question: string;
  help?: string;
  /**
   * choice     … 選択肢から選ぶ
   * auto       … KPI・指標の実績からシステムが判定し、担当者が確認・上書きする
   * text       … 記述のみ
   * delegation … 上位（または次期計画）へ委任する課題の記入（evaluation_delegations へ）
   * delegation_review … 委任されてきた課題の消化（扱った／次期へ引き継ぐ を1件ずつ記録）
   * treatment  … 処遇（図E1・fig7e1）。標準処遇を初期値として示し、異なる決定には理由（H4）を必須にする
   */
  kind: "choice" | "auto" | "text" | "delegation" | "delegation_review" | "treatment";
  options?: FlowOption[];
  next?: string | null; // null = 終了
  notePrompt?: string;
  noteRequired?: boolean;
  /** 補足記述の保存先カラム */
  noteTarget?: FlowTarget;
  /**
   * この工程が前提にする指標カテゴリ（figv2系）。対象の取組／施策に
   * どれも設定されていなければ、工程ごとスキップして next へ進む
   * （「評価フローが止まるものだけを必須にする」の工程版）
   */
  requiresIndicator?: number[];
  /** 比較先（ベンチマーク）が1件も無ければ工程ごとスキップする（図7v2 工程3-2） */
  requiresBenchmark?: boolean;
  /**
   * auto ステップの判定材料（figv2系）:
   *   activity_rate … No.5 実施率（タスク完了実績の自動集計）
   *   indicator     … autoIndicator のカテゴリの最新実績 vs 目標値
   *   trend         … autoIndicator のカテゴリの実績履歴の3か年傾向（図E1 ②）
   *   fiscal_effect … 財政効果率（財政効果÷事業費）の100%閾値（図E1 ④b）
   * 未指定の auto は従来どおり選択KPIの到達度から判定する
   */
  autoSource?: "activity_rate" | "indicator" | "trend" | "fiscal_effect";
  autoIndicator?: number;
}

export interface EvaluationFlow {
  key: FlowKey;
  label: string;
  subtitle: string;
  /** この評価が記録される tier */
  tier: "outcome_initial" | "outcome_intermediate";
  cycleNote: string;
  start: string;
  steps: Record<string, FlowStep>;
}

// ─── 図6: 取組毎・年次評価（短期アウトカム）──────────────
export const FIG6: EvaluationFlow = {
  key: "fig6",
  label: "図6フロー — 年次評価",
  subtitle: "取組毎に、実施状況と短期アウトカムの達成を確認する",
  tier: "outcome_initial",
  cycleNote: "年2回（6月・10月）／サイクルB・C",
  start: "implemented",
  steps: {
    implemented: {
      id: "implemented",
      section: "1. 実施状況",
      question: "計画した取組は、予定どおり実施できましたか？",
      help: "ロジックモデルの活動・産出に対する実施状況を確認します。",
      kind: "choice",
      options: [
        { value: "done", label: "予定どおり実施できた", tone: "good", next: "target_met" },
        { value: "partial", label: "一部にとどまった", tone: "warn", next: "impl_barrier" },
        { value: "not_done", label: "実施できなかった", tone: "bad", next: "impl_barrier" },
      ],
    },
    impl_barrier: {
      id: "impl_barrier",
      section: "1. 実施状況",
      question: "実施できなかった（一部にとどまった）主な要因は何ですか？",
      help: "人員・予算・時期・関係機関の調整など、実務上の制約を具体的に書いてください。",
      kind: "text",
      notePrompt: "例: 通いの場の立ち上げ支援に必要な専門職の派遣調整がつかず、下半期に集中した",
      noteRequired: true,
      noteTarget: "barrier_factors",
      next: "target_met",
    },
    target_met: {
      id: "target_met",
      section: "2. 目標の達成",
      question: "取組結果は目標値に達しましたか？",
      help: "選択したKPIの到達度からシステムが判定します。実態と異なる場合は選び直してください。",
      kind: "auto",
      options: [
        { value: "met", label: "目標に達した", tone: "good", next: "next_action" },
        { value: "not_met", label: "目標に達していない", tone: "bad", next: "gap_cause" },
      ],
    },
    gap_cause: {
      id: "gap_cause",
      section: "2. 目標の達成",
      question: "目標に達しなかった主な要因はどれですか？",
      kind: "choice",
      options: [
        { value: "volume", label: "活動量が不足していた", requiresNote: true },
        { value: "reach", label: "対象者に届いていなかった", requiresNote: true },
        { value: "fit", label: "取組内容が課題に合っていなかった", requiresNote: true },
        { value: "external", label: "外部環境の変化による", requiresNote: true },
        { value: "measure", label: "指標の設定自体に無理があった", requiresNote: true },
      ],
      notePrompt: "そう判断した根拠を書いてください",
      noteTarget: "findings",
      next: "next_action",
    },
    next_action: {
      id: "next_action",
      section: "3. 次年度の扱い",
      question: "次年度の取組をどうしますか？",
      help: "図6フローの結論にあたります。当該年度の取組・事業の改善に反映します。",
      kind: "choice",
      options: [
        { value: "continue", label: "継続する", tone: "neutral" },
        { value: "expand", label: "拡充する", tone: "good" },
        { value: "reduce", label: "縮小する", tone: "warn" },
        { value: "modify", label: "内容を変更する", tone: "warn" },
        { value: "end", label: "終了する", tone: "bad" },
      ],
      next: "improvement",
    },
    improvement: {
      id: "improvement",
      section: "3. 次年度の扱い",
      question: "担当者レベルで決めた改善策・解消方策を記入してください。",
      help: "ここに書いた内容は、次のステップ（改善アクション）で追跡できるようにします。",
      kind: "text",
      notePrompt: "例: 通いの場の立ち上げ支援を上半期に前倒しし、リハ職の派遣枠を県事業で確保する",
      noteRequired: true,
      noteTarget: "improvement_actions",
      next: null,
    },
  },
};

// ─── 図7: 主要施策毎・計画期間評価（中間アウトカム）─────────
export const FIG7: EvaluationFlow = {
  key: "fig7",
  label: "図7フロー — 計画期間評価",
  subtitle: "主要施策毎に、中間アウトカムの達成と投入の効率性を確認する",
  tier: "outcome_intermediate",
  cycleNote: "計画3年目上旬／サイクルD",
  start: "mid_met",
  steps: {
    mid_met: {
      id: "mid_met",
      section: "1. 中間アウトカムの達成",
      question: "中間アウトカム指標は目標値を達成しましたか？",
      help: "選択したKPIの到達度からシステムが判定します。",
      kind: "auto",
      options: [
        { value: "met", label: "達成した", tone: "good", next: "cost_appropriate" },
        { value: "not_met", label: "達成していない", tone: "bad", next: "caused_by_initial" },
      ],
    },
    caused_by_initial: {
      id: "caused_by_initial",
      section: "2. 短期アウトカムとの関係",
      question: "未達の要因は、短期アウトカム（初期アウトカム）にありますか？",
      help: "この中間アウトカムに寄与する短期アウトカムの評価履歴を右に表示しています。図7フローの第2の問いです。",
      kind: "choice",
      options: [
        {
          value: "chain_failed",
          label: "短期も未達で、連鎖して届いていない",
          tone: "bad",
          requiresNote: true,
        },
        {
          value: "chain_broken",
          label: "短期は達成しているが、中間に結びついていない",
          tone: "warn",
          requiresNote: true,
        },
        {
          value: "external",
          label: "短期とは別の外部要因による",
          tone: "warn",
          requiresNote: true,
        },
        {
          value: "unknown",
          label: "短期の評価が不足していて判断できない",
          tone: "neutral",
          requiresNote: true,
        },
      ],
      notePrompt: "そう判断した根拠を書いてください（因果仮説の見直しが必要かどうかも含めて）",
      noteTarget: "findings",
      next: "cost_appropriate",
    },
    cost_appropriate: {
      id: "cost_appropriate",
      section: "3. コストと効率性",
      question: "投入した人員と予算は、得られた成果に見合っていましたか？",
      help: "第5階層（効率性評価）の入口です。詳細なコスト比率は効率性評価タブで算定します。",
      kind: "choice",
      options: [
        { value: "appropriate", label: "見合っていた", tone: "good" },
        { value: "excessive", label: "投入が過大だった", tone: "warn", requiresNote: true },
        { value: "insufficient", label: "投入が過少だった", tone: "warn", requiresNote: true },
        { value: "unknown", label: "判断できる材料がない", tone: "neutral", requiresNote: true },
      ],
      notePrompt: "根拠となる数値や状況を書いてください",
      noteTarget: "barrier_factors",
      next: "policy_direction",
    },
    policy_direction: {
      id: "policy_direction",
      section: "4. 主要施策の方向性",
      question: "この主要施策の方向性をどうしますか？",
      help: "図7フローの結論にあたります。次期計画策定のPhase 1（前期評価）へ引き継ぎます。",
      kind: "choice",
      options: [
        { value: "continue", label: "継続する", tone: "neutral" },
        { value: "revise", label: "改変する", tone: "warn" },
        { value: "merge", label: "他施策と統合する", tone: "warn" },
        { value: "abolish", label: "廃止する", tone: "bad" },
      ],
      next: "handover",
    },
    handover: {
      id: "handover",
      section: "4. 主要施策の方向性",
      question: "次期計画へ引き継ぐ事項を記入してください。",
      help: "前期評価報告書にまとめ、次期計画策定委員会に提示する内容です。",
      kind: "text",
      notePrompt: "例: 通いの場は箇所数では足りており、次期は参加の質（継続率）を中間アウトカムに置く",
      noteRequired: true,
      noteTarget: "next_steps",
      next: null,
    },
  },
};

// ─── 図6v2: 取組毎評価（CA2-2・設計 coe-ca2-design.md §1・§5）────────────
//
// 評価者は取組の担当者レベル。目的は
//   ①次年度以降の取組の効果性向上（初期アウトカム指標の改善）
//   ②取組の改善だけでは解消できない課題を明らかにし、主要施策毎評価へ委任する
// 判定材料は施策データセットの指標（057）と実績（058）。指標が無い工程は
// 自動でスキップする（評価フローが止まるものだけを必須にする、の工程版）。
export const FIG6V2: EvaluationFlow = {
  key: "fig6v2",
  label: "取組評価 — 年次",
  subtitle: "取組毎に、体制・実施・結果・帰属・コストを確認し、次年度の扱いと委任を決める",
  tier: "outcome_initial",
  cycleNote: "指標ごとの評価時点の設定に従う（年次）",
  start: "structure_ok",
  steps: {
    structure_ok: {
      id: "structure_ok",
      section: "0. 実施体制",
      question: "実施に必要な体制（人員・予算・連携先）は整っていましたか？",
      help: "ストラクチャー指標（No.4）を確認します。体制の不備は工程1の実施不振と切り分けて記録します。",
      kind: "choice",
      requiresIndicator: [4],
      options: [
        { value: "ok", label: "整っていた", tone: "good" },
        { value: "shortage", label: "一部に不足があった", tone: "warn", requiresNote: true },
        { value: "not_ok", label: "整っていなかった", tone: "bad", requiresNote: true },
      ],
      notePrompt: "不足していた体制と、その影響を書いてください",
      noteTarget: "barrier_factors",
      next: "implemented",
    },
    implemented: {
      id: "implemented",
      section: "1. 実施状況",
      question: "計画した取組は、予定どおり実施できましたか？",
      help: "アクティビティ指標（No.5）— タスク完了実績からの実施率をシステムが提示します。実態と異なる場合は選び直してください。",
      kind: "auto",
      autoSource: "activity_rate",
      options: [
        { value: "done", label: "予定どおり実施できた", tone: "good", next: "reach_ok" },
        { value: "partial", label: "一部にとどまった", tone: "warn", next: "impl_barrier" },
        { value: "not_done", label: "実施できなかった", tone: "bad", next: "impl_barrier" },
      ],
    },
    impl_barrier: {
      id: "impl_barrier",
      section: "1. 実施状況",
      question: "実施できなかった（一部にとどまった）主な要因は何ですか？",
      help: "人員・予算・時期・関係機関の調整など、実務上の制約を具体的に書いてください。",
      kind: "text",
      notePrompt: "例: 専門職の派遣調整がつかず、下半期に実施が集中した",
      noteRequired: true,
      noteTarget: "barrier_factors",
      next: "reach_ok",
    },
    reach_ok: {
      id: "reach_ok",
      section: "2b. 到達と質",
      question: "取組は、届くべき人に、設計どおりの質で届きましたか？",
      help: "カバレッジ・到達度（No.10）と実施品質・忠実度（No.11）を確認します。",
      kind: "choice",
      requiresIndicator: [10, 11],
      options: [
        { value: "reached", label: "届いていた", tone: "good" },
        { value: "partial", label: "一部に偏りがあった", tone: "warn", requiresNote: true },
        { value: "missed", label: "届いていなかった", tone: "bad", requiresNote: true },
      ],
      notePrompt: "届かなかった対象と、考えられる理由を書いてください",
      noteTarget: "findings",
      next: "target_met",
    },
    target_met: {
      id: "target_met",
      section: "2. 取組結果",
      question: "取組結果（アウトプット）は目標値に達しましたか？",
      help: "アウトプット指標（No.6）の実績と目標値からシステムが判定します。",
      kind: "auto",
      autoSource: "indicator",
      autoIndicator: 6,
      options: [
        { value: "met", label: "目標に達した", tone: "good", next: "outcome_initial_met" },
        { value: "not_met", label: "目標に達していない", tone: "bad", next: "gap_cause" },
      ],
    },
    gap_cause: {
      id: "gap_cause",
      section: "2. 取組結果",
      question: "目標に達しなかった主な要因はどれですか？",
      kind: "choice",
      options: [
        { value: "volume", label: "活動量が不足していた", requiresNote: true },
        { value: "reach", label: "対象者に届いていなかった", requiresNote: true },
        { value: "fit", label: "取組内容が課題に合っていなかった", requiresNote: true },
        { value: "external", label: "外部環境の変化による", requiresNote: true },
        { value: "measure", label: "指標の設定自体に無理があった", requiresNote: true },
      ],
      notePrompt: "そう判断した根拠を書いてください",
      noteTarget: "findings",
      next: "outcome_initial_met",
    },
    outcome_initial_met: {
      id: "outcome_initial_met",
      section: "3. 初期アウトカム",
      question: "初期アウトカム指標は目標値に達しましたか？",
      help: "初期アウトカム指標（No.7）の実績と目標値からシステムが判定します。",
      kind: "auto",
      autoSource: "indicator",
      autoIndicator: 7,
      options: [
        { value: "met", label: "達した", tone: "good", next: "attributable" },
        {
          value: "not_met",
          label: "達していない",
          tone: "bad",
          requiresNote: true,
          next: "attributable",
        },
      ],
      notePrompt: "アウトプットは出ているのに成果に結びつかない場合、その仮説を書いてください",
      noteTarget: "findings",
    },
    attributable: {
      id: "attributable",
      section: "4. 取組への帰属",
      question: "初期アウトカムの変化は、この取組の結果によるものと言えますか？",
      help: "インパクト指標（No.13）と実験設計（比較の作り方・前提の確認）を材料に判断します。比較データが未取得なら暫定P判定を選べます。",
      kind: "choice",
      options: [
        { value: "attributable", label: "取組の結果と言える", tone: "good" },
        { value: "partial", label: "一部は取組の結果と言える", tone: "warn", requiresNote: true },
        {
          value: "provisional_p",
          label: "比較データ未取得のため暫定P判定とする",
          tone: "neutral",
          requiresNote: true,
        },
        { value: "not_attributable", label: "取組の結果とは言えない", tone: "bad", requiresNote: true },
      ],
      notePrompt: "判断の根拠（比較の状況・外部要因）と、比較データ取得の予定を書いてください",
      noteTarget: "findings",
      next: "cost_check",
    },
    cost_check: {
      id: "cost_check",
      section: "6. 年次コスト",
      question: "当該年度の投入（予算・人員）は、実施状況と結果に見合っていましたか？",
      help: "インプット指標（No.3・執行率）・単位コスト（No.15）と年度別の事業費を確認します。",
      kind: "choice",
      options: [
        { value: "appropriate", label: "見合っていた", tone: "good" },
        { value: "excessive", label: "投入が過大だった", tone: "warn", requiresNote: true },
        { value: "insufficient", label: "投入が過少だった", tone: "warn", requiresNote: true },
        { value: "unknown", label: "判断できる材料がない", tone: "neutral", requiresNote: true },
      ],
      notePrompt: "根拠となる数値や状況を書いてください",
      noteTarget: "barrier_factors",
      next: "next_action",
    },
    next_action: {
      id: "next_action",
      section: "5. 次年度の扱い",
      question: "次年度の取組をどうしますか？",
      help: "図6フローの結論その1。当該年度の取組・事業の改善に反映します。",
      kind: "choice",
      options: [
        { value: "continue", label: "継続する", tone: "neutral" },
        { value: "expand", label: "拡充する", tone: "good" },
        { value: "reduce", label: "縮小する", tone: "warn" },
        { value: "modify", label: "内容を変更する", tone: "warn" },
        { value: "end", label: "終了する", tone: "bad" },
      ],
      next: "improvement",
    },
    improvement: {
      id: "improvement",
      section: "5. 次年度の扱い",
      question: "担当者レベルで決めた改善策・解消方策を記入してください。",
      help: "初期アウトカム指標の改善につながる、取組レベルの打ち手です。改善アクションとして追跡できます。",
      kind: "text",
      notePrompt: "例: 通いの場の立ち上げ支援を上半期に前倒しし、リハ職の派遣枠を県事業で確保する",
      noteRequired: true,
      noteTarget: "improvement_actions",
      next: "delegation",
    },
    delegation: {
      id: "delegation",
      section: "7. 上位への委任",
      question: "取組の改善だけでは解消できない課題（主要施策レベルの包括的な見直しが要るもの）はありますか？",
      help: "図6フローの結論その2。ここで記入した課題は主要施策毎評価（図7）に委任され、向こうの評価の入力になります。",
      kind: "delegation",
      options: [
        { value: "none", label: "ない（取組レベルで対応できる）", tone: "good" },
        { value: "has", label: "ある（課題を記入して委任する）", tone: "warn" },
      ],
      next: null,
    },
  },
};

// ─── 図7v2: 主要施策毎評価（CA2-3・設計 coe-ca2-design.md §1・§6）────────────
//
// 一計画期間の単位で、中間アウトカム指標が確定したタイミングで行う。
// 入力は取組毎評価から委任された課題。目的は
//   ①主要施策の次期計画における処遇（廃止・改変・統合・継続）を決める
//   ②次期計画の主要施策形成時の効果性向上（中間アウトカム指標の改善）
//   ③主要施策の改善だけでは解消できない課題を、次期計画のニーズ評価・セオリー評価へ引き継ぐ
export const FIG7V2: EvaluationFlow = {
  key: "fig7v2",
  label: "主要施策評価 — 計画期間",
  subtitle: "主要施策毎に、中間アウトカムの達成と効率性を確認し、次期計画での処遇を決める",
  tier: "outcome_intermediate",
  cycleNote: "中間アウトカム指標（No.8）の評価時点に従う",
  start: "mid_met",
  steps: {
    mid_met: {
      id: "mid_met",
      section: "1. 中間アウトカムの達成",
      question: "中間アウトカム指標は目標値に達しましたか？",
      help: "中間アウトカム指標（No.8）の実績と目標値からシステムが判定します。この評価は本来、この指標が確定したタイミングで行います。",
      kind: "auto",
      autoSource: "indicator",
      autoIndicator: 8,
      options: [
        { value: "met", label: "達した", tone: "good", next: "delegated_issues" },
        { value: "not_met", label: "達していない", tone: "bad", next: "caused_by_initial" },
      ],
    },
    caused_by_initial: {
      id: "caused_by_initial",
      section: "2. 初期アウトカムとの関係",
      question: "未達の要因は、取組（初期アウトカム）の側にありますか？",
      help: "この施策の取組毎評価（図6）の結果を右に集めています。連鎖のどこで途切れたかを見極めます。",
      kind: "choice",
      options: [
        { value: "chain_failed", label: "取組も未達で、連鎖して届いていない", tone: "bad", requiresNote: true },
        { value: "chain_broken", label: "取組は達成しているが、中間に結びついていない", tone: "warn", requiresNote: true },
        { value: "external", label: "取組とは別の外部要因による", tone: "warn", requiresNote: true },
        { value: "unknown", label: "取組評価が不足していて判断できない", tone: "neutral", requiresNote: true },
      ],
      notePrompt: "そう判断した根拠を書いてください（因果仮説の見直しが必要かどうかも含めて）",
      noteTarget: "findings",
      next: "delegated_issues",
    },
    delegated_issues: {
      id: "delegated_issues",
      section: "3. 委任された課題",
      question: "取組評価から委任された課題を、この評価でどう扱いますか？",
      help: "課題ごとに「この評価で扱った」か「次期計画へ引き継ぐ」かを記録します。委任が無ければこの工程は飛ばされます。",
      kind: "delegation_review",
      next: "cost_appropriate",
    },
    cost_appropriate: {
      id: "cost_appropriate",
      section: "4. コストと効率性",
      question: "投入した人員と予算は、得られた成果に見合っていましたか？",
      help: "単位コスト（No.15）・インプット（No.3）と計画期間の事業費を確認します。",
      kind: "choice",
      options: [
        { value: "appropriate", label: "見合っていた", tone: "good" },
        { value: "excessive", label: "投入が過大だった", tone: "warn", requiresNote: true },
        { value: "insufficient", label: "投入が過少だった", tone: "warn", requiresNote: true },
        { value: "unknown", label: "判断できる材料がない", tone: "neutral", requiresNote: true },
      ],
      notePrompt: "根拠となる数値や状況を書いてください",
      noteTarget: "barrier_factors",
      next: "benchmark",
    },
    benchmark: {
      id: "benchmark",
      section: "4. コストと効率性",
      question: "他団体との比較では、この施策の水準はどうでしたか？",
      help: "登録された比較先（全国平均・県平均・人口同規模平均など）との比較表を材料にします。比較先が未登録なら、この工程は飛ばされます。",
      kind: "choice",
      requiresBenchmark: true,
      options: [
        { value: "better", label: "同規模比で良好", tone: "good" },
        { value: "similar", label: "同等", tone: "neutral" },
        { value: "worse", label: "同規模比で低い", tone: "warn", requiresNote: true },
      ],
      notePrompt: "差の要因として考えられることを書いてください",
      noteTarget: "findings",
      next: "cost_effectiveness",
    },
    cost_effectiveness: {
      id: "cost_effectiveness",
      section: "4. コストと効率性",
      question: "費用対効果（費用便益）はどう評価しますか？",
      help: "費用対効果指標（No.16）を設定している場合の工程です。",
      kind: "choice",
      requiresIndicator: [16],
      options: [
        { value: "positive", label: "効果が費用を上回る", tone: "good" },
        { value: "marginal", label: "見合いは限界的", tone: "warn", requiresNote: true },
        { value: "negative", label: "効果が費用に見合わない", tone: "bad", requiresNote: true },
      ],
      notePrompt: "算定の前提と結果を書いてください",
      noteTarget: "findings",
      next: "policy_direction",
    },
    policy_direction: {
      id: "policy_direction",
      section: "5. 次期計画での処遇",
      question: "この主要施策を、次期計画でどう扱いますか？",
      help: "図7フローの結論その1。ここで決めた処遇が、改善メニュー「主要施策の再構築」の出発点になります（現行計画の施策データは書き換えません）。",
      kind: "choice",
      options: [
        { value: "continue", label: "継続する", tone: "neutral" },
        { value: "revise", label: "改変する", tone: "warn", requiresNote: true },
        { value: "merge", label: "他施策と統合する", tone: "warn", requiresNote: true },
        { value: "abolish", label: "廃止する", tone: "bad", requiresNote: true },
      ],
      notePrompt: "その処遇とした理由を書いてください",
      noteTarget: "next_steps",
      next: "plan_level_issues",
    },
    plan_level_issues: {
      id: "plan_level_issues",
      section: "6. 次期計画への引き継ぎ",
      question: "主要施策の改善だけでは解消できない課題（計画全体のロジックモデルの見直しが要るもの）はありますか？",
      help: "図7フローの結論その2。ここで記入した課題は、次期計画策定時のニーズ評価・セオリー評価へ引き継がれます。",
      kind: "delegation",
      options: [
        { value: "none", label: "ない（施策レベルで対応できる）", tone: "good" },
        { value: "has", label: "ある（課題を記入して引き継ぐ）", tone: "warn" },
      ],
      next: "handover",
    },
    handover: {
      id: "handover",
      section: "6. 次期計画への引き継ぎ",
      question: "次期計画へ引き継ぐ事項を記入してください。",
      help: "評価報告書にまとめ、次期計画策定の入力にします。",
      kind: "text",
      notePrompt: "例: 通いの場は箇所数では足りており、次期は参加の質（継続率）を中間アウトカムに置く",
      noteRequired: true,
      noteTarget: "next_steps",
      next: null,
    },
  },
};

// ─── 図7e1: 主要施策評価（図E1をそのまま実装・CA2-3改）──────────
// 様式集（claude/coe-eval-report-forms.md §1）の4つの問いを工程1〜4に置き、
// fig7v2 の工程のうち図E1に無いもの（委任の消化・他団体比較・処遇・引き継ぎ）を後段に続ける。
// 記号A〜K・報告書No.・ルート・標準処遇は lib/evaluation/judgment.ts が回答から機械的に導く。
// fig7v2 はウィザードから外し、保存済み評価の読み取り専用として残す（2026-09-02 決定）。
export const FIG7E1: EvaluationFlow = {
  key: "fig7e1",
  label: "主要施策評価 — 計画期間",
  subtitle: "図E1の4つの問いで判定し、報告書No.と標準処遇を機械的に定めたうえで、次期計画での処遇を決める",
  tier: "outcome_intermediate",
  cycleNote: "中間アウトカム指標（No.8）の評価時点に従う",
  start: "e1_q1",
  steps: {
    e1_q1: {
      id: "e1_q1",
      section: "1. 目標到達",
      question: "成果（中間アウトカム）は目標値に達しましたか？",
      help: "中間アウトカム指標（No.8）の期末実績と目標値からシステムが判定します（判定記号 A／B）。",
      kind: "auto",
      autoSource: "indicator",
      autoIndicator: 8,
      options: [
        { value: "met", label: "達した（A）", tone: "good", next: "e1_q3" },
        { value: "not_met", label: "達していない（B）", tone: "bad", next: "e1_q2" },
      ],
    },
    e1_q2: {
      id: "e1_q2",
      section: "2. 接近",
      question: "未達ですが、目標値に近づいていますか？",
      help: "3か年の傾向で判定します（単年のブレに引きずられない）。実績が3点に満たないときは暫定判定になり、担当者の確認と根拠の記入が要ります（判定記号 C／I）。",
      kind: "auto",
      autoSource: "trend",
      autoIndicator: 8,
      options: [
        { value: "approaching", label: "近づいている（C）", tone: "warn", next: "e1_q3" },
        { value: "not_approaching", label: "近づいていない（I）→ 報告書No.1", tone: "bad", next: "delegated_issues", requiresNote: true },
      ],
      notePrompt: "傾向の読み方の根拠（実績が少ない場合は、単年判断であることとその理由）",
      noteTarget: "findings",
    },
    e1_q3: {
      id: "e1_q3",
      section: "3. 起因",
      question: "成果の変化は、初期アウトカム（施策の働き）に起因しますか？",
      help: "初期アウトカムの年次履歴（各年度の取組評価）が因果判断の唯一の根拠です（共通ヘッダ④）。実際に行った比較の方法（比較の段A〜D）も併せて記録します（判定記号 D／E）。",
      kind: "choice",
      options: [
        { value: "attributable", label: "起因する（E）", tone: "good", next: "e1_q4b", requiresNote: true },
        { value: "not_attributable", label: "起因しない（D）", tone: "warn", next: "e1_q4a", requiresNote: true },
      ],
      notePrompt: "そう判断した根拠（年次履歴のどこを見たか・用いた比較の方法）",
      noteTarget: "findings",
    },
    e1_q4a: {
      id: "e1_q4a",
      section: "4a. 別要因の再現可能性",
      question: "成果の変化をもたらした別の要因を特定でき、人為的に再現可能ですか？",
      help: "再現可能（G）なら「成功要因転用」の報告書（No.3／7）へ。不明（F）・再現不能（H）なら外部要因依存／寄与不明（No.2／6）へ。",
      kind: "choice",
      options: [
        { value: "reproducible", label: "特定でき、再現可能（G）", tone: "good", requiresNote: true },
        { value: "not_reproducible", label: "特定できたが、再現不能（H）", tone: "warn", requiresNote: true },
        { value: "unknown", label: "要因は不明（F）", tone: "neutral", requiresNote: true },
      ],
      notePrompt: "特定した要因と、再現可能と判断する根拠（メカニズム: 投入→取組→取組結果→成果の鎖と機能した条件）",
      noteTarget: "success_factors",
      next: "delegated_issues",
    },
    e1_q4b: {
      id: "e1_q4b",
      section: "4b. 財政効果率",
      question: "投入した人員と予算は適切でしたか（財政効果率100%以上か）？",
      help: "財政効果率＝財政効果（計画期間累計）÷事業費（同期間累計・人件費按分込み）。寄与経路ごとの期末実績を入れると自動で算定します。推計不能なら判定保留（処遇せず測定課題Ⅳとして記録）です（判定記号 J／K）。",
      kind: "auto",
      autoSource: "fiscal_effect",
      options: [
        { value: "efficient", label: "100%以上（J）", tone: "good" },
        { value: "inefficient", label: "100%未満（K）", tone: "warn" },
        { value: "pending", label: "推計不能（判定保留）", tone: "neutral", requiresNote: true },
      ],
      notePrompt: "推計できない理由と、次期に判定可能とする測定設計",
      noteTarget: "barrier_factors",
      next: "delegated_issues",
    },
    delegated_issues: {
      id: "delegated_issues",
      section: "5. 委任された課題",
      question: "取組評価から委任された課題を、この評価でどう扱いますか？",
      help: "課題ごとに「この評価で扱った」か「次期計画へ引き継ぐ」かを記録します。委任が無ければこの工程は飛ばされます。",
      kind: "delegation_review",
      next: "benchmark",
    },
    benchmark: {
      id: "benchmark",
      section: "6. 他団体との比較",
      question: "他団体との比較では、この施策の水準はどうでしたか？",
      help: "登録された比較先（全国平均・県平均・人口同規模平均など）との比較表を材料にします。比較先が未登録なら、この工程は飛ばされます。",
      kind: "choice",
      requiresBenchmark: true,
      options: [
        { value: "better", label: "同規模比で良好", tone: "good" },
        { value: "similar", label: "同等", tone: "neutral" },
        { value: "worse", label: "同規模比で低い", tone: "warn", requiresNote: true },
      ],
      notePrompt: "差の要因として考えられることを書いてください",
      noteTarget: "findings",
      next: "treatment",
    },
    treatment: {
      id: "treatment",
      section: "7. 次期計画での処遇",
      question: "報告書No.から定まる標準処遇を、この施策の処遇（事務局案）としますか？",
      help: "「この施策をどうするか」は裁量ではなく判定から機械的に導きます。裁量は「標準処遇に従わない理由を書く」ところにだけあります（comply or explain・様式H4）。判定保留なら処遇は行いません。",
      kind: "treatment",
      options: [
        { value: "standard", label: "標準処遇のとおりとする", tone: "good" },
        { value: "modified", label: "標準処遇と異なる処遇とする（理由書H4が必須）", tone: "warn", requiresNote: true },
        { value: "none", label: "判定保留・適用除外のため処遇を行わない（測定設計のみ）", tone: "neutral" },
      ],
      notePrompt: "理由（①数字上はこう見えるが〜という事実・事情がある ②現場・関係機関も〜という意見 ③制度・上位計画との整合 → よって〔決定処遇〕とする）",
      next: "plan_level_issues",
    },
    plan_level_issues: {
      id: "plan_level_issues",
      section: "8. 次期計画への引き継ぎ",
      question: "主要施策の改善だけでは解消できない課題（計画全体のロジックモデルの見直しが要るもの）はありますか？",
      help: "図7フローの結論その2。ここで記入した課題は、次期計画策定時のニーズ評価・セオリー評価へ引き継がれます。",
      kind: "delegation",
      options: [
        { value: "none", label: "ない（施策レベルで対応できる）", tone: "good" },
        { value: "has", label: "ある（課題を記入して引き継ぐ）", tone: "warn" },
      ],
      next: "handover",
    },
    handover: {
      id: "handover",
      section: "8. 次期計画への引き継ぎ",
      question: "次期計画へ引き継ぐ事項を記入してください。",
      help: "評価報告書にまとめ、次期計画策定の入力にします。",
      kind: "text",
      notePrompt: "例: 通いの場は箇所数では足りており、次期は参加の質（継続率）を中間アウトカムに置く",
      noteRequired: true,
      noteTarget: "next_steps",
      next: null,
    },
  },
};

export const FLOWS: Record<FlowKey, EvaluationFlow> = {
  fig6: FIG6,
  fig7: FIG7,
  fig6v2: FIG6V2,
  fig7v2: FIG7V2,
  fig7e1: FIG7E1,
};

/**
 * 指標の有無で工程をスキップした後の実効の次ステップを返す。
 * presentCategories は対象の取組／施策に設定されている指標カテゴリの集合。
 */
export function nextAvailableStep(
  flow: EvaluationFlow,
  fromStepId: string | null,
  presentCategories: Set<number>,
  ctx?: { hasBenchmark?: boolean; hasDelegations?: boolean },
): string | null {
  let cursor = fromStepId ?? flow.start;
  for (let guard = 0; guard < 50; guard++) {
    const step: FlowStep | undefined = flow.steps[cursor];
    if (!step) return null;
    const indicatorOk =
      !step.requiresIndicator || step.requiresIndicator.some((no) => presentCategories.has(no));
    const benchmarkOk = !step.requiresBenchmark || ctx?.hasBenchmark === true;
    // 委任の消化は、委任されてきた課題があるときだけ問う
    const delegationOk = step.kind !== "delegation_review" || ctx?.hasDelegations === true;
    if (indicatorOk && benchmarkOk && delegationOk) return cursor;
    if (step.next == null) return null;
    cursor = step.next;
  }
  return null;
}

// ─── 回答の記録 ─────────────────────────────────
export interface FlowAnswer {
  step_id: string;
  section: string;
  question: string;
  /** choice/auto は選択肢の value、text は "" */
  value: string;
  label: string;
  note?: string;
  /** auto ステップで、システム判定を担当者が上書きしたか */
  overridden?: boolean;
  system_value?: string;
}

export interface FlowDecisionPath {
  flow: FlowKey;
  tier: EvaluationFlow["tier"];
  answers: FlowAnswer[];
  completed_at?: string;
}

export function getFlow(key: string | null | undefined): EvaluationFlow | null {
  if (key === "fig6") return FIG6;
  if (key === "fig7") return FIG7;
  if (key === "fig6v2") return FIG6V2;
  if (key === "fig7v2") return FIG7V2;
  if (key === "fig7e1") return FIG7E1;
  return null;
}

/** 次のステップIDを解決する（選択肢の next が優先） */
export function resolveNext(step: FlowStep, value: string): string | null {
  const opt = step.options?.find((o) => o.value === value);
  if (opt?.next !== undefined) return opt.next;
  return step.next ?? null;
}

/** 選択肢が補足記述を要求するか */
export function needsNote(step: FlowStep, value: string): boolean {
  if (step.kind === "text") return step.noteRequired === true;
  const opt = step.options?.find((o) => o.value === value);
  return opt?.requiresNote === true;
}

/** 回答から各カラムへの振り分けを作る */
export function collectTargets(
  flow: EvaluationFlow,
  answers: FlowAnswer[],
): Partial<Record<FlowTarget, string>> {
  const out: Partial<Record<FlowTarget, string>> = {};
  for (const a of answers) {
    const step = flow.steps[a.step_id];
    const target = step?.noteTarget;
    if (!target || !a.note) continue;
    out[target] = out[target] ? `${out[target]}\n${a.note}` : a.note;
  }
  return out;
}

/** 経路を1文の総括にする（result 列に入れる） */
export function summarizePath(flow: EvaluationFlow, answers: FlowAnswer[]): string {
  const parts = answers
    .filter((a) => a.label && a.value)
    .map((a) => `${a.section.replace(/^\d+\.\s*/, "")}: ${a.label}`);
  return `【${flow.label}】${parts.join(" ／ ")}`;
}
