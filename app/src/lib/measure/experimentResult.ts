/**
 * 実験結果 → エビデンス昇格のロジック（純粋・テスト可能） — X2
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * 実験結果の語彙（効果の方向）と、昇格時のエビデンスレベル判定・
 * EvidenceItem への変換・evidence_status の更新規則はここに集約する。
 * API・画面はここだけを参照する（039 の COMMENT からも参照）。
 *
 * ── 判定の考え方（正直さを最優先）──────────────────────────
 * - レベルは実験設計の種別が持つ既定値（EXPERIMENT_DESIGN_META.level:
 *   RCT系=4 / 準実験=3 / 前後比較=2）から引く。
 * - 計画どおり実施できなかった場合（無作為化の崩れ・大量脱落等）は
 *   内的妥当性が下がるため 1 段階下げる（下限1）。何が崩れたかは
 *   deviation_note に残し、昇格後も transferability 欄で開示する。
 * - 効果が出なかった実験（no_change / worsened / unclear）も昇格対象。
 *   「効かなかった」ことも次の計画には同じ重みの根拠になる。方向は
 *   effect_direction と effect_summary が正直に持ち、隠さない。
 *
 * 設計: claude/coe-ownai-plan.md（承認済み方針）X2。
 */

import {
  EXPERIMENT_DESIGN_META,
  type EvidenceItem,
  type EvidenceLevel,
  type EvidenceStatus,
  type ExperimentDesignKey,
  type StudyDesignKey,
} from "@/lib/measure/types";

// ─── SQL列（API各ルートで共有）────────────────────────────

/** experiment_results の SELECT 列（日付・タイムスタンプはテキスト化） */
export const EXPERIMENT_RESULT_COLUMNS = `
  id, project_id, measure_design_id, design,
  implemented_as_planned, deviation_note,
  to_char(period_start, 'YYYY-MM-DD') AS period_start,
  to_char(period_end, 'YYYY-MM-DD') AS period_end,
  sample_size, primary_outcome, result_summary, effect_direction, effect_size,
  status, evidence_level, promoted_at::text,
  created_at::text, updated_at::text
`;

// ─── 語彙 ─────────────────────────────────────────────────

export const EFFECT_DIRECTIONS = [
  { key: "improved", label: "改善", color: "#10b981" },
  { key: "no_change", label: "変化なし", color: "#94a3b8" },
  { key: "worsened", label: "悪化", color: "#ef4444" },
  { key: "unclear", label: "判定できず", color: "#f59e0b" },
] as const;

export type EffectDirection = (typeof EFFECT_DIRECTIONS)[number]["key"];

export const EFFECT_DIRECTION_META: Record<
  EffectDirection,
  { label: string; color: string }
> = Object.fromEntries(
  EFFECT_DIRECTIONS.map((d) => [d.key, { label: d.label, color: d.color }]),
) as Record<EffectDirection, { label: string; color: string }>;

export function isEffectDirection(v: unknown): v is EffectDirection {
  return (
    typeof v === "string" && EFFECT_DIRECTIONS.some((d) => d.key === v)
  );
}

/** 実験結果行（experiment_results テーブル）の昇格に必要な部分 */
export interface ExperimentResultForPromotion {
  design: ExperimentDesignKey;
  implemented_as_planned: boolean;
  deviation_note?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  sample_size?: number | null;
  primary_outcome?: string | null;
  result_summary: string;
  effect_direction: EffectDirection;
  effect_size?: string | null;
}

// ─── レベル判定 ───────────────────────────────────────────

/**
 * 昇格時のエビデンスレベル。
 * 設計種別の既定レベルから、計画どおり実施できなかった場合は1段下げる。
 */
export function levelForResult(
  design: ExperimentDesignKey,
  implementedAsPlanned: boolean,
): EvidenceLevel {
  const base = EXPERIMENT_DESIGN_META[design].level;
  if (implementedAsPlanned) return base;
  return Math.max(1, base - 1) as EvidenceLevel;
}

/**
 * 実験設計の種別 → エビデンス項目の研究デザイン区分。
 * RCT系（無作為割付）は rct、対照ありの非無作為は qed、前後比較は prepost。
 * 計画どおり実施できなかったRCT系は無作為化が保証できないため qed に落とす。
 */
export function studyDesignForResult(
  design: ExperimentDesignKey,
  implementedAsPlanned: boolean,
): StudyDesignKey {
  const randomized =
    design === "rct" ||
    design === "cluster_rct" ||
    design === "stepped_wedge" ||
    design === "waitlist";
  if (randomized) return implementedAsPlanned ? "rct" : "qed";
  if (design === "did" || design === "matching") return "qed";
  return "prepost";
}

// ─── EvidenceItem への変換 ────────────────────────────────

export interface PromotionContext {
  /** 施策名（エビデンスの題名に使う） */
  measureTitle: string;
  /** 対象集団（施策の target_population。population 欄に写す） */
  targetPopulation?: string | null;
}

/**
 * 確定済みの実験結果を EvidenceItem（measure_designs.evidence_items の要素）へ変換する。
 * 出所は「自プロジェクトの実験」であることを source に明示し、
 * 逸脱・効果の方向を隠さず effect_summary / transferability に載せる。
 */
export function resultToEvidenceItem(
  result: ExperimentResultForPromotion,
  ctx: PromotionContext,
): EvidenceItem {
  const level = levelForResult(result.design, result.implemented_as_planned);
  const designLabel = EXPERIMENT_DESIGN_META[result.design].label;
  const direction = EFFECT_DIRECTION_META[result.effect_direction].label;

  const parts: string[] = [`【${direction}】${result.result_summary}`];
  if (result.effect_size) parts.push(`効果量: ${result.effect_size}`);
  if (result.sample_size != null) parts.push(`n=${result.sample_size}`);

  const transferParts: string[] = [
    "自プロジェクトで実施した実験の結果（対象・環境が同一のため外的妥当性の懸念は小さい）",
  ];
  if (!result.implemented_as_planned) {
    transferParts.push(
      `計画からの逸脱あり（レベルを1段下げて評価）: ${result.deviation_note ?? "詳細未記載"}`,
    );
  }

  const year = yearFromPeriod(result.period_end ?? result.period_start ?? null);

  const item: EvidenceItem = {
    title: `自プロジェクト実験: ${ctx.measureTitle}${
      result.primary_outcome ? `（${result.primary_outcome}）` : ""
    }`,
    source: `Coe実験記録（${designLabel}）`,
    design: studyDesignForResult(result.design, result.implemented_as_planned),
    evidence_level: level,
    effect_summary: parts.join(" / "),
    transferability: transferParts.join("。"),
  };
  if (year != null) item.year = year;
  if (ctx.targetPopulation) item.population = ctx.targetPopulation;
  return item;
}

function yearFromPeriod(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const y = Number(dateStr.slice(0, 4));
  return Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : null;
}

// ─── evidence_status の更新規則 ───────────────────────────

/**
 * 昇格後の施策の evidence_status。
 * - レベル3以上（対照あり）が得られたら sufficient
 *   （036 の確定条件が要求する「参照可能なエビデンスあり」を満たす）
 * - レベル1〜2 は単独では不十分。none は partial に上げ、
 *   すでに partial / sufficient ならそのまま（下げない）
 */
export function statusAfterPromotion(
  current: EvidenceStatus,
  level: EvidenceLevel,
): EvidenceStatus {
  if (level >= 3) return "sufficient";
  if (current === "none") return "partial";
  return current;
}
