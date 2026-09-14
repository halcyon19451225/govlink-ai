/**
 * 庁内キーの正規化 — 設計: claude/coe-dataset-model.md §6-5
 *
 * sid は「鍵 ＋ 計画 ID ＋ キー種別のコード ＋ 正規化した庁内キー」から導出する。
 * 同じ人が同じ sid になることを、ツールの版や担当者に依存させないため、
 * 正規化の**規則は公開仕様として凍結**する。規則を変えると sid が変わるので、
 * 変更は鍵のローテーションと同じ扱い（旧→新の別名ペアが要る）。
 *
 * ★ **キー種別そのものは、この層で列挙しない。**
 *   どの業務システムのどの番号を使うかは自治体と分野によって違う。Coe が持つのは
 *   「正規化の型（style）」だけで、キー種別の実体は `key_type_definitions`
 *   （共通1件＋自治体ごとの追加）に登録する。分野を固定しないための構造。
 *
 * ★ 個人番号（マイナンバー）は、どの style でも入力にしてはならない。
 *   guard.ts が値として機械的に拒否する。
 */

/** 正規化の型。ここに挙動を凍結する（追加は可・既存の変更は check が落とす） */
export type NormalizationStyle = "digits" | "alnum" | "alnum_sep";

export const NORMALIZATION_STYLES: ReadonlyArray<{
  style: NormalizationStyle;
  label: string;
  description: string;
  /** ゼロ埋めを指定できるか */
  allowsZeroPad: boolean;
  example: string;
}> = [
  {
    style: "digits",
    label: "数字のみ",
    description: "全角を半角にし、空白・記号を除いて数字だけにする。先頭のゼロは保持する（桁数を指定すればゼロ埋めする）",
    allowsZeroPad: true,
    example: "０００１２３４５ → 00012345",
  },
  {
    style: "alnum",
    label: "英数字",
    description: "全角を半角に、英字を大文字にし、空白・記号を除く",
    allowsZeroPad: false,
    example: "ab-123 → AB123",
  },
  {
    style: "alnum_sep",
    label: "英数字＋区切り",
    description: "英数字を残し、区切り（ハイフン）を1つに整える。記号と番号を組み合わせた番号に使う",
    allowsZeroPad: false,
    example: "12 － 345678 → 12-345678",
  },
];

/** キー種別の正規化規則（key_type_definitions に保存する形） */
export interface KeyNormalization {
  style: NormalizationStyle;
  /** style='digits' のときだけ。1〜20。指定すると先頭をゼロで埋めて桁を揃える */
  zeroPad?: number;
  /** 正規化後に満たすべき最小・最大の長さ（桁数の取り違えを弾くため） */
  minLength?: number;
  maxLength?: number;
}

/** 全角英数字・記号を半角に、空白を除去し、各種ダッシュをハイフンに寄せる */
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　\s]/g, "")
    .replace(/[ー－‐−–—]/g, "-");
}

export type NormalizeResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "unknown_style" | "too_short" | "too_long" | "invalid_chars" };

/**
 * 庁内キーを正規化する。決定的で、同じ入力からは常に同じ値を返す。
 */
export function normalizeKey(rule: KeyNormalization, raw: string): NormalizeResult {
  const style = NORMALIZATION_STYLES.find((s) => s.style === rule.style);
  if (!style) return { ok: false, reason: "unknown_style" };

  let s = toHalfWidth(String(raw ?? "")).toUpperCase();
  switch (rule.style) {
    case "digits":
      s = s.replace(/[^0-9]/g, "");
      break;
    case "alnum":
      s = s.replace(/[^0-9A-Z]/g, "");
      break;
    case "alnum_sep":
      s = s.replace(/[^0-9A-Z-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
      break;
  }
  if (s.length === 0) return { ok: false, reason: "empty" };
  if (rule.style === "digits" && rule.zeroPad && s.length < rule.zeroPad) {
    s = s.padStart(rule.zeroPad, "0");
  }
  if (rule.minLength && s.length < rule.minLength) return { ok: false, reason: "too_short" };
  if (rule.maxLength && s.length > rule.maxLength) return { ok: false, reason: "too_long" };
  if (s.length > 64) return { ok: false, reason: "too_long" };
  return { ok: true, value: s };
}

/** 規則の構造検査（キー種別を登録するときに使う） */
export function validateNormalization(rule: KeyNormalization): string[] {
  const errors: string[] = [];
  const style = NORMALIZATION_STYLES.find((s) => s.style === rule.style);
  if (!style) errors.push(`正規化の型が不正です: ${String(rule.style)}`);
  if (rule.zeroPad !== undefined) {
    if (!style?.allowsZeroPad) errors.push("この型ではゼロ埋めを指定できません");
    else if (!Number.isInteger(rule.zeroPad) || rule.zeroPad < 1 || rule.zeroPad > 20) errors.push("ゼロ埋めの桁数は 1〜20 です");
  }
  for (const [k, v] of [["minLength", rule.minLength], ["maxLength", rule.maxLength]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 64)) errors.push(`${k} は 1〜64 です`);
  }
  if (rule.minLength && rule.maxLength && rule.minLength > rule.maxLength) errors.push("minLength が maxLength を超えています");
  return errors;
}

/** キー種別のコード（sid の導出に入るので、登録後は変えられない） */
export const KEY_TYPE_CODE_RE = /^[a-z][a-z0-9_]{0,29}$/;

/**
 * 正規化の挙動の指紋。型ごとに固定する（check:dataset が照合）。
 * **型を増やすのは可。既存の型の挙動を変えると落ちる**（sid が変わるため）。
 */
export function normalizationFingerprint(style: NormalizationStyle): string {
  const samples: Array<[KeyNormalization, string]> = [
    [{ style }, "　Ａb-１２３ "],
    [{ style }, "0012-34"],
    [{ style, zeroPad: style === "digits" ? 8 : undefined } as KeyNormalization, "123"],
    [{ style }, "  "],
  ];
  return samples
    .map(([rule, raw]) => {
      const r = normalizeKey(rule, raw);
      return r.ok ? r.value : `!${r.reason}`;
    })
    .join("|");
}
