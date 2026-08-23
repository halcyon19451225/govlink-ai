// 到達度（達成率）の算定 — 全画面で共有する単一の実装
//
// 【なぜ作り直したか】
// 従来は `current / target × 100` を EBPMスコア・KPIサマリー・KPI報告・
// 公開ページがそれぞれ書いていた。この式は目標の向き（achievement_condition）を
// 見ていないため、下向きの指標で破綻する。
//   例: 「介護給付総額 1,400,000,000円 以下」現状 2,300,000,000円
//       → 23億 ÷ 14億 = 164%。未着手の指標が「達成率164%」と表示されていた。
//
// 【新しい定義】計画策定時点（baseline）から目標へどれだけ前進したか。
//   「以上」目標 (gte/gt): (current − baseline) / (target − baseline) × 100
//   「以下」目標 (lte/lt): (baseline − current) / (baseline − target) × 100
//   0% = 策定時から動いていない ／ 100% = 目標到達 ／ 負値 = 逆行
//
// baseline が未設定の KPI では比率方式にフォールバックするが、その場合も
// 向きは考慮する（下向き指標は target / current を使う）。

export type AchievementCondition = "lte" | "lt" | "gte" | "gt" | "eq";

/** 目標の向き。up=大きいほど良い / down=小さいほど良い / exact=一致が良い */
export type AchievementDirection = "up" | "down" | "exact";

/** 算定に使った方式。baseline=正式 / ratio=フォールバック / none=算定不能 */
export type AchievementBasis = "baseline" | "ratio" | "none";

export interface AchievementInput {
  current: number | null | undefined;
  target: number | null | undefined;
  /** 計画策定時点の値。null の場合は比率方式にフォールバック */
  baseline?: number | null | undefined;
  condition?: AchievementCondition | null | undefined;
}

export interface AchievementResult {
  /** 到達度(%)。負値・100超もそのまま返す。算定不能なら null */
  rate: number | null;
  /** 進捗バー用に 0〜100 に丸めた値 */
  clamped: number;
  /** 目標を満たしているか（条件方向を考慮した実値比較） */
  achieved: boolean;
  direction: AchievementDirection;
  basis: AchievementBasis;
  /** 算定式の文字列。説明責任のため画面と帳票に出せる */
  formula: string;
}

export function directionOf(condition: AchievementCondition | null | undefined): AchievementDirection {
  if (condition === "lte" || condition === "lt") return "down";
  if (condition === "eq") return "exact";
  return "up";
}

const CONDITION_LABEL: Record<AchievementCondition, string> = {
  gte: "以上",
  gt: "超",
  lte: "以下",
  lt: "未満",
  eq: "達成",
};

