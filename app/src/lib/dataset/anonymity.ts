/**
 * k-匿名性・ℓ-多様性の検定と強制 — 設計: claude/coe-dataset-model.md §5-1・§7 ルール9
 *
 * - 準識別子（quasi_identifier）の全組合せについて、同一セルの行数が k 以上になるまで
 *   はしごを1段ずつ上げる（priority の小さい属性から）。それでも満たさない行は**行ごと抑制**
 * - 機微属性（sensitive）は、各セルで2値以上（ℓ）になることを検定し、満たさないセルは
 *   その機微属性を削除（'*'）する
 * - 抑制件数は必ず返す（画面に出す。隠さない）
 *
 * 決定的で、単体テストでき、監査で説明できることを優先している。
 * 同じ純関数を庁内ツール（出口）と Coe（入口の再検定）で共有する。
 */
import type { AttributeDefinition, WideRow } from "./types";
import { generalizeCode, maxLevel } from "./generalize";

export interface AnonymityOptions {
  k: number;
  l: number;
}

export interface AnonymityResult {
  rows: WideRow[];
  /** 抑制した行数 */
  suppressed: number;
  /** 機微属性を落としたセル数（属性ごと） */
  sensitiveDropped: Record<string, number>;
  /** 適用した段（属性ごと） */
  levels: Record<string, number>;
  /** 実測の最小セルサイズ（抑制後） */
  kObserved: number;
  ok: boolean;
}

function cellKey(row: WideRow, qi: AttributeDefinition[], levels: Record<string, number>): string {
  return qi
    .map((d) => {
      const raw = row.values[d.key];
      if (raw === undefined) return "";
      const v = generalizeCode(d, String(raw), levels[d.key] ?? 0);
      return v ?? "?";
    })
    .join("\u001f");
}

function groupBy(rows: WideRow[], qi: AttributeDefinition[], levels: Record<string, number>) {
  const groups = new Map<string, WideRow[]>();
  for (const r of rows) {
    const key = cellKey(r, qi, levels);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  return groups;
}

/**
 * k-匿名性を強制する。
 * @param rows  横持ち（値は辞書コード。粗化前）
 * @param dict  辞書（対象の属性を含む）
 */
export function enforceAnonymity(
  rows: WideRow[],
  dict: readonly AttributeDefinition[],
  opts: AnonymityOptions,
): AnonymityResult {
  const present = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.values)) present.add(k);
  const qi = dict
    .filter((d) => d.role === "quasi_identifier" && present.has(d.key))
    .sort((a, b) => (a.generalization?.priority ?? 0) - (b.generalization?.priority ?? 0) || a.key.localeCompare(b.key));
  const sensitive = dict.filter((d) => d.role === "sensitive" && present.has(d.key));

  const levels: Record<string, number> = {};
  for (const d of qi) levels[d.key] = 0;

  // ① はしごを上げる。priority 順に1段ずつ、全属性が上限に達するまで
  let groups = groupBy(rows, qi, levels);
  const minSize = () => Math.min(...Array.from(groups.values()).map((g) => g.length), Infinity);
  let guard = 0;
  while (qi.length > 0 && minSize() < opts.k && guard++ < 100) {
    const cand = qi.find((d) => (levels[d.key] ?? 0) < maxLevel(d));
    if (!cand) break;
    levels[cand.key] = (levels[cand.key] ?? 0) + 1;
    groups = groupBy(rows, qi, levels);
  }

  // ② それでも小さいセルは行ごと抑制
  const kept: WideRow[] = [];
  let suppressed = 0;
  for (const g of Array.from(groups.values())) {
    if (g.length >= opts.k) kept.push(...g);
    else suppressed += g.length;
  }

  // ③ 粗化を値に反映し、機微属性の ℓ 検定
  const sensitiveDropped: Record<string, number> = {};
  const finalGroups = groupBy(kept, qi, levels);
  const out: WideRow[] = [];
  for (const g of Array.from(finalGroups.values())) {
    const dropSens = new Set<string>();
    for (const s of sensitive) {
      const distinct = new Set(g.map((r: WideRow) => r.values[s.key]).filter((v: unknown) => v !== undefined));
      if (distinct.size > 0 && distinct.size < opts.l) dropSens.add(s.key);
    }
    for (const r of g) {
      const values: WideRow["values"] = { ...r.values };
      for (const d of qi) {
        const raw = values[d.key];
        if (raw === undefined) continue;
        const v = generalizeCode(d, String(raw), levels[d.key] ?? 0);
        if (v === null) delete values[d.key];
        else values[d.key] = v;
      }
      for (const key of Array.from(dropSens)) {
        if (values[key] !== undefined) {
          values[key] = "*";
          sensitiveDropped[key] = (sensitiveDropped[key] ?? 0) + 1;
        }
      }
      out.push({ sid: r.sid, values });
    }
  }

  const kObserved = out.length === 0 ? 0 : Math.min(...Array.from(finalGroups.values()).map((g) => g.length));
  return {
    rows: out,
    suppressed,
    sensitiveDropped,
    levels,
    kObserved,
    ok: out.length === 0 || kObserved >= opts.k,
  };
}
