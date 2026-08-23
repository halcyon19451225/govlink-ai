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

export type FlowKey = "fig6" | "fig7";

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
   * choice … 選択肢から選ぶ
   * auto   … KPI実績からシステムが判定し、担当者が確認・上書きする
   * text   … 記述のみ
   */
  kind: "choice" | "auto" | "text";
  options?: FlowOption[];
  next?: string | null; // null = 終了
  notePrompt?: string;
  noteRequired?: boolean;
  /** 補足記述の保存先カラム */
  noteTarget?: FlowTarget;
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

export const FLOWS: Record<FlowKey, EvaluationFlow> = { fig6: FIG6, fig7: FIG7 };

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
