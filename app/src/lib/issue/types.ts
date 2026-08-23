// 対話型の課題仮説設定（QCストーリー / JIS Q 9024:2003）の共有型・定数
// クライアント/サーバー両用、DBアクセスなし
//
// 【フレームワークの根拠】
// - JIS Q 9024:2003「マネジメントシステムのパフォーマンス改善―継続的改善の手順及び技法の指針」
//     問題 = 設定してある目標と現実との、対策して克服する必要のあるギャップ
//     課題 = 設定しようとする目標と現実との、対処を必要とするギャップ
//     手順: テーマ選定→現状把握→目標設定→実施計画→要因解析→対策→効果確認→標準化
//     技法: パレート図/マトリックス図（重点指向）・特性要因図・連関図・系統図 ほか
// - 特性要因図（石川ダイアグラム）: 上記JISの言語データ向け技法
// - なぜなぜ分析: トヨタ生産方式（大野耐一）で体系化された真因追究法
//
// 【現状整理（As-Is）との接続】
// 特性要因図の「大骨」に As-Is で用いた PESTLE（外部環境）/ 7S（内部環境）の
// タグをそのまま再利用する。これにより SWOT・クロス分析 → 問題 → 真因 の
// 情報の繋がりが同一のタグ体系の内側で完結し、traceability を担保する。

import {
  PESTLE_META,
  PESTLE_ORDER,
  SEVEN_S_META,
  SEVEN_S_ORDER,
  SEVEN_S_HARD_COLOR,
  SEVEN_S_SOFT_COLOR,
  type PestleKey,
  type SevenSKey,
} from "@/lib/asis/types";

// ─── フェーズ ────────────────────────────────
export type IssueStep =
  | "problems" // 問題の洗い出し
  | "selection" // 課題の選別（重点指向）
  | "rootcause" // 真因分析（特性要因図＋なぜなぜ）
  | "hypothesis" // 課題仮説の定式化
  | "done";

export const ISSUE_STEP_ORDER: IssueStep[] = [
  "problems",
  "selection",
  "rootcause",
  "hypothesis",
  "done",
];

export const ISSUE_STEP_LABEL: Record<IssueStep, string> = {
  problems: "問題の洗い出し",
  selection: "課題の選別",
  rootcause: "真因分析",
  hypothesis: "仮説の定式化",
  done: "完了",
};

export const ISSUE_STEP_HINT: Record<IssueStep, string> = {
  problems: "目標と現実のギャップを生んでいる「問題」を、現状整理の結果から洗い出します",
  selection: "影響度・関与可能性・緊急性で重み付けし、特に解決すべき「課題」を選びます",
  rootcause: "特性要因図となぜなぜ分析で、選んだ課題の真因に到達します",
  hypothesis: "真因と指標の関係を、検証可能な仮説文に整えます",
  done: "課題仮説が確定しました",
};

// ─── 問題の出所（As-Isのどこから来たか）─────────────
export type ProblemOrigin =
  | "weakness" // SWOT 弱み
  | "threat" // SWOT 脅威
  | "wo" // クロス分析 WO戦略（弱み×機会）
  | "wt" // クロス分析 WT戦略（弱み×脅威）
  | "st" // クロス分析 ST戦略（強み×脅威）
  | "so" // クロス分析 SO戦略（強み×機会）
  | "gap" // ギャップ分析の数値そのもの
  | "dialogue"; // 対話中に担当者が追加

export interface ProblemOriginMeta {
  key: ProblemOrigin;
  label: string;
  color: string;
}

export const PROBLEM_ORIGIN_META: Record<ProblemOrigin, ProblemOriginMeta> = {
  weakness: { key: "weakness", label: "弱み(W)", color: "#ef4444" },
  threat: { key: "threat", label: "脅威(T)", color: "#f59e0b" },
  wo: { key: "wo", label: "WO戦略", color: "#3b82f6" },
  wt: { key: "wt", label: "WT戦略", color: "#ef4444" },
  st: { key: "st", label: "ST戦略", color: "#f59e0b" },
  so: { key: "so", label: "SO戦略", color: "#10b981" },
  gap: { key: "gap", label: "ギャップ", color: "#a855f7" },
  dialogue: { key: "dialogue", label: "対話で追加", color: "#94a3b8" },
};

export const PROBLEM_ORIGIN_KEYS = Object.keys(PROBLEM_ORIGIN_META) as ProblemOrigin[];

export function isProblemOrigin(v: unknown): v is ProblemOrigin {
  return typeof v === "string" && v in PROBLEM_ORIGIN_META;
}

// ─── 特性要因図の大骨（PESTLE / 7S を再利用）──────────
export type FactorKey = PestleKey | SevenSKey;

export const FACTOR_ORDER: FactorKey[] = [...PESTLE_ORDER, ...SEVEN_S_ORDER];

export function isFactorKey(v: unknown): v is FactorKey {
  return (
    typeof v === "string" && (v in PESTLE_META || v in SEVEN_S_META)
  );
}

export function isExternalFactor(k: string): boolean {
  return k in PESTLE_META;
}

export function factorLabel(k: string): string {
  if (k in PESTLE_META) {
    const m = PESTLE_META[k as PestleKey];
    return `${m.label}（外部）`;
  }
  if (k in SEVEN_S_META) {
    const m = SEVEN_S_META[k as SevenSKey];
    return `${m.label}（内部）`;
  }
  return k;
}

