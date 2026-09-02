#!/usr/bin/env node
/**
 * SQL の書き方の静的検査（横断）
 *
 * この検査を作った理由:
 *   同じ不正SQLで2度事故を起こしたため。
 *   `json_build_object(...) FILTER (WHERE ...)` は **不正**（FILTER は集約関数にしか付かない）。
 *   実行時にしか落ちず、しかも多くの画面が `.catch(() => [])` で握り潰すため、
 *   「エラーは出ないが一覧が常に空」という形で長期間気づかれない。
 *     - 2026-09-01: /api/admin/projects/[id]/logic-model が常時500（メニュー整理で発見）
 *     - 2026-09-02: /api/admin/projects/[id]/evaluations が常時500（CA2-2の実機確認で発見）
 *   正しくは `CASE WHEN x.id IS NULL THEN NULL ELSE json_build_object(...) END`。
 *   `json_agg(...) FILTER (WHERE ...)` は集約なので正当 — こちらは対象外。
 *
 * 使い方: node scripts/check-sql-patterns.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const SRC = join(APP_ROOT, "src");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

/** src 配下の .ts / .tsx を全部読む */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
check("src 配下のソースを読めた", files.length > 0);

// ── ① json_build_object(...) FILTER (WHERE ...) の禁止 ────────────
// 直前の非空白トークンが json_agg( でない FILTER を不正とみなす。
const offenders = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const re = /\)\s*FILTER \(WHERE /g;
  let m;
  while ((m = re.exec(text))) {
    // この ')' に対応する '(' を後ろ向きに探し、関数名を見る
    let depth = 0;
    let name = null;
    for (let i = m.index; i >= 0; i--) {
      const ch = text[i];
      if (ch === ")") depth++;
      else if (ch === "(") {
        depth--;
        if (depth === 0) {
          let j = i - 1;
          while (j >= 0 && /[\w]/.test(text[j])) j--;
          name = text.slice(j + 1, i);
          break;
        }
      }
    }
    if (name === "json_build_object" || name === "jsonb_build_object") {
      const line = text.slice(0, m.index).split("\n").length;
      offenders.push(`${relative(APP_ROOT, f)}:${line}`);
    }
  }
}
check(
  `json_build_object(...) FILTER を使っていない${offenders.length ? `（違反: ${offenders.join(", ")}）` : ""}`,
  offenders.length === 0,
);

// ── ② 直った経路が CASE WHEN で書かれていること（退行防止）────────
const fixedRoutes = [
  ["src/app/api/admin/projects/[id]/logic-model/route.ts", "ih.id"],
  ["src/app/api/admin/projects/[id]/evaluations/route.ts", "lm.id"],
  ["src/app/api/admin/projects/[id]/cost-efficiency/route.ts", "pe.id"],
  ["src/app/api/admin/projects/[id]/self-evaluation/route.ts", "pe.id"],
];
for (const [rel, guard] of fixedRoutes) {
  let text = "";
  try {
    text = readFileSync(join(APP_ROOT, rel), "utf8");
  } catch {
    /* ファイルが無ければ次の check が落ちる */
  }
  check(
    `${rel} は CASE WHEN で NULL 分岐している`,
    new RegExp(`CASE WHEN ${guard.replace(".", "\\.")} IS NULL THEN NULL ELSE`).test(text),
  );
}

// ── ③ json_agg(...) FILTER は正当なので残っていること ──────────────
// （①の検査が広すぎて集約まで潰していないことの確認）
const aggFilterFiles = files.filter((f) => /json_agg\([\s\S]{0,400}?\)\s*FILTER \(WHERE /.test(readFileSync(f, "utf8")));
check("集約への FILTER（json_agg）は温存されている", aggFilterFiles.length > 0);

console.log(`check-sql-patterns: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
