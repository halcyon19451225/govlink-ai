/**
 * 個人番号（マイナンバー）混入ガード — 設計: claude/coe-dataset-model.md §7 ルール4・11
 *
 * 事故は「うっかり列を消し忘れた」で起きる。人の注意ではなく機械で止める。
 * - 庁内の変換ツール: 出力の全セルを走査し、1件でも該当すれば出力を中止
 * - Coe の取込口:     全フィールドを走査し、該当すれば 400 で拒否。値はログに残さない
 *
 * 判定は「12桁の数字で、末尾が検査用数字として成立する」こと。
 * 検査用数字の算式は 行政手続における特定の個人を識別するための番号の利用等に関する
 * 法律の規定による通知カード及び個人番号カード並びに情報提供ネットワークシステムによる
 * 特定個人情報の提供等に関する命令（平成26年総務省令第85号）第5条:
 *   検査用数字 = 11 − (Σ_{n=1}^{11} P_n × Q_n を 11 で除した余り)
 *   ただし余りが 1 以下のときは 0
 *   P_n: 検査用数字以外の11桁の、最下位から n 桁目の数字
 *   Q_n: n ≦ 6 のとき n+1、n ≧ 7 のとき n−5
 *
 * 誤検知率は約 1/10（末尾が一様な12桁の数値列は1割の確率で通る）。
 * 誤検知が出たら「その列をそもそも持ち込まない」判断を促す（ガードを緩めない）。
 */

/** 11桁の本体から検査用数字を計算する */
export function myNumberCheckDigit(body11: string): number {
  if (!/^\d{11}$/.test(body11)) throw new Error("body11 must be 11 digits");
  let sum = 0;
  for (let n = 1; n <= 11; n++) {
    const p = Number(body11[11 - n]);
    const q = n <= 6 ? n + 1 : n - 5;
    sum += p * q;
  }
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
}

/** 空白・ハイフン・全角数字を吸収したうえで、個人番号として成立する形か */
export function looksLikeMyNumber(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-ー－‐]/g, "");
  if (!/^\d{12}$/.test(s)) return false;
  return myNumberCheckDigit(s.slice(0, 11)) === Number(s[11]);
}

export interface GuardHit {
  row: number;
  column: string;
}

/**
 * 表（行の配列）を走査し、個人番号様の値の位置を返す。値そのものは返さない。
 * `limit` 件見つかった時点で打ち切る（1件でも見つかれば出力は中止するため）
 */
export function scanForMyNumber(
  rows: ReadonlyArray<Record<string, unknown>>,
  limit = 20,
): GuardHit[] {
  const hits: GuardHit[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    for (const [column, value] of Object.entries(row)) {
      if (looksLikeMyNumber(value)) {
        hits.push({ row: i + 1, column });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
