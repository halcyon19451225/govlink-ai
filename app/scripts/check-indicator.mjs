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

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

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

// ── 7. 指標エンジンの設定検証（D4・純関数を実際に動かす）──
console.log("7. 設定（spec）の検証");
const work = mkdtempSync(join(tmpdir(), "indicator-"));
try {
  const file = join(work, "spec.mjs");
  execFileSync("npx", ["--no-install", "esbuild", join(SRC, "lib", "indicator", "spec.ts"),
    "--bundle", "--format=esm", "--platform=node", "--target=es2022", `--alias:@=${SRC}`, `--outfile=${file}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT });
  const m = await import(pathToFileURL(file).href);

  const DS = "11111111-1111-4111-8111-111111111111";
  const IND1 = "22222222-2222-4222-8222-222222222222";
  const IND2 = "33333333-3333-4333-8333-333333333333";

  // 4タイプが通ること
  check("集計型の設定が通る", m.validateSpec({ type: "aggregate", datasetId: DS, measure: "件数", method: "sum" }).length === 0);
  check("割合は分母を指定できる", m.validateSpec({ type: "aggregate", datasetId: DS, measure: "a", method: "rate", denominator: "b" }).length === 0);
  check("割合以外で分母を指定したら落ちる", m.validateSpec({ type: "aggregate", datasetId: DS, measure: "a", method: "sum", denominator: "b" }).length > 0);
  check("経年比較型の設定が通る",
    m.validateSpec({ type: "longitudinal", datasetId: DS, attrKey: "x.y", monthsBack: 12, order: ["a", "b"], improvedWhen: "same_or_earlier" }).length === 0);
  check("経年比較: 値の並びが1つだけなら落ちる",
    m.validateSpec({ type: "longitudinal", datasetId: DS, attrKey: "x.y", monthsBack: 12, order: ["a"], improvedWhen: "same_or_earlier" }).length > 0);
  check("経年比較: 並びの重複を弾く",
    m.validateSpec({ type: "longitudinal", datasetId: DS, attrKey: "x.y", monthsBack: 12, order: ["a", "a"], improvedWhen: "same_or_earlier" }).length > 0);
  check("経年比較: 比べる時点の範囲を強制する",
    m.validateSpec({ type: "longitudinal", datasetId: DS, attrKey: "x.y", monthsBack: 0, order: ["a", "b"], improvedWhen: "same_or_earlier" }).length > 0);
  check("クロス集計型の設定が通る",
    m.validateSpec({ type: "cross", datasetId: DS, conditions: [{ key: "x.y", in: ["1"] }], method: "count" }).length === 0);
  check("クロス集計: 条件が無ければ落ちる", m.validateSpec({ type: "cross", datasetId: DS, conditions: [], method: "count" }).length > 0);
  check("未知のタイプは落ちる", m.validateSpec({ type: "regression" }).length > 0);
  check("データセット未指定は落ちる", m.validateSpec({ type: "aggregate", measure: "a", method: "sum" }).length > 0);

  // 個票が要るタイプが宣言されていること（画面の注意書きの根拠）
  check("個票が要るタイプが宣言されている", m.NEEDS_INDIVIDUAL.has("longitudinal") && m.NEEDS_INDIVIDUAL.has("cross") && !m.NEEDS_INDIVIDUAL.has("aggregate"));

  // 計算式の構文限定パーサ
  check("計算式が通る", m.validateSpec({ type: "formula", expression: `{ind:${IND1}} / {ind:${IND2}} * 100` }).length === 0);
  check("計算式: 指標の参照が無い式は落ちる", m.validateSpec({ type: "formula", expression: "1 + 2" }).length > 0);
  check("計算式: 関数呼び出しは書けない", m.validateSpec({ type: "formula", expression: `sum({ind:${IND1}})` }).length > 0);
  check("計算式: 任意のコードは書けない", m.validateSpec({ type: "formula", expression: "process.exit(1)" }).length > 0);
  check("計算式: 閉じていない括弧は落ちる", m.validateSpec({ type: "formula", expression: `({ind:${IND1}} + 1` }).length > 0);
  const parsed = m.parseFormula(`({ind:${IND1}} + 2) / {ind:${IND2}}`);
  check("計算式: 参照している指標を取り出せる", parsed.ok && parsed.refs.length === 2);
  check("計算式: 掛け算・割り算が先に効く",
    m.evalFormula(m.parseFormula(`{ind:${IND1}} + {ind:${IND2}} * 2`).node, new Map([[IND1, 1], [IND2, 3]])) === 7);
  check("計算式: 括弧が効く",
    m.evalFormula(m.parseFormula(`({ind:${IND1}} + {ind:${IND2}}) * 2`).node, new Map([[IND1, 1], [IND2, 3]])) === 8);
  check("計算式: 0 で割ったら値を出さない",
    m.evalFormula(m.parseFormula(`{ind:${IND1}} / {ind:${IND2}}`).node, new Map([[IND1, 1], [IND2, 0]])) === null);
  check("計算式: 値が揃わなければ値を出さない",
    m.evalFormula(m.parseFormula(`{ind:${IND1}} / {ind:${IND2}}`).node, new Map([[IND1, 1]])) === null);
  check("計算式: 参照している指標 ID を spec から取れる",
    m.referencedIndicatorIds({ type: "formula", expression: `{ind:${IND1}} * 2` })[0] === IND1);

  // 不足エラー5種が説明文になること（画面も AI も同じものを読む）
  console.log("8. 不足の案内");
  const reasons = ["no_version_before_as_of", "attr_missing", "column_missing", "too_few_rows", "dependency_missing"];
  for (const reason of reasons) {
    const text = m.describeMissing({ reason, datasetName: "検証データ", neededAsOf: "2026-03-31", attrKey: "x.y", column: "c", indicatorLabel: "指標A" });
    check(`不足「${reason}」が日本語の案内になる`, typeof text === "string" && text.length > 5);
  }
  check("不足の案内に基準日が入る（いつ時点のものを上げるか分かる）",
    m.describeMissing({ reason: "no_version_before_as_of", datasetName: "D", neededAsOf: "2026-03-31", latestAvailableAsOf: "2025-03-31" }).includes("2026-03-31"));
  check("不足の案内に、今あるうち一番新しい時点も入る",
    m.describeMissing({ reason: "no_version_before_as_of", datasetName: "D", neededAsOf: "2026-03-31", latestAvailableAsOf: "2025-03-31" }).includes("2025-03-31"));

  // エンジンの規律（テキスト検査）
  console.log("9. 指標エンジン");
  const eng = read(join(SRC, "lib", "indicator", "engine.ts"));
  check("版は基準日以前で最も新しい有効な版を選ぶ", /status = 'validated' AND as_of <= \$2::date/.test(eng) && /ORDER BY as_of DESC/.test(eng));
  check("使った版を必ず返す（あとから追えるように）", /inputs/.test(eng) && /datasetVersionId/.test(eng));
  check("エンジンは値を履歴に積まない（積むのはサービス層）", !/INSERT INTO indicator_values/.test(eng));
  check("経年比較・クロスは集計データを拒む", /ds\.kind !== "individual"/.test(eng));
  check("人数が少なすぎるときは値を出さない", /MIN_DENOMINATOR/.test(eng) && /too_few_rows/.test(eng));
  check("絞り込みの値はパラメータで渡す（SQL に埋め込まない）", !/\$\{f\.in\}/.test(eng) && /params\.push\(f\.in\)/.test(eng));

  // 画面・API
  console.log("10. 画面と API");
  const listApi = read(join(SRC, "app", "api", "admin", "projects", "[id]", "indicators", "route.ts"));
  const computeApi = read(join(SRC, "app", "api", "admin", "projects", "[id]", "indicators", "[indicatorId]", "compute", "route.ts"));
  const gapApi = read(join(SRC, "app", "api", "admin", "projects", "[id]", "gap-analysis", "indicator-values", "route.ts"));
  const client = read(join(SRC, "app", "(admin)", "projects", "[id]", "indicators", "IndicatorsClient.tsx"));
  check("一覧 API がテナント境界と権限を通る", /requireProjectAccess/.test(listApi) && /requireModulePermission/.test(listApi));
  check("登録 API が設定を検証してから登録する", /validateSpec/.test(listApi));
  check("算出 API は不足を 200 で返す（エラーにしない）", /ok: false/.test(computeApi) && !/status: 400 \}\);\s*\}\s*$/.test(computeApi));
  check("算出 API が不足に説明文を添える", /describeMissing/.test(computeApi));
  check("ギャップ分析が登録指標から現状値を取る", /computeMany/.test(gapApi) && /gap_analysis/.test(gapApi));
  check("ギャップ分析の画面のボタンが「登録指標から」になっている",
    read(join(SRC, "app", "(admin)", "projects", "[id]", "gap-analysis", "GapAnalysisClient.tsx")).includes("登録指標から現状値を取得"));
  check("画面が4つのタイプの説明を持つ", /CALC_HELP/.test(client));
  check("画面が「同じ基準日でも上書きしない」ことを説明する", /上書き|消えません/.test(client));
  check("画面が不足からデータセット管理へ導く", /datasets/.test(client));
  check("メニューに指標管理がある", read(join(SRC, "components", "ProjectSidebar.tsx")).includes('path: "indicators"'));

  // ── D6: 経年比較型・クロス集計型の設定画面 ──────────────
  //   この2つは「どの属性が・どの値のとき」を並べないと設定できない。
  //   **値を手で打たせない。** 綴りが1文字違ってもエラーにならず、黙って 0 件になり、
  //   指標が狂ったまま履歴に積まれる（気づくのは何か月も後）。辞書から選ばせる。
  console.log("11. 経年比較型・クロス集計型の設定（D6）");
  check("値の語彙を辞書から渡している（画面で打たせない）",
    /attributes: AttributeChoice\[\]/.test(client));
  check("辞書は DB から解決する（コード上の定数を読まない）",
    /resolveDictionary\(/.test(read(join(SRC, "app", "(admin)", "projects", "[id]", "indicators", "page.tsx"))));
  check("絞り込み・条件を複数行で編集できる", /function FilterRows/.test(client));
  check("条件は値を選ばせる（自由入力ではない）", /valuesFor\(/.test(client) && /toggleValue/.test(client));
  check("値の語彙が無い属性はその旨を出す", /値の語彙が登録されていません/.test(client));
  check("経年比較型: 値の並びを順序として編集できる", /setOrder\(/.test(client) && /order\.length - 1/.test(client));
  check("経年比較型: 並びが2つ未満なら促す", /2つ以上選んでください/.test(client));
  check("経年比較型: 「維持・改善」の向きを選べる（既定に固定しない）",
    /setImprovedWhen\(/.test(client) && /same_or_later/.test(client));
  check("経年比較型: 向きの意味を具体例で見せる", /へ動いた人/.test(client));
  check("経年比較型: 分母の絞り込みを設定できる", /longFilters/.test(client));
  check("クロス集計型: 条件を複数（AND）にできる",
    /setRows=\{setConditions\}/.test(client) && /すべて満たす人を数えます/.test(client));
  check("クロス集計型: 件数と割合を選べる", /setCrossMethod\(/.test(client));
  check("クロス集計型: 割合のときだけ分母の条件を出す", /crossMethod === "rate"/.test(client));
  check("クロス集計型: 小セル抑制を画面でも伝える", /5人を下回る/.test(client));
  check("設定は spec の検証（validateSpec）にそのまま渡る形で組む",
    /cleanFilters\(/.test(client) && /improvedWhen,/.test(client));
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── まとめ ───────────────────────────────────────────
console.log(`\ncheck:indicator — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
