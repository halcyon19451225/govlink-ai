#!/usr/bin/env node
/**
 * 汎用性の検査 — check:generic
 *
 * Coe は特定の行政分野の SaaS ではない。どの分野の計画でも使えることを、
 * **構造で守る**ための検査。人の注意ではなく機械で止める。
 *
 * 守る規律:
 *   ① コア（分野に依存しない層）のソースに、特定分野の語彙を書かない。
 *      分野固有の語彙は `lib/dataset/domains/` の分野パックか、自治体ごとのテナント拡張だけ。
 *   ② 分野パックの属性には必ず planTypes が付き、コアの属性には付かない。
 *   ③ 計画種別の既定値が特定の分野になっていない。
 *   ④ 画面・API がコード上の分野辞書を直接 import しない（DB から解決する）。
 *   ⑤ 分野パックが2つ以上ある（枠組みが1分野に寄っていないことの実証）。
 *
 * 対象外（警告だけ出す）:
 *   D1〜D2 以前からある画面・メニューには分野の語彙が残っている。順次直すため、
 *   ここでは数えて表示するだけにして、新しい層の規律を先に固める。
 *
 * 使い方:
 *   node scripts/check-generic.mjs
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

/**
 * 分野を示す語。**コアに出てはいけない。**
 * 「例:」の中でも書かない（例が分野に寄ると、そこから設計が寄る）。
 */
const DOMAIN_WORDS = [
  // 介護・高齢
  "介護", "要支援", "要介護", "被保険者", "保険者", "認知症", "高齢者", "日常生活圏域", "給付費", "保険料段階",
  // 子ども・子育て
  "保育", "児童", "待機児童", "子育て", "支給認定",
  // 保健・医療
  "健診", "レセプト", "特定健診", "国保", "後期高齢",
  // 福祉その他
  "生活保護", "障害福祉", "受給者証",
];

/** コア（分野に依存してはいけない層）。D3 以降で層が増えたらここに足す */
const CORE_PATHS = [
  "lib/dataset/types.ts",
  "lib/dataset/keyTypes.ts",
  "lib/dataset/sid.ts",
  "lib/dataset/guard.ts",
  "lib/dataset/dictionary.ts",
  "lib/dataset/generalize.ts",
  "lib/dataset/anonymity.ts",
  "lib/dataset/observations.ts",
  "lib/dataset/aggregateSchema.ts",
  "lib/dataset/csv.ts",
  "lib/dataset/service.ts",
  "lib/dataset/http.ts",
  "lib/dataset/index.ts",
  "app/api/admin/projects/[id]/datasets",
  "app/(admin)/projects/[id]/datasets",
  // D3: 指標管理。指標は分野を問わない仕組みなので、ここも分野の語彙を持たない
  "lib/indicator/service.ts",
  "lib/activity.ts",
  // D4: 指標エンジンと画面
  "lib/indicator/spec.ts",
  "lib/indicator/engine.ts",
  "lib/indicator/http.ts",
  "app/api/admin/projects/[id]/indicators",
  "app/(admin)/projects/[id]/indicators",
];

function filesUnder(rel) {
  const abs = join(SRC, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
  };
  walk(abs);
  return out;
}

// ── 1. コアに分野の語彙が無いこと ───────────────────
console.log("1. コアに分野の語彙が無いこと");
const coreFiles = CORE_PATHS.flatMap(filesUnder);
check("コアの対象ファイルが見つかる", coreFiles.length >= 22, `見つかったのは ${coreFiles.length} 件`);
let leaks = 0;
for (const f of coreFiles) {
  const src = read(f);
  const found = DOMAIN_WORDS.filter((w) => src.includes(w));
  if (found.length) {
    leaks++;
    console.error(`  ✗ ${relative(APP_ROOT, f)}: 分野の語彙 ${found.join("・")}`);
  }
}
check("コアのどのファイルにも分野の語彙が無い", leaks === 0, `${leaks} ファイルに混入`);

