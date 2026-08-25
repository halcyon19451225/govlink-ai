/**
 * AIゲートウェイ — タスク種別の語彙（純粋・テスト可能） — X1
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * ゲートウェイ（gateway.ts）・ルーティング設定（ai_task_routing）・
 * Ordo管理API・検査スクリプトはすべてここの語彙を参照する。
 * 新しい呼び出し箇所を作るときは、ここに種別を追加してから使うこと
 * （未知の種別はゲートウェイが実行時に拒否する）。
 *
 * 設計: claude/coe-ownai-plan.md（承認済み方針）X1。
 */

// ─── タスク種別 ───────────────────────────────────────────

export const AI_TASK_TYPES = [
  { key: "dialogue.asis", label: "現状整理（SWOT等）の対話", domain: "analysis" },
  { key: "dialogue.issue", label: "課題仮説設定の対話", domain: "proposal" },
  { key: "dialogue.measure", label: "施策構築（EBPM）の対話", domain: "proposal" },
  { key: "dialogue.improvement", label: "A改善の対話", domain: "proposal" },
  { key: "proposal.issue_hypothesis", label: "課題仮説のAI提案", domain: "proposal" },
  { key: "proposal.goals", label: "目標のAI提案", domain: "proposal" },
  { key: "proposal.improvements", label: "改善策のAI提案", domain: "proposal" },
  { key: "generation.logic_model", label: "ロジックモデル生成", domain: "proposal" },
  { key: "generation.report", label: "レポート生成", domain: "generation" },
  { key: "generation.schedule", label: "スケジュール生成", domain: "generation" },
  { key: "generation.summary", label: "投稿サマリー生成", domain: "generation" },
  { key: "analysis.gap", label: "ギャップ分析", domain: "analysis" },
  { key: "analysis.gap_values", label: "ギャップ分析の値提案", domain: "analysis" },
  { key: "analysis.stats", label: "統計データの解釈", domain: "analysis" },
  { key: "analysis.evidence", label: "エビデンス評価", domain: "analysis" },
  { key: "knowledge.compile", label: "ナレッジのコンパイル", domain: "knowledge" },
  { key: "knowledge.dict_edit", label: "ナレッジ辞書のAI編集", domain: "knowledge" },
  { key: "knowledge.summarize", label: "資料の要約", domain: "knowledge" },
  { key: "knowledge.extract", label: "ナレッジからの施策・エビデンス抽出", domain: "knowledge" },
  { key: "knowledge.harvest", label: "自動収集ソースからの構造化抽出", domain: "knowledge" },
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number]["key"];

const TASK_TYPE_SET: ReadonlySet<string> = new Set(AI_TASK_TYPES.map((t) => t.key));

export function isAiTaskType(v: unknown): v is AiTaskType {
  return typeof v === "string" && TASK_TYPE_SET.has(v);
}

// ─── ルーティング ─────────────────────────────────────────

/**
 * 動作モード。X4でコーパス接地が入り、実装済みは claude / shadow / assist:
 *  - shadow … 裏でコーパス検索・記録のみ（利用者に出さない。品質計測用）
 *  - assist … コーパス検索結果をプロンプトへ注入
 *  - primary … 独自AI主体（未実装。当面は assist として動作する）
 * 未実装モードが設定されていても安全側の実装済み動作へ解決する
 * （ダイヤルを先に回しても壊れない）。
 */
export const AI_ROUTING_MODES = ["claude", "shadow", "assist", "primary"] as const;
export type AiRoutingMode = (typeof AI_ROUTING_MODES)[number];

/** ゲートウェイ・接地が実際に動かせるモード（X4時点） */
export const IMPLEMENTED_ROUTING_MODES: readonly AiRoutingMode[] = [
  "claude",
  "shadow",
  "assist",
];

export interface AiTaskRouting {
  task_type: AiTaskType;
  mode: AiRoutingMode;
  /** 独自AIのウェート 0〜100 */
  ordo_weight: number;
}

/** DB行・API入力からルーティング設定を安全に取り込む */
export function normalizeRouting(row: unknown): AiTaskRouting | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  if (!isAiTaskType(o["task_type"])) return null;
  const mode = AI_ROUTING_MODES.includes(o["mode"] as AiRoutingMode)
    ? (o["mode"] as AiRoutingMode)
    : "claude";
  const rawWeight = typeof o["ordo_weight"] === "number" ? o["ordo_weight"] : 0;
  const ordo_weight = Math.min(100, Math.max(0, Math.round(rawWeight)));
  return { task_type: o["task_type"], mode, ordo_weight };
}

/**
 * 設定されたモードを、実装済みの動作へ解決する。
 * primary は独自AIの生成が内製化されるまで assist（最も近い実装済み動作）に、
 * それ以外の未実装値は claude に落とす。
 */
export function resolveEffectiveMode(mode: AiRoutingMode): AiRoutingMode {
  if (IMPLEMENTED_ROUTING_MODES.includes(mode)) return mode;
  if (mode === "primary") return "assist";
  return "claude";
}

// ─── モデル ───────────────────────────────────────────────

/** ゲートウェイ経由の呼び出しで model 未指定時に使う既定モデル */
export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";
