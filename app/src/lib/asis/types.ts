// 対話型の現状整理（As-Is分析）の共有型・定数（クライアント/サーバー両用、DBアクセスなし）

// ─── PESTLE（外部環境）───────────────────────────
export type PestleKey = "P" | "E" | "S" | "T" | "L" | "Env";

export interface ExternalItem {
  text: string;
  pestle: PestleKey;
}

export interface PestleMeta {
  key: PestleKey;
  label: string; // 例: 政治
  full: string; // 例: Politics
  color: string; // バッジ背景/文字色のベース
}

export const PESTLE_META: Record<PestleKey, PestleMeta> = {
  P: { key: "P", label: "政治", full: "Politics", color: "#3b82f6" }, // 青
  E: { key: "E", label: "経済", full: "Economy", color: "#10b981" }, // 緑
  S: { key: "S", label: "社会", full: "Society", color: "#f59e0b" }, // オレンジ
  T: { key: "T", label: "技術", full: "Technology", color: "#a855f7" }, // パープル
  L: { key: "L", label: "法規制", full: "Legal", color: "#ef4444" }, // 赤
  Env: { key: "Env", label: "環境", full: "Environment", color: "#14b8a6" }, // ティール
};

export const PESTLE_ORDER: PestleKey[] = ["P", "E", "S", "T", "L", "Env"];

// ─── マッキンゼー7S（内部環境）─────────────────────
export type SevenSKey =
  | "strategy"
  | "structure"
  | "system"
  | "shared_values"
  | "skills"
  | "staff"
  | "style";

export interface InternalItem {
  text: string;
  seven_s: SevenSKey;
}

export interface SevenSMeta {
  key: SevenSKey;
  label: string;
  hard: boolean; // ハードの3S = true / ソフトの4S = false
}

export const SEVEN_S_META: Record<SevenSKey, SevenSMeta> = {
  // ハードの3S
  strategy: { key: "strategy", label: "戦略", hard: true },
  structure: { key: "structure", label: "組織構造", hard: true },
  system: { key: "system", label: "システム・制度", hard: true },
  // ソフトの4S
  shared_values: { key: "shared_values", label: "共通の価値観", hard: false },
  skills: { key: "skills", label: "スキル", hard: false },
  staff: { key: "staff", label: "人材", hard: false },
  style: { key: "style", label: "組織風土", hard: false },
};

export const SEVEN_S_ORDER: SevenSKey[] = [
  "strategy",
  "structure",
  "system",
  "shared_values",
  "skills",
  "staff",
  "style",
];

// ハード=濃いグレー / ソフト=薄いグレー
export const SEVEN_S_HARD_COLOR = "#475569"; // slate-600（濃いグレー）
export const SEVEN_S_SOFT_COLOR = "#94a3b8"; // slate-400（薄いグレー）

// ─── SWOT / 対話状態 ────────────────────────────
export interface SwotData {
  opportunities: ExternalItem[];
  threats: ExternalItem[];
  strengths: InternalItem[];
  weaknesses: InternalItem[];
}

export interface CrossAnalysis {
  so: string[]; // 強み×機会（積極化戦略）
  wo: string[]; // 弱み×機会（改善戦略）
  st: string[]; // 強み×脅威（差別化戦略）
  wt: string[]; // 弱み×脅威（防衛/撤退戦略）
}

export type AsisStep = "external" | "internal" | "cross" | "done";

export interface AsisMessage {
  role: "user" | "assistant";
  content: string;
  step?: AsisStep;
}

export const EMPTY_SWOT: SwotData = {
  opportunities: [],
  threats: [],
  strengths: [],
  weaknesses: [],
};

export const EMPTY_CROSS: CrossAnalysis = { so: [], wo: [], st: [], wt: [] };

export const STEP_LABEL: Record<AsisStep, string> = {
  external: "外部環境（PESTLE）",
  internal: "内部環境（7S）",
  cross: "クロス分析",
  done: "完了",
};

export function isPestleKey(v: unknown): v is PestleKey {
  return typeof v === "string" && v in PESTLE_META;
}

export function isSevenSKey(v: unknown): v is SevenSKey {
  return typeof v === "string" && v in SEVEN_S_META;
}
