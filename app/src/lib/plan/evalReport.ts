/**
 * 評価結果報告書の調製（PL3 A①）— 章構成・語彙（純粋・テスト可能）
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * 評価報告書の定型6章と、計画書（PL2）との文書種別の対応はここに集約する。
 * plan_documents 基盤（sections/locked/finalized・merge/sanitize）は
 * document.ts のものをそのまま共用する（章構成だけ差し替える）。
 *
 * 位置づけ（設計 A①）:
 *   C工程の成果物（プログラム評価・自己評価・スコアボード）と
 *   A工程の成果物（改善アクション・引き継ぎパッケージ）を1冊に調製し、
 *   確定（finalized）でスナップショット固定して P② 経路1の入力にする。
 */

import { PLAN_CHAPTERS, type PlanChapterDef } from "@/lib/plan/document";

/** plan_documents.variant 上の評価報告書の値（050 の CHECK と同一） */
export const EVAL_REPORT_VARIANT = "evaluation_report" as const;

// ─── 定型6章（設計 A① の章構成・順序固定） ─────────────────

export const EVAL_CHAPTERS: readonly PlanChapterDef[] = [
  {
    id: "overview",
    heading: "計画の概要と評価の方法",
    brief: "計画の目的・期間・三層アウトカム（短期/中間/長期）の枠組み・図6（年次評価）/図7（計画期間評価）の評価方法",
  },
  {
    id: "kpi_status",
    heading: "KPI達成状況",
    brief: "三層アウトカムごとの到達度（基準値からの前進量）と軌道判定の読み方・特筆すべき達成/未達の指摘（表は出力時に自動挿入）",
  },
  {
    id: "measure_results",
    heading: "施策別の評価結果",
    brief: "図6/図7の判断経路の文章化（実施状況→達成状況→要因→改善方向）・成功要因と阻害要因・効率性の所見",
  },
  {
    id: "experiments",
    heading: "実験結果とエビデンス",
    brief: "実験設計（D区画）の実施結果・効果の方向と大きさ・エビデンスレベル・エビデンスとして昇格したもの",
  },
  {
    id: "improvements",
    heading: "課題と改善の方向",
    brief: "評価から特定された課題と真因・改善アクションの一覧と実施状況（表は出力時に自動挿入）",
  },
  {
    id: "handover",
    heading: "次期計画への申し送り",
    brief: "未達アウトカム・持ち越す改善アクション・真因・図6/7の判断のうち次期に引き継ぐ事項（引き継ぎパッケージの内容）",
  },
] as const;

// ─── 文書種別（画面タブ・APIの doc パラメタ） ───────────────

export const DOC_KINDS = [
  { key: "plan", label: "計画書", variant: "full" },
  { key: "eval", label: "評価報告書", variant: EVAL_REPORT_VARIANT },
] as const;

export type DocKind = (typeof DOC_KINDS)[number]["key"];

export function docKindOf(raw: unknown): DocKind {
  return raw === "eval" ? "eval" : "plan";
}

/** doc パラメタ → plan_documents.variant */
export function variantOfDocKind(kind: DocKind): "full" | typeof EVAL_REPORT_VARIANT {
  return kind === "eval" ? EVAL_REPORT_VARIANT : "full";
}

/** doc パラメタ → 章構成（generate/rewrite/merge で使う）。
 *  依存は一方向（evalReport → document）で、document.ts はこのファイルを知らない */
export function chaptersOfDocKind(kind: DocKind): readonly PlanChapterDef[] {
  return kind === "eval" ? EVAL_CHAPTERS : PLAN_CHAPTERS;
}