export function conditionLabel(condition: AchievementCondition | null | undefined): string {
  return condition ? CONDITION_LABEL[condition] : "以上";
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** 条件方向を考慮して「目標を満たしているか」を判定する */
export function isAchieved(
  current: number | null | undefined,
  target: number | null | undefined,
  condition: AchievementCondition | null | undefined,
): boolean {
  if (!isNum(current) || !isNum(target)) return false;
  switch (condition) {
    case "lte": return current <= target;
    case "lt": return current < target;
    case "gt": return current > target;
    case "eq": return current === target;
    default: return current >= target; // gte
  }
}

/**
 * 到達度を算定する。全画面はこの関数だけを使うこと。
 */
export function calcAchievement(input: AchievementInput): AchievementResult {
  const { current, target, baseline, condition } = input;
  const direction = directionOf(condition);
  const achieved = isAchieved(current, target, condition);

  const fail = (reason: string): AchievementResult => ({
    rate: null,
    clamped: 0,
    achieved,
    direction,
    basis: "none",
    formula: reason,
  });

  if (!isNum(current) || !isNum(target)) {
    return fail("到達度は算定できません（現在値または目標値が未入力）");
  }

  // ── 正式方式: 基準値からの前進量 ──────────────────
  if (isNum(baseline) && baseline !== target) {
    let rate: number;
    let formula: string;

    if (direction === "down") {
      rate = ((baseline - current) / (baseline - target)) * 100;
      formula = `到達度 = (基準値 ${baseline} − 現在値 ${current}) ÷ (基準値 ${baseline} − 目標値 ${target}) × 100 = ${round1(rate)}%`;
    } else if (direction === "exact") {
      const span = Math.abs(baseline - target);
      rate = ((span - Math.abs(current - target)) / span) * 100;
      formula = `到達度 = (|基準値−目標値| ${round1(span)} − |現在値−目標値| ${round1(Math.abs(current - target))}) ÷ ${round1(span)} × 100 = ${round1(rate)}%`;
    } else {
      rate = ((current - baseline) / (target - baseline)) * 100;
      formula = `到達度 = (現在値 ${current} − 基準値 ${baseline}) ÷ (目標値 ${target} − 基準値 ${baseline}) × 100 = ${round1(rate)}%`;
    }

    return {
      rate: round1(rate),
      clamped: Math.max(0, Math.min(100, Math.round(rate))),
      achieved,
      direction,
      basis: "baseline",
      formula,
    };
  }

  // ── フォールバック: 比率方式（基準値未設定）────────
  // 向きだけは考慮する。基準値を設定すれば正式方式に切り替わる。
  if (direction === "down") {
    if (current === 0) return fail("到達度は算定できません（現在値が0のため比率を取れません）");
    const rate = (target / current) * 100;
    return {
      rate: round1(rate),
      clamped: Math.max(0, Math.min(100, Math.round(rate))),
      achieved,
      direction,
      basis: "ratio",
      formula: `到達度 = 目標値 ${target} ÷ 現在値 ${current} × 100 = ${round1(rate)}%（基準値が未設定のため比率方式）`,
    };
  }

  if (direction === "exact") {
    if (target === 0) return fail("到達度は算定できません（目標値が0）");
    const rate = 100 - (Math.abs(current - target) / Math.abs(target)) * 100;
    return {
      rate: round1(rate),
      clamped: Math.max(0, Math.min(100, Math.round(rate))),
      achieved,
      direction,
      basis: "ratio",
      formula: `到達度 = 100 − |現在値 ${current} − 目標値 ${target}| ÷ |${target}| × 100 = ${round1(rate)}%（基準値が未設定のため比率方式）`,
    };
  }

  if (target === 0) return fail("到達度は算定できません（目標値が0）");
  const rate = (current / target) * 100;
  return {
    rate: round1(rate),
    clamped: Math.max(0, Math.min(100, Math.round(rate))),
    achieved,
    direction,
    basis: "ratio",
    formula: `到達度 = 現在値 ${current} ÷ 目標値 ${target} × 100 = ${round1(rate)}%（基準値が未設定のため比率方式）`,
  };
}

/** 進捗バー用のショートカット（0〜100） */
export function achievementPercent(input: AchievementInput): number {
  return calcAchievement(input).clamped;
}

// ─── 軌道の監視（長期アウトカム用）──────────────────
// 長期アウトカムは「達成/未達」で判定できない（期限が来るまで判定不能）。
// 代わりに「経過時間から見て、いまいるべき位置にいるか」を見る。

export type PaceStatus = "ontrack" | "behind" | "regressing" | "unknown";

export interface PaceResult {
  /** 期間の経過率(%)。＝いまいるべき到達度 */
  requiredPace: number | null;
  /** 到達度 − 必要ペース。正なら前倒し、負なら遅れ */
  diff: number | null;
  status: PaceStatus;
  label: string;
}

/**
 * 期間の経過率から「いまいるべき到達度」を出し、実際の到達度と比較する。
 * @param start 計画開始日
 * @param deadline 目標期限
 * @param rate calcAchievement が返した到達度(%)
 * @param asOf 判定時点（既定は現在）
 */
export function calcPace(
  start: Date | string | null | undefined,
  deadline: Date | string | null | undefined,
  rate: number | null,
  asOf: Date = new Date(),
): PaceResult {
  const s = start ? new Date(start) : null;
  const d = deadline ? new Date(deadline) : null;

  if (!s || !d || Number.isNaN(s.getTime()) || Number.isNaN(d.getTime()) || d <= s) {
    return { requiredPace: null, diff: null, status: "unknown", label: "期間が未設定" };
  }

  const span = d.getTime() - s.getTime();
  const elapsed = Math.max(0, Math.min(span, asOf.getTime() - s.getTime()));
  const requiredPace = round1((elapsed / span) * 100);

  if (rate == null) {
    return { requiredPace, diff: null, status: "unknown", label: "到達度が未算定" };
  }

  const diff = round1(rate - requiredPace);

  if (rate < 0) {
    return { requiredPace, diff, status: "regressing", label: "逆行" };
  }
  // 必要ペースを 5pt 以上下回ったら遅れとみなす
  if (diff < -5) {
    return { requiredPace, diff, status: "behind", label: "遅れ" };
  }
  return { requiredPace, diff, status: "ontrack", label: "軌道上" };
}
