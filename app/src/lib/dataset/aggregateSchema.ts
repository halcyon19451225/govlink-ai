/**
 * 集計データの箱の列定義と、行の検証 — 設計: claude/coe-dataset-model.md §4-2・§4-3
 *
 * 集計データは「ファイルを置く」のではなく、列定義に沿って行を DB（dataset_rows）に取り込む。
 * そうしないと指標が機械的に計算できない。
 */
import type { ColumnSpec } from "./types";
import { looksLikeMyNumber } from "./guard";

export interface AggregateRow {
  dims: Record<string, string>;
  /** 正規化した基準日（YYYY-MM-DD）。time 列が無い箱は版の as_of を使う */
  period: string;
  measures: Record<string, number>;
}

export type RowError =
  | { row: number; column: string; reason: "missing" | "invalid_number" | "invalid_time" | "invalid_code" | "looks_like_my_number" };

/** 列定義の構造検査 */
export function validateColumnSchema(schema: ColumnSpec[]): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const c of schema) {
    if (!c.name) errors.push("列名が空");
    if (names.has(c.name)) errors.push(`${c.name}: 重複`);
    names.add(c.name);
    if (c.role === "measure" && !["int", "numeric"].includes(c.type)) errors.push(`${c.name}: measure は数値型`);
    if (c.role === "time" && !["fiscal_year", "year", "month", "date"].includes(c.type)) errors.push(`${c.name}: time は日付型`);
  }
  if (schema.filter((c) => c.role === "time").length > 1) errors.push("time 列は1つまで");
  if (!schema.some((c) => c.role === "measure")) errors.push("measure 列が1つも無い");
  return errors;
}

function normalizeTime(type: ColumnSpec["type"], s: string): string | null {
  const t = s.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (type === "fiscal_year" || type === "year") {
    // 「2026」「2026年度」「令和8年度」「R8」
    let m = t.match(/^(\d{4})/);
    if (m) return `${m[1]}-04-01`;
    m = t.match(/^(?:令和|R)\s*(\d{1,2})/);
    if (m) return `${2018 + Number(m[1])}-04-01`;
    m = t.match(/^(?:平成|H)\s*(\d{1,2})/);
    if (m) return `${1988 + Number(m[1])}-04-01`;
    return null;
  }
  if (type === "month") {
    const m = t.match(/^(\d{4})[-/年]?(\d{1,2})/);
    return m ? `${m[1]}-${m[2]!.padStart(2, "0")}-01` : null;
  }
  const m = t.match(/^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
  return m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : null;
}

/**
 * CSV の行（列名 → 文字列）を列定義に沿って検証・正規化する。
 * 足りない列は拒否、余分な列は捨てる（§7 ルール7）。
 */
export function validateAggregateRows(
  schema: ColumnSpec[],
  rows: ReadonlyArray<Record<string, string>>,
  fallbackPeriod: string,
): { rows: AggregateRow[]; errors: RowError[] } {
  const out: AggregateRow[] = [];
  const errors: RowError[] = [];
  rows.forEach((raw, i) => {
    const rowNo = i + 1;
    const dims: Record<string, string> = {};
    const measures: Record<string, number> = {};
    let period = fallbackPeriod;
    let bad = false;
    for (const c of schema) {
      const v = raw[c.name];
      if (v === undefined || v === "") {
        if (c.required !== false && c.role !== "measure") {
          errors.push({ row: rowNo, column: c.name, reason: "missing" });
          bad = true;
        }
        continue;
      }
      if (looksLikeMyNumber(v)) {
        errors.push({ row: rowNo, column: c.name, reason: "looks_like_my_number" });
        bad = true;
        continue;
      }
      if (c.role === "measure") {
        const n = Number(String(v).replace(/[,，%％]/g, ""));
        if (!Number.isFinite(n)) {
          errors.push({ row: rowNo, column: c.name, reason: "invalid_number" });
          bad = true;
        } else measures[c.name] = n;
      } else if (c.role === "time") {
        const p = normalizeTime(c.type, String(v));
        if (!p) {
          errors.push({ row: rowNo, column: c.name, reason: "invalid_time" });
          bad = true;
        } else period = p;
      } else {
        const s = String(v).trim();
        if (c.codes && !c.codes.includes(s)) {
          errors.push({ row: rowNo, column: c.name, reason: "invalid_code" });
          bad = true;
        } else dims[c.name] = s;
      }
    }
    if (!bad) out.push({ dims, period, measures });
  });
  return { rows: out, errors };
}
