#!/usr/bin/env node
/**
 * 指標の一元化の検査 — check:indicator
 *
 * 設計: claude/coe-dataset-model.md §9-1・§9-4・§10-5（D3）
 *
 * 069 で `kpis` は `indicators` に吸収され、目標は `indicator_targets`、値は
 * `indicator_values` に分かれた。`kpis` は**読み取り専用の互換ビュー**として残っている。
 *
 * 守る規律:
 *   ① どこにも `kpis` への書き込み（INSERT / UPDATE / DELETE）が無い。
 *      ビューなので実行時にも必ず失敗するが、**コミット前に止める**のがこの検査の役目。
 *   ② 指標の作成・目標・値は、サービス層（lib/indicator/service.ts）だけが SQL を書く。
 *      API ルートや lib の他の層が indicators / indicator_targets / indicator_values を
 *      直接 INSERT・UPDATE しない（AI と人で経路が割れないようにするため）。
 *   ③ サービス層の書き込み関数は、すべて activity_log に1行残す（logActivity を呼ぶ）。
 *   ④ トランザクションの中から呼ぶ入口（*Tx）があり、呼び出し側がそれを使っている。
 *   ⑤ マイグレーション 069 が、改名・3表・互換ビューの要点を備えている。
 *
 * 使い方:
 *   node scripts/check-indicator.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const SRC = join(APP_ROOT, "src");
const SERVICE = join(SRC, "lib", "indicator", "service.ts");

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

// ── 1. kpis への書き込みが残っていない ────────────────
console.log("1. 互換ビューへの書き込み");
const WRITE_RE = /(INSERT\s+INTO\s+kpis\b|UPDATE\s+kpis\s+SET|DELETE\s+FROM\s+kpis\b)/i;
const writers = sources.filter((f) => WRITE_RE.test(read(f)));
for (const f of writers) console.error(`  ✗ ${relative(APP_ROOT, f)}: kpis へ書き込んでいる`);
check("kpis へ書き込むコードが無い", writers.length === 0, `${writers.length} ファイル`);

// ── 2. 指標の SQL はサービス層だけ ────────────────────
console.log("2. 書き込みの入口がサービス層だけ");
check("lib/indicator/service.ts がある", existsSync(SERVICE));
const TABLE_WRITE_RE =
  /(INSERT\s+INTO\s+(indicators|indicator_targets|indicator_values)\b|UPDATE\s+(indicators|indicator_targets|indicator_values)\s+SET)/i;
const offenders = sources
  .filter((f) => f !== SERVICE)
  .filter((f) => TABLE_WRITE_RE.test(read(f)));
// 例外: 次期計画の複製は information_schema で全列を運ぶ仕組みで、
// 「列が増えても複製漏れが起きない」という別の規律（check:clone）が守っている。
// ここだけは indicators を直接 INSERT する（設計 §9-1 注記）。
const CLONE = join(SRC, "lib", "plan", "clone.ts");
const unexpected = offenders.filter((f) => f !== CLONE);
for (const f of unexpected) console.error(`  ✗ ${relative(APP_ROOT, f)}: 指標の表へ直接書き込んでいる`);
check("サービス層（と複製）以外から指標の表へ書き込まない", unexpected.length === 0, `${unexpected.length} ファイル`);
check("複製は指標の表を直接運ぶ（information_schema 方式）", offenders.includes(CLONE));

// ── 3. 書き込みは必ず履歴を残す ───────────────────────
console.log("3. 操作履歴");
const svc = read(SERVICE);
for (const fn of ["createIndicatorTx", "updateIndicatorTx", "deleteIndicator", "writeTarget", "recordValueTx"]) {
  const at = svc.indexOf(`function ${fn}`);
  const body = at < 0 ? "" : svc.slice(at, svc.indexOf("\nexport ", at + 10) + 1 || undefined);
  check(`${fn} が activity_log に残す`, at >= 0 && body.includes("logActivity"));
}
check("actor は呼び出し側から受け取る（AI 専用の近道を作らない）", /actor: Actor/.test(svc));
check("AI の経路（dialogue）でも同じ関数を通る", read(join(SRC, "lib", "activity.ts")).includes('"dialogue"'));

// ── 4. トランザクションの中から呼べる ─────────────────
console.log("4. トランザクション");
for (const fn of ["createIndicatorTx", "updateIndicatorTx", "setTargetTx", "recordValueTx"]) {
  check(`${fn} が公開されている`, new RegExp(`export async function ${fn}\\b`).test(svc));
}
check("*Tx は client を受け取り、無ければ自分で張る（inTx）", /function inTx\b/.test(svc));
// 既存のトランザクションの中で作るところは *Tx を使う（別コネクションを取らない）
for (const rel of [
  "app/api/admin/projects/route.ts",
  "app/api/admin/projects/[id]/measure-dialogue/[dialogueId]/commit/route.ts",
  "app/api/admin/posts/route.ts",
]) {
  const src = read(join(SRC, rel));
  check(`${rel} が *Tx を使う`, /createIndicatorTx|recordValueTx|setTargetTx/.test(src));
}

// ── 5. 同じ as_of を上書きしない ─────────────────────
console.log("5. 値の履歴");
check(
  "値は積むだけ（indicator_values を UPDATE しない）",
  !/UPDATE\s+indicator_values/i.test(svc),
);
check("値には必ず基準日（as_of）が要る", /asOf/.test(svc) && /YYYY-MM-DD/.test(svc));
check("経路（via）と操作者を値に記録する", /actor\.via/.test(svc));

// ── 6. マイグレーション 069 ───────────────────────────
console.log("6. マイグレーション 069");
const mig = read(join(REPO_ROOT, "infra", "migrations", "069_indicators.sql"));
check("069 がある", mig.length > 0);
check("改名で外部キーを保つ（新表に移さない）", /ALTER TABLE kpis RENAME TO indicators/.test(mig));
check("indicator_targets を作る", /CREATE TABLE IF NOT EXISTS indicator_targets/.test(mig));
check("indicator_values を作る", /CREATE TABLE IF NOT EXISTS indicator_values/.test(mig));
check("互換ビュー kpis を置く", /CREATE OR REPLACE VIEW kpis AS/.test(mig));
check("互換ビューは計画の指標だけを返す", /WHERE i\.origin = 'plan'/.test(mig));
check("旧列（target/current）を落とす", /DROP COLUMN IF EXISTS current/.test(mig));
check("再実行できる（存在チェック付き）", /IF NOT EXISTS|to_regclass/.test(mig));

// ── まとめ ───────────────────────────────────────────
console.log(`\ncheck:indicator — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
