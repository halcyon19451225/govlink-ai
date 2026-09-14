/**
 * 庁内キーの種別と正規化規則 — 設計: claude/coe-dataset-model.md §6-5
 *
 * sid は「鍵 ＋ 計画 ID ＋ キー種別 ＋ 正規化した庁内キー」から導出する。
 * 同じ人が同じ sid になることを、ツールの版や担当者に依存させないため、
 * 正規化の規則は**公開仕様として凍結**する。規則を変えると sid が変わるので、
 * 変更は鍵のローテーションと同じ扱い（旧→新の別名ペアが要る）。
 * `check:dataset` が既存キー種別の規則のダイジェストを固定している。
 *
 * **個人番号（マイナンバー）はここに無い。** 語彙に無いので導出の入力にできない。
 */

export const KEY_TYPES_VERSION = 1;

export type KeyType =
  | "atena" // 団体内統合宛名番号（推奨の主キー）
  | "hihokensha" // 介護保険 被保険者番号
  | "kokuho" // 国民健康保険 記号番号
  | "kouki" // 後期高齢者医療 被保険者番号
  | "kenshin" // 健診受診者ID
  | "shogai" // 障害福祉 受給者番号
  | "seiho"; // 生活保護 ケース番号＋世帯員番号

export interface KeyTypeSpec {
  type: KeyType;
  label: string;
  description: string;
  /** 正規化後に満たすべき形 */
  pattern: RegExp;
  /** ゼロ埋めする桁数（数字のみのキーで、桁数が固定のもの） */
  zeroPad?: number;
  /** 記号を保持するか（false なら空白・ハイフン等を全部落とす） */
  keepSeparator?: boolean;
}

/** 全角英数・記号を半角に、空白を除去 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/[　\s]/g, "")
    .replace(/[ー－‐−–—]/g, "-");
}

export const KEY_TYPES: readonly KeyTypeSpec[] = [
  {
    type: "atena",
    label: "宛名番号",
    description: "団体内統合宛名番号。数字のみ。先頭のゼロは意味を持つので保持する",
    pattern: /^\d{1,15}$/,
  },
  {
    type: "hihokensha",
    label: "被保険者番号（介護保険）",
    description: "10桁の数字。桁が足りない場合は先頭をゼロで埋める",
    pattern: /^\d{10}$/,
    zeroPad: 10,
  },
  {
    type: "kokuho",
    label: "記号番号（国保）",
    description: "記号と番号をハイフン1つで結合する（例: 12-345678）",
    pattern: /^[0-9A-Z]{1,10}-[0-9A-Z]{1,10}$/,
    keepSeparator: true,
  },
  {
    type: "kouki",
    label: "被保険者番号（後期高齢者医療）",
    description: "8桁の数字",
    pattern: /^\d{8}$/,
    zeroPad: 8,
  },
  {
    type: "kenshin",
    label: "健診受診者ID",
    description: "健康管理システムの受診者ID。英数字。ハイフンは保持する",
    pattern: /^[0-9A-Z-]{1,20}$/,
    keepSeparator: true,
  },
  {
    type: "shogai",
    label: "受給者番号（障害福祉）",
    description: "10桁の数字",
    pattern: /^\d{10}$/,
    zeroPad: 10,
  },
  {
    type: "seiho",
    label: "ケース番号＋世帯員番号（生活保護）",
    description: "ケース番号と世帯員番号をハイフンで結合する（例: 123456-02）",
    pattern: /^\d{1,10}-\d{1,3}$/,
    keepSeparator: true,
  },
];

export function findKeyType(type: string): KeyTypeSpec | undefined {
  return KEY_TYPES.find((k) => k.type === type);
}

export type NormalizeResult =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "unknown_key_type" | "pattern_mismatch" };

/**
 * 庁内キーを正規化する。結果は決定的で、同じ入力からは常に同じ値が返る。
 */
export function normalizeKey(type: string, raw: string): NormalizeResult {
  const spec = findKeyType(type);
  if (!spec) return { ok: false, reason: "unknown_key_type" };
  let s = toHalfWidth(String(raw ?? "")).toUpperCase();
  if (!spec.keepSeparator) s = s.replace(/[^0-9A-Z]/g, "");
  else s = s.replace(/[^0-9A-Z-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (s.length === 0) return { ok: false, reason: "empty" };
  if (spec.zeroPad && /^\d+$/.test(s) && s.length < spec.zeroPad) {
    s = s.padStart(spec.zeroPad, "0");
  }
  if (!spec.pattern.test(s)) return { ok: false, reason: "pattern_mismatch" };
  return { ok: true, value: s };
}

/**
 * 規則の凍結用ダイジェスト材料。check:dataset がこれを固定する。
 * （正規表現とゼロ埋め桁数を変えると値が変わる）
 */
export function keyTypesFingerprint(): string {
  return KEY_TYPES.map(
    (k) => `${k.type}:${k.pattern.source}:${k.zeroPad ?? 0}:${k.keepSeparator ? 1 : 0}`,
  ).join("|");
}
