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
  /**
   * 他の問題に統合されて退役した。ID は消さずに残す
   * （選別・真因・仮説が problem_id で参照しているため、行を消すと下流が壊れる）。
   */
  retired?: boolean;
  /** 統合先の問題ID（retired のときのみ） */
  merged_into?: string;
}

/** 統合の指示（AIの record_issue_turn から受け取る） */
export interface ProblemMerge {
  /** 統合先の問題ID（残る方） */
  into: string;
  /** 統合されて退役する問題ID（1件以上） */
  from: string[];
  /** 統合後の文言（省略時は into の文言を維持） */
  text?: string;
}

/** 生きている（退役していない）問題だけを返す */
export function activeProblems(problems: ProblemItem[]): ProblemItem[] {
  return problems.filter((p) => !p.retired);
}

/**
 * 統合を適用する。from を retired にし、統合先へ source_text を引き継ぐ。
 *
 * 行を消さないのは、選別・真因・仮説が problem_id で参照しているため。
 * 消すと下流が黙って壊れる（2026-08-29 の誤選定事故と同じ壊れ方になる）。
 * 自己統合・存在しないID・退役済みへの統合・循環は無視する。
 */
export function applyProblemMerges(
  problems: ProblemItem[],
  merges: ProblemMerge[],
): ProblemItem[] {
  let out = problems.map((p) => ({ ...p }));
  for (const m of merges) {
    const into = out.find((p) => p.id === m.into && !p.retired);
    if (!into) continue;
    for (const fromId of m.from) {
      if (fromId === m.into) continue;
      const from = out.find((p) => p.id === fromId && !p.retired);
      if (!from) continue;
      // 統合元の引用原文を引き継ぐ（現状整理へのトレーサビリティを切らさない）
      if (from.source_text && from.source_text !== into.source_text) {
        into.source_text = into.source_text
          ? `${into.source_text}\n${from.source_text}`
          : from.source_text;
      }
      from.retired = true;
      from.merged_into = m.into;
    }
    if (m.text && m.text.trim().length > 0) into.text = m.text.trim();
    out = out.map((p) => (p.id === into.id ? into : p));
  }
  return out;
}

/**
 * 照合用の正規化。空白・記号・全角半角のゆれを落として比較する。
 * AIが返す echo と保存済みの文言を突き合わせるためのもの。
 */
