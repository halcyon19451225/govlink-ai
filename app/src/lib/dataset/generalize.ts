/**
 * 粗化（汎化）— 設計: claude/coe-dataset-model.md §5-1・前回案 §3-2
 *
 * はしごは辞書に固定されている。対話や CSV の列名任せにしない。
 */
import type { AttributeDefinition } from "./types";

/** 年齢（整数）→ 5歳階級コード */
export function ageToBand5(age: number): string | null {
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  // 下限は 20 歳。どの分野の計画でも使えるよう、特定の年齢層に寄せた区切りにしない
  if (age < 20) return "u20";
  if (age >= 100) return "100+";
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

/** 生年月日と基準日から年齢 */
export function ageAt(birth: Date, asOf: Date): number {
  let age = asOf.getFullYear() - birth.getFullYear();
  const m = asOf.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * コードをはしごの level 段まで粗くする。level 0 は元のまま。
 * はしごの段数を超える level は「削除」（'*'）として扱う。
 * 写像に無いコードは null（不正値）。
 */
export function generalizeCode(def: AttributeDefinition, code: string, level: number): string | null {
  if (level <= 0) return code;
  const levels = def.generalization?.levels ?? [];
  let v = code;
  for (let i = 0; i < level; i++) {
    const lv = levels[i];
    if (!lv) return "*";
    // 値の語彙が自治体ごとに違う属性は、この段で全部まとめる（写像を持てない）
    if (lv.collapseTo !== undefined) {
      v = lv.collapseTo;
      continue;
    }
    const next = lv.map?.[v];
    if (next === undefined) return v === "*" ? "*" : null;
    v = next;
  }
  return v;
}

/** その属性で取りうる最大の段（＝削除の1つ手前） */
export function maxLevel(def: AttributeDefinition): number {
  return def.generalization?.levels.length ?? 0;
}