// ── 2. 分野パックの置き場と印 ───────────────────────
console.log("2. 分野パック");
const domainDir = join(SRC, "lib", "dataset", "domains");
check("分野パックの置き場がある", existsSync(domainDir));
const domainFiles = readdirSync(domainDir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
check("分野パックが2つ以上ある（枠組みが1分野に寄っていないことの実証）", domainFiles.length >= 2,
  `いまは ${domainFiles.join(", ")}`);
for (const f of domainFiles) {
  const src = read(join(domainDir, f));
  check(`${f}: PLAN_TYPE を export している`, /export const PLAN_TYPE = "/.test(src));
  check(`${f}: すべての属性に planTypes: [PLAN_TYPE] が付いている`,
    (src.match(/planTypes: \[PLAN_TYPE\]/g) ?? []).length === (src.match(/^\s{4}key: "/gm) ?? []).length);
}
const registry = read(join(domainDir, "index.ts"));
for (const f of domainFiles) {
  check(`${f} が登録簿に載っている`, registry.includes(f.replace(/\.ts$/, "")));
}
check("登録簿に分野の足し方が書いてある", /分野を足すとき/.test(registry));

// ── 3. 計画種別の既定が分野中立 ─────────────────────
console.log("3. 計画種別の既定");
const migDir = join(REPO_ROOT, "infra", "migrations");
const allMig = readdirSync(migDir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
let lastDefault = null;
for (const f of allMig) {
  const src = read(join(migDir, f));
  for (const mm of src.matchAll(/plan_type\s+TEXT\s+DEFAULT\s+'([a-z_]+)'|ALTER COLUMN plan_type SET DEFAULT '([a-z_]+)'/g)) {
    lastDefault = mm[1] ?? mm[2];
  }
}
check("計画種別の既定が特定の分野になっていない", lastDefault === "custom", `いまの既定は ${lastDefault}`);

// ── 4. 画面・API が分野辞書を直接持たない ───────────
console.log("4. 画面・API");
const screenFiles = [...filesUnder("app/api/admin/projects/[id]/datasets"), ...filesUnder("app/(admin)/projects/[id]/datasets")];
let importsPack = 0;
for (const f of screenFiles) {
  const src = read(f);
  if (/from "@\/lib\/dataset\/domains\/[a-z-]+"/.test(src)) {
    importsPack++;
    console.error(`  ✗ ${relative(APP_ROOT, f)}: 分野パックを直接 import している`);
  }
  if (/CORE_DICTIONARY/.test(src)) {
    importsPack++;
    console.error(`  ✗ ${relative(APP_ROOT, f)}: コア辞書の定数を直接使っている（DB から解決すること）`);
  }
}
check("画面・API は分野パックやコア辞書の定数を直接使わない", importsPack === 0);
check("辞書は DB から解決する経路がある",
  /export async function resolveDictionary/.test(read(join(SRC, "lib", "dataset", "service.ts"))));
check("分野パックが無い計画でも使えることを画面に書いてある",
  /分野が設定されていない/.test(read(join(SRC, "app", "(admin)", "projects", "[id]", "datasets", "DatasetsClient.tsx"))));

// ── 5. 参考: 既存の層に残っている分野の語彙（警告のみ） ──
console.log("5. 参考（警告のみ）");
const legacyTargets = ["components", "lib/manual/topics.ts"];
const counts = new Map();
for (const t of legacyTargets) {
  for (const f of filesUnder(t)) {
    const src = read(f);
    const found = DOMAIN_WORDS.filter((w) => src.includes(w));
    if (found.length) counts.set(relative(APP_ROOT, f), found);
  }
}
if (counts.size > 0) {
  console.log(`  ⚠ 分野の語彙が残っている既存ファイル: ${counts.size} 件（順次直す。ここでは落とさない）`);
  for (const [f, w] of Array.from(counts).slice(0, 8)) console.log(`      ${f}: ${w.join("・")}`);
} else {
  console.log("  既存の層にも分野の語彙は見当たらない");
}

console.log(`\ncheck:generic — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