export function normalizeForEcho(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s\u3000]/g, "")
    .replace(/[、。，．,.\-—–ー・「」『』（）()【】\[\]:：;；!！?？'"'"]/g, "")
    .toLowerCase();
}

/**
 * selection の problem_id と problem_text_echo が、保存済みの問題と一致するか検証する。
 *
 * AIが発言の中で番号を振り直し、保存済みIDと対応が崩れたまま selection を出すと、
 * 意図と違う問題が「課題」として選定されてしまう（実際に発生した）。
 * ID だけでは「存在するが別物」を検出できないため、文言のエコーを突き合わせる。
 */
export function validateSelectionEchoes(
  problems: ProblemItem[],
  selection: { problem_id: string; problem_text_echo?: string }[],
): { ok: SelectionEchoResult[]; mismatched: SelectionEchoResult[] } {
  const ok: SelectionEchoResult[] = [];
  const mismatched: SelectionEchoResult[] = [];
  for (const s of selection) {
    const p = problems.find((x) => x.id === s.problem_id);
    const echo = (s.problem_text_echo ?? "").trim();
    const result: SelectionEchoResult = {
      problem_id: s.problem_id,
      echo,
      stored_text: p?.text ?? null,
    };
    if (!p || p.retired) {
      mismatched.push(result);
      continue;
    }
    // エコー未指定は照合できないので不一致扱いにする（省略で素通りさせない）
    if (echo.length === 0) {
      mismatched.push(result);
      continue;
    }
    const a = normalizeForEcho(p.text);
    const b = normalizeForEcho(echo);
    // 先頭一致・部分一致のどちらでも可（AIは冒頭を引用することが多い）
    if (b.length >= 6 && (a.startsWith(b) || a.includes(b) || b.includes(a))) ok.push(result);
    else mismatched.push(result);
  }
  return { ok, mismatched };
}

export interface SelectionEchoResult {
  problem_id: string;
  echo: string;
  stored_text: string | null;
}

/** 課題の選別（JIS Q 9024 の重点指向）。3軸とも 1〜5 */
export interface SelectionItem {
  problem_id: string;
  /**
   * 対象問題の文言のエコー（AIが保存済みの文言を引き写したもの）。
   * problem_id だけでは「存在するが別物」を検出できないため照合に使う。
   */
  problem_text_echo?: string;
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
  /** 発言中で挙げた制度・調査・研究の出典（assistantメッセージのみ） */
  references?: IssueReference[];
  /**
   * 出典が要りそうな固有名詞・数値を挙げているのに references が空だった印。
   * 画面で注意を促すために立てる（保存はするが、担当者が検証できるようにする）。
   */
  unsourced?: boolean;
}

/** 発言の根拠として示す出典 */
export interface IssueReference {
  /** 資料名・調査名（例: 内閣府「満足度・生活の質に関する調査」） */
  title: string;
  url?: string;
  /** 何をそこから引いたか */
  note?: string;
}

/**
 * 「出典が要りそうな発言か」を判定する（保守的なヒューリスティック）。
 *
 * 真因分析の説明文で、AIが制度名・調査名・ガイドライン名をもっともらしく挙げながら
 * 出典を示さず、しかも名称を取り違えていた事例があった（2026-08-30:
 * 内閣府「満足度・生活の質に関する調査」が測るのは生活満足度なのに幸福感と説明し、
 * OECDの主観的幸福感ガイドラインを「より良い暮らし指標」と取り違えた）。
 * 検証されないまま計画書へ流れ込む経路になるため、画面で注意を促す材料にする。
 *
 * 誤検知を避けるため「鉤括弧つきの固有名詞」と「資料を示す語」の両方が
 * 揃ったときだけ真とする。
 */
const CITATION_SOURCE_WORDS = [
  "調査", "ガイドライン", "指標", "白書", "統計", "研究", "報告書", "指針", "基準", "法", "省", "庁", "OECD", "WHO",
];

export function needsCitation(text: string): boolean {
  const quoted = /[「『][^」』]{3,60}[」』]/.test(text);
  if (!quoted) return false;
  return CITATION_SOURCE_WORDS.some((w) => text.includes(w));
}

/** 選定と点数の矛盾（重点指向の破れ） */
export interface SelectionInconsistency {
  selected_id: string;
  selected_score: number;
  unselected_id: string;
  unselected_score: number;
}

/**
 * 「選定した課題より高い点数の問題が選外になっている」組み合わせを返す。
 *
 * JIS Q 9024 の重点指向は点数の上位から選ぶ考え方なので、この状態は
 * 点数か選定のどちらかが誤っている合図になる。実際、IDの取り違えを直した際に
 * 選定フラグだけが移り、点数は元の並びのまま残る事故が起きた（2026-08-30）。
 * 書き出し時の優先順位ランクは点数の降順で採番されるため、放置すると
 * 最重要の課題が最下位で登録される。
 *
 * 判断そのものは担当者に委ねる（低い点数でも選ぶ判断はありうる）。
 * ここでは矛盾の所在を示すだけで、選定を書き換えたりはしない。
 */
export function findSelectionInconsistencies(
  problems: ProblemItem[],
  selection: SelectionItem[],
): SelectionInconsistency[] {
  const alive = new Set(activeProblems(problems).map((p) => p.id));
  const live = selection.filter((s) => alive.has(s.problem_id));
  const picked = live.filter((s) => s.selected);
  const dropped = live.filter((s) => !s.selected);
  const out: SelectionInconsistency[] = [];
  for (const p of picked) {
    for (const d of dropped) {
      if (d.score > p.score) {
        out.push({
          selected_id: p.problem_id,
          selected_score: p.score,
          unselected_id: d.problem_id,
          unselected_score: d.score,
        });
      }
    }
  }
  return out;
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

/** 退役した問題を除いた、選定済み問題IDの集合（下流はこれを使う） */
export function selectedActiveProblemIds(
  problems: ProblemItem[],
  selection: SelectionItem[],
): string[] {
  const alive = new Set(activeProblems(problems).map((p) => p.id));
  return selectedProblemIds(selection).filter((id) => alive.has(id));
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