export function factorShortLabel(k: string): string {
  if (k in PESTLE_META) return PESTLE_META[k as PestleKey].label;
  if (k in SEVEN_S_META) return SEVEN_S_META[k as SevenSKey].label;
  return k;
}

export function factorColor(k: string): string {
  if (k in PESTLE_META) return PESTLE_META[k as PestleKey].color;
  if (k in SEVEN_S_META) {
    return SEVEN_S_META[k as SevenSKey].hard ? SEVEN_S_HARD_COLOR : SEVEN_S_SOFT_COLOR;
  }
  return "#94a3b8";
}

// ─── データ構造 ──────────────────────────────
export interface ProblemItem {
  /** 対話内で一意なID（p1, p2, ...）。以降のステップはこのIDで参照する */
  id: string;
  text: string;
  origin: ProblemOrigin;
  /** 引用元の SWOT / クロス分析の項目テキスト（トレーサビリティ） */
  source_text?: string;
  /** 特性要因図の大骨（PESTLE / 7S） */
  factor?: string;
}

/** 課題の選別（JIS Q 9024 の重点指向）。3軸とも 1〜5 */
export interface SelectionItem {
  problem_id: string;
  impact: number; // 影響度: 指標のギャップへの寄与の大きさ
  controllability: number; // 関与可能性: 自治体の施策で動かせる度合い
  urgency: number; // 緊急性: 先送りした場合の悪化速度
  score: number; // 加重合計（0〜100）
  selected: boolean; // 「課題」として選定したか
  reason: string;
}

/** 選別スコアの重み。UIにも表示して算出根拠を可視化する */
export const SELECTION_WEIGHTS = {
  impact: 0.5,
  controllability: 0.3,
  urgency: 0.2,
} as const;

export const SELECTION_AXIS_META: {
  key: keyof typeof SELECTION_WEIGHTS;
  label: string;
  desc: string;
}[] = [
  { key: "impact", label: "影響度", desc: "指標のギャップへの寄与の大きさ" },
  { key: "controllability", label: "関与可能性", desc: "自治体の施策で動かせる度合い" },
  { key: "urgency", label: "緊急性", desc: "先送りした場合の悪化の速さ" },
];

function clamp5(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(5, Math.max(1, Math.round(v)));
}

/** 3軸（各1〜5）を0〜100に正規化して加重合計する */
export function calcIssueScore(
  impact: number,
  controllability: number,
  urgency: number,
): number {
  const n = (v: number) => (clamp5(v) / 5) * 100;
  return Math.round(
    n(impact) * SELECTION_WEIGHTS.impact +
      n(controllability) * SELECTION_WEIGHTS.controllability +
      n(urgency) * SELECTION_WEIGHTS.urgency,
  );
}

/** 算出式を文字列化（説明責任のため画面と帳票に出す） */
export function issueScoreFormula(s: SelectionItem): string {
  const n = (v: number) => ((clamp5(v) / 5) * 100).toFixed(0);
  return `score = 影響度(${n(s.impact)})×${SELECTION_WEIGHTS.impact} + 関与可能性(${n(
    s.controllability,
  )})×${SELECTION_WEIGHTS.controllability} + 緊急性(${n(s.urgency)})×${
    SELECTION_WEIGHTS.urgency
  } = ${s.score}`;
}

/** 特性要因図の大骨と小骨 */
export interface FishboneBone {
  factor: string; // FactorKey（PESTLE / 7S）
  causes: string[];
}

/** なぜなぜ分析の1段 */
export interface WhyStep {
  level: number; // 1〜5
  question: string;
  answer: string;
}

export interface RootCauseItem {
  problem_id: string;
  bones: FishboneBone[];
  whys: WhyStep[];
  root_cause: string;
}

export interface HypothesisItem {
  problem_id: string;
  title: string;
  /** 「真因Xを解消すれば指標Yが〜」という検証可能な仮説文 */
  statement: string;
  root_cause: string;
  evidence: string[];
  measures: string[];
  /** どう検証するか（EBPMの効果検証の入口） */
  verification: string;
}

// ─── 対話 ────────────────────────────────────
export interface IssueMessage {
  role: "user" | "assistant";
  content: string;
  step?: IssueStep;
  /** AIからの回答ヒント（assistantメッセージのみ） */
  suggestions?: string[];
}

export interface IssueDialogueData {
  problems: ProblemItem[];
  selection: SelectionItem[];
  root_causes: RootCauseItem[];
  hypotheses: HypothesisItem[];
}

export const EMPTY_ISSUE_DATA: IssueDialogueData = {
  problems: [],
  selection: [],
  root_causes: [],
  hypotheses: [],
};

// ─── 便利関数 ────────────────────────────────
/** 選定された（＝「課題」となった）問題IDの集合 */
export function selectedProblemIds(selection: SelectionItem[]): string[] {
  return selection.filter((s) => s.selected).map((s) => s.problem_id);
}

export function findProblem(
  problems: ProblemItem[],
  id: string,
): ProblemItem | undefined {
  return problems.find((p) => p.id === id);
}

/** 真因に到達済みの課題数 */
export function resolvedRootCauseCount(items: RootCauseItem[]): number {
  return items.filter((r) => r.root_cause.trim().length > 0).length;
}
