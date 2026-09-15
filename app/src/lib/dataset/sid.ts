/**
 * 仮名 ID（sid）の導出 — 設計: claude/coe-dataset-model.md §6-2・§6-3・§6-5
 *
 *   sid = "S" + base32crockford( HMAC-SHA256( K, join(project_id, key_type_code, 正規化キー) ) )[:20]
 *
 * join は **長さ（4 バイト・ビッグエンディアン）＋ UTF-8 バイト列** を順に並べる。
 * 区切り文字で繋ぐと ("ab","c") と ("a","bc") が同じ入力になってしまう。
 * 別人が同じ sid になるということなので、区切りではなく長さで分ける。
 * project_id は小文字にしてから連結する（Coe の UUID は常に小文字だが、
 * 大文字で渡ってきたときに庁内ツールと違う sid が出ないようにする）。
 *
 * - K は自治体ごとに1本の 256 bit 乱数。**庁内にしか存在しない。** Coe は keyId だけを持つ
 * - 同じ人からは常に同じ sid が出るので、対応表を持たない（失われたら最悪、が無い）
 * - 復号は存在しない。逆引きは「現在の宛名一覧を同じ式に通して照合する」
 * - **個人番号を入力にしてはならない**（guard.ts が値を拒否する）
 *
 * key_type_code は自治体が登録したキー種別のコード（`key_type_definitions`）。
 * どの業務システムのどの番号かは分野によって違うので、コアは列挙しない。
 *
 * この関数は庁内の変換ツールと、鍵を持つ場でだけ使う。Coe は鍵を持たないので呼べない。
 * 依存は node:crypto のみ。
 */
import { createHmac, createHash, randomBytes } from "node:crypto";
import { normalizeKey, KEY_TYPE_CODE_RE, type KeyNormalization } from "./keyTypes";

export const SID_ALGORITHM = "HMAC-SHA256";
export const SID_PREFIX = "S";
export const SID_LENGTH = 20; // 接頭辞を除く文字数（100 bit）
export const KEY_BYTES = 32;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** バイト列を Crockford Base32 に（パディング無し） */
export function base32Crockford(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/**
 * 連結。各要素を「長さ（4 バイト・ビッグエンディアン）＋ UTF-8 バイト列」で並べる。
 * **庁内の変換ツール（Flow）と同じ方式。片方だけ変えると同じ人から別の sid が出る。**
 * 要素は 4 GiB 未満（実際には数十バイト）。
 */
export function joinParts(parts: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const body = Buffer.from(part, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    chunks.push(len, body);
  }
  return Buffer.concat(chunks);
}

/**
 * 導出の本体。**形式検査をしない**ので、通常は deriveSid を使う。
 * これを直接呼ぶのは庁内ツールとの突き合わせ（固定値でのつき合わせ）のときだけ。
 */
export function sidFromParts(
  key: Uint8Array,
  projectId: string,
  keyTypeCode: string,
  normalizedKey: string,
): string {
  const mac = createHmac("sha256", key)
    .update(joinParts([projectId.toLowerCase(), keyTypeCode, normalizedKey]))
    .digest();
  return SID_PREFIX + base32Crockford(mac).slice(0, SID_LENGTH);
}

/** 鍵を生成する（CSPRNG）。人がパスフレーズを決める方式にはしない */
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * 鍵 ID。鍵のダイジェスト先頭 8 桁（16 進）。
 * 256 bit の鍵は 32 bit の接頭辞からは復元できないので、Coe に置いてよい
 */
export function keyId(key: Uint8Array): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function keyToHex(key: Uint8Array): string {
  return Buffer.from(key).toString("hex");
}

export function keyFromHex(hex: string): Buffer | null {
  const s = hex.replace(/\s/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  return Buffer.from(s, "hex");
}

export type DeriveResult =
  | { ok: true; sid: string; normalizedKey: string }
  | { ok: false; reason: "empty" | "unknown_style" | "too_short" | "too_long" | "invalid_chars" | "bad_key" | "bad_project" | "bad_key_type" };

/**
 * 庁内キーから sid を導出する。
 * @param key         自治体の鍵（32 バイト）
 * @param projectId   Coe の計画 ID（UUID）。計画が違えば同じ人でも別の sid（§6）
 * @param keyTypeCode キー種別のコード（自治体が登録したもの）
 * @param rule        そのキー種別の正規化規則
 * @param rawKey      業務システムの出力そのまま
 */
export function deriveSid(
  key: Uint8Array,
  projectId: string,
  keyTypeCode: string,
  rule: KeyNormalization,
  rawKey: string,
): DeriveResult {
  if (key.length !== KEY_BYTES) return { ok: false, reason: "bad_key" };
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { ok: false, reason: "bad_project" };
  if (!KEY_TYPE_CODE_RE.test(keyTypeCode)) return { ok: false, reason: "bad_key_type" };
  const norm = normalizeKey(rule, rawKey);
  if (!norm.ok) return { ok: false, reason: norm.reason };
  const sid = sidFromParts(key, projectId, keyTypeCode, norm.value);
  return { ok: true, sid, normalizedKey: norm.value };
}

/** sid の形式検査（Coe の取込口で使う。導出はできないが形は検査できる） */
export function isValidSid(s: string): boolean {
  return new RegExp(`^${SID_PREFIX}[0-9A-HJKMNP-TV-Z]{${SID_LENGTH}}$`).test(s);
}
