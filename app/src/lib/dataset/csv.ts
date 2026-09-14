/**
 * CSV の読み取り（純関数）— 設計: claude/coe-dataset-model.md §4-2
 *
 * 自治体の帳票は Shift_JIS が多い。UTF-8（BOM 有無）として厳密に復号できなければ Shift_JIS として読む。
 * RFC 4180 相当（ダブルクォート・改行を含むセル・CRLF）に対応する。
 */

export interface ParsedCsv {
  header: string[];
  rows: Record<string, string>[];
  encoding: "utf-8" | "shift_jis";
  /** 列数が合わない行（1始まりの行番号・ヘッダを除く）。取り込みからは除外される */
  malformed: number[];
}

/** バイト列を文字列にする。UTF-8 として不正なら Shift_JIS */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: ParsedCsv["encoding"] } {
  let body = bytes;
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) body = body.subarray(3);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { text, encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("shift_jis").decode(body);
    return { text, encoding: "shift_jis" };
  }
}

/** 文字列を行×列に分解する（クォート対応） */
export function splitCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      // CRLF / CR
      if (text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  // 末尾の空行を落とす
  while (out.length > 0 && out[out.length - 1]!.every((v) => v.trim() === "")) out.pop();
  return out;
}

/** 列名の表記ゆれを吸収（前後の空白・全角空白・BOM の残骸） */
export function normalizeHeader(name: string): string {
  return name.replace(/^﻿/, "").replace(/[\s　]+/g, "").trim();
}

export function parseCsv(bytes: Uint8Array): ParsedCsv {
  const { text, encoding } = decodeCsvBytes(bytes);
  const table = splitCsv(text);
  if (table.length === 0) return { header: [], rows: [], encoding, malformed: [] };
  const header = table[0]!.map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  const malformed: number[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    if (cells.every((v) => v.trim() === "")) continue;
    if (cells.length !== header.length) {
      // 末尾の空セルの過不足だけなら吸収する
      const trimmed = [...cells];
      while (trimmed.length > header.length && trimmed[trimmed.length - 1]!.trim() === "") trimmed.pop();
      while (trimmed.length < header.length) trimmed.push("");
      if (trimmed.length !== header.length) {
        malformed.push(i);
        continue;
      }
      rows.push(Object.fromEntries(header.map((h, j) => [h, trimmed[j]!.trim()])));
      continue;
    }
    rows.push(Object.fromEntries(header.map((h, j) => [h, cells[j]!.trim()])));
  }
  return { header, rows, encoding, malformed };
}
