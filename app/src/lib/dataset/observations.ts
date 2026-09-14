/**
 * 値の検証と、横持ち → 五つ組（縦持ち）への変換 — 設計: claude/coe-dataset-model.md §3・§8
 *
 * 庁内の変換ツール（出口）と Coe の取込口（入口）で同じ関数を使う。
 */
import type { AttributeDefinition, Observation, RejectReason, RejectSummary, WideRow } from "./types";
import { looksLikeMyNumber } from "./guard";
import { isValidSid } from "./sid";

export type ValidateResult =
  | { ok: true; valueCode?: string; valueNum?: number; valueBool?: boolean }
  | { ok: false; reason: RejectReason };

const TRUE = new Set(["1", "true", "yes", "y", "有", "あり", "○", "◯", "はい"]);
const FALSE = new Set(["0", "false", "no", "n", "無", "なし", "×", "いいえ", ""]);

/** 辞書に照らして1つの値を検証・正規化する */
export function validateValue(def: AttributeDefinition, raw: unknown): ValidateResult {
  if (!def.cloudAllowed) return { ok: false, reason: "not_cloud_allowed" };
  if (looksLikeMyNumber(raw)) return { ok: false, reason: "looks_like_my_number" };
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  switch (def.valueType) {
    case "code":
    case "band": {
      if (s === "*") return { ok: true, valueCode: "*" }; // 粗化で削除された値
      if (def.codes && Object.keys(def.codes).length > 0 && !(s in def.codes)) {
        // 粗化後のコード（はしごの写像先）も許す
        const derived = new Set<string>();
        for (const lv of def.generalization?.levels ?? []) {
          if (lv.collapseTo !== undefined) derived.add(lv.collapseTo);
          for (const v of Object.values(lv.map ?? {})) derived.add(v);
        }
        if (!derived.has(s)) return { ok: false, reason: "invalid_code" };
      }
      if (s === "") return { ok: false, reason: "invalid_code" };
      return { ok: true, valueCode: s };
    }
    case "int": {
      if (!/^-?\d+$/.test(s.replace(/,/g, ""))) return { ok: false, reason: "invalid_number" };
      return { ok: true, valueNum: Number(s.replace(/,/g, "")) };
    }
    case "numeric": {
      const n = Number(s.replace(/,/g, ""));
      if (s === "" || !Number.isFinite(n)) return { ok: false, reason: "invalid_number" };
      return { ok: true, valueNum: n };
    }
    case "bool": {
      const l = s.toLowerCase();
      if (typeof raw === "boolean") return { ok: true, valueBool: raw };
      if (TRUE.has(l)) return { ok: true, valueBool: true };
      if (FALSE.has(l)) return { ok: true, valueBool: false };
      return { ok: false, reason: "invalid_bool" };
    }
    case "month": {
      const m = s.match(/^(\d{4})[-/]?(\d{1,2})$/);
      if (!m) return { ok: false, reason: "invalid_date" };
      return { ok: true, valueCode: `${m[1]}-${m[2]!.padStart(2, "0")}` };
    }
    case "fiscal_year": {
      if (!/^\d{4}$/.test(s)) return { ok: false, reason: "invalid_date" };
      return { ok: true, valueNum: Number(s) };
    }
  }
}

/** 基準日を、属性の時点粒度に合わせて丸める（月→月初、年度→年度開始日、不変→1900-01-01） */
export function observedAtFor(def: AttributeDefinition, asOf: string): string {
  const m = asOf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`asOf must be YYYY-MM-DD: ${asOf}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  switch (def.timeGranularity) {
    case "day":
      return asOf;
    case "month":
      return `${m[1]}-${m[2]}-01`;
    case "fiscal_year": {
      const fy = mo >= 4 ? y : y - 1;
      return `${fy}-04-01`;
    }
    case "static":
      return "1900-01-01";
  }
}

export interface ToObservationsResult {
  observations: Observation[];
  rejects: RejectSummary[];
  accepted: number;
}

/**
 * 横持ち行を五つ組に展開する。sid の無い行・辞書に無い属性・不正な値は拒否し、
 * 種別と件数だけを返す（値は残さない）。
 */
export function wideToObservations(
  rows: readonly WideRow[],
  dict: readonly AttributeDefinition[],
  asOf: string,
): ToObservationsResult {
  const byKey = new Map(dict.map((d) => [d.key, d]));
  const rejects = new Map<string, RejectSummary>();
  const reject = (reason: RejectReason, attrKey?: string) => {
    const id = `${reason}:${attrKey ?? ""}`;
    const r = rejects.get(id);
    if (r) r.count++;
    else rejects.set(id, attrKey === undefined ? { reason, count: 1 } : { reason, attrKey, count: 1 });
  };
  const observations: Observation[] = [];
  let accepted = 0;
  for (const row of rows) {
    if (!isValidSid(row.sid)) {
      reject("missing_sid");
      continue;
    }
    let any = false;
    for (const [attrKey, raw] of Object.entries(row.values)) {
      const def = byKey.get(attrKey);
      if (!def) {
        reject("unknown_attr", attrKey);
        continue;
      }
      const v = validateValue(def, raw);
      if (!v.ok) {
        reject(v.reason, attrKey);
        continue;
      }
      observations.push({
        sid: row.sid,
        attrKey,
        observedAt: observedAtFor(def, asOf),
        ...(v.valueCode !== undefined ? { valueCode: v.valueCode } : {}),
        ...(v.valueNum !== undefined ? { valueNum: v.valueNum } : {}),
        ...(v.valueBool !== undefined ? { valueBool: v.valueBool } : {}),
      });
      any = true;
    }
    if (any) accepted++;
  }
  return { observations, rejects: Array.from(rejects.values()), accepted };
}
