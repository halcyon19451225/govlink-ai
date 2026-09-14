#!/usr/bin/env node
/**
 * 操作履歴の検査 — check:audit
 *
 * 設計: claude/coe-dataset-model.md §10-5
 *
 * halcy さんの要求:
 *   「AI が操作した場合も、人が画面から操作した場合と同じように履歴が残るようにしてください
 *     （AI が操作しても人間が操作しても結果は同じ状態になるようにする）」
 *
 * これを守るには、**AI 専用の書き込み経路を作らない**ことが要る。守る規律:
 *   ① actor は呼び出し側が渡す。AI 自身を actor にしない（actor はその対話の担当者）。
 *      `actorFromSession` は via を差し替えるだけで、userRoleId はセッションのまま。
 *   ② AI の確定処理（対話のコミット）が、画面と同じサービス関数を呼んでいる。
 *   ③ 経路（via）の語彙が1か所（lib/activity.ts）にあり、
 *      「AI だから記録しない」分岐がどこにも無い。
 *   ④ activity_log の表が、誰が・どの経路で・何を・いつ を持っている。
 *
 * 使い方:
 *   node scripts/check-audit.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const SRC = join(APP_ROOT, "src");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (detail) console.error(`      ${detail}`);
  }
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// ── 1. 履歴の語彙が1か所にある ────────────────────────
console.log("1. 履歴の語彙");
const activity = read(join(SRC, "lib", "activity.ts"));
check("lib/activity.ts がある", activity.length > 0);
for (const via of ["ui", "bulk", "gap_analysis", "dialogue", "evaluation", "auto_tasks", "migration"]) {
  check(`経路 '${via}' が定義されている`, activity.includes(`"${via}"`));
}
check("actor は user_roles を指す（AI 自身ではない）", /userRoleId/.test(activity));
check("AI の操作でも actor は担当者だと明記されている", /AI/.test(activity) && /担当者/.test(activity));
check("logActivity はトランザクションの中でも書ける", /if \(client\) await client\.query/.test(activity));

// ── 2. AI の確定処理が画面と同じ関数を通る ────────────
console.log("2. AI の経路");
const AI_COMMITS = [
  "app/api/admin/projects/[id]/measure-dialogue/[dialogueId]/commit/route.ts",
];
for (const rel of AI_COMMITS) {
  const src = read(join(SRC, rel));
  check(`${rel} がある`, src.length > 0);
  check(
    `${rel} がサービス層を通る（生の INSERT を書かない）`,
    /createIndicatorTx|recordValueTx|setTargetTx/.test(src),
  );
  check(`${rel} が via='dialogue' で記録する`, /"dialogue"/.test(src));
  check(
    `${rel} の actor はセッションの担当者`,
    /actorFromSession\(session/.test(src),
  );
}

// ── 3. 「AI だから記録しない」分岐が無い ──────────────
console.log("3. 抜け道");
function allSources(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".next") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}
const sources = allSources(SRC);
// AI を actor に据えるような書き方（履歴の責任者が消える）
const BAD_ACTOR = /(userRoleId|actor)\s*[:=]\s*["'](ai|claude|system|bot)["']/i;
const badActors = sources.filter((f) => BAD_ACTOR.test(read(f)));
for (const f of badActors) console.error(`  ✗ ${relative(APP_ROOT, f)}: AI を actor にしている`);
check("AI を actor にしているところが無い", badActors.length === 0);
// via の条件分岐で記録を飛ばす書き方
const SKIP = /if\s*\([^)]*via\s*[!=]==?\s*["']dialogue["'][^)]*\)\s*(return|\{\s*\})/;
const skippers = sources.filter((f) => SKIP.test(read(f)));
for (const f of skippers) console.error(`  ✗ ${relative(APP_ROOT, f)}: 経路で記録を飛ばしている`);
check("経路によって記録を飛ばすところが無い", skippers.length === 0);

// ── 4. 表の形 ─────────────────────────────────────────
console.log("4. activity_log の表");
const migDir = join(REPO_ROOT, "infra", "migrations");
const migs = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(join(migDir, f)))
  .join("\n");
check("activity_log を作るマイグレーションがある", /CREATE TABLE IF NOT EXISTS activity_log/.test(migs));
for (const col of ["actor", "via", "entity", "entity_id", "action", "summary", "at"]) {
  check(`activity_log に ${col} がある`, new RegExp(`\\b${col}\\b`).test(migs));
}
check("値の履歴にも経路が残る", /via\s+TEXT/.test(migs));

console.log(`\ncheck:audit — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
