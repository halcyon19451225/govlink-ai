#!/usr/bin/env node
/**
 * ロジックモデル要素の正規化テスト（L2）
 *
 * この検査を作った理由:
 *   DBには歴史的に3つの形が混在している。
 *     (a) ["文字列"]                     … 当初からの形
 *     (b) [{ term: "short", text }]      … AI生成が outcomes 列に入れていた形
 *     (c) [{ id, text, kpi_ids }]        … L2以降の形
 *   読む側が形ごとに独自の処理を書いていたため、
 *   ある画面では "[object Object]" と表示され、別の画面では層がずれていた。
 *   normalizeElements を唯一の入口にしたので、その挙動を固定する。
 *
 * 使い方:
 *   node scripts/check-logicmodel-elements.mjs
 *
 * 実装は TypeScript なので、tsx/ts-node に依存せず esbuild でその場で変換して読む。
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const SRC = join(APP_ROOT, "src", "lib", "logicmodel", "elements.ts");

// ── TS → JS（型注釈を落とすだけ。実行するのは同じロジック）──────
const work = mkdtempSync(join(tmpdir(), "lmel-"));
const outFile = join(work, "elements.mjs");
try {
  execFileSync(
    "npx",
    ["--no-install", "esbuild", SRC, "--format=esm", "--target=es2020", `--outfile=${outFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
} catch (e) {
  console.error("esbuild での変換に失敗しました。next が入っていれば同梱されています。");
  console.error(String(e.stderr ?? e));
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}

const M = await import(pathToFileURL(outFile).href);
rmSync(work, { recursive: true, force: true });

// ── テスト ────────────────────────────────────────────────
let failed = 0;
let passed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}\n    期待: ${b}\n    実際: ${a}`);
  }
}

const texts = (v, p) => M.normalizeElements(v, p).map((e) => e.text);
const ids = (v, p) => M.normalizeElements(v, p).map((e) => e.id);

// (a) 文字列配列
check("文字列配列を読める", texts(["職員5名", "予算1000万円"], "inputs"), ["職員5名", "予算1000万円"]);
check("id が無ければ列名+連番を割り当てる", ids(["A", "B"], "inputs"), ["inputs_0", "inputs_1"]);

// (b) {term, text}
check(
  "{term,text} を [object Object] にしない",
  texts([{ term: "short", text: "認知度が上がる" }], "initial_outcomes"),
  ["認知度が上がる"],
);

// (c) 要素形式
check(
  "既存の id と kpi_ids を保持する",
  M.normalizeElements([{ id: "keep", text: "既存", kpi_ids: ["k1"] }], "inputs"),
  [{ id: "keep", text: "既存", kpi_ids: ["k1"] }],
);

// 汚れたデータ
check("空文字を落とす", texts(["有効", "", "   ", null], "inputs"), ["有効"]);
check("null を空配列にする", M.normalizeElements(null, "inputs"), []);
check("配列でない値も壊れない", M.normalizeElements(42, "inputs"), []);
check("{items:[...]} を開く", texts({ items: ["A"] }, "inputs"), ["A"]);
check(
  "JSONB が文字列で来ても読める",
  texts('[{"id":"x","text":"文字列で来たJSON"}]', "inputs"),
  ["文字列で来たJSON"],
);
check("id の重複を退避させる", ids([{ id: "d", text: "1" }, { id: "d", text: "2" }], "inputs"), [
  "d",
  "d_1",
]);

// 決定性: 同じ入力なら同じ id（再描画で線の宛先が動かない）
check(
  "同じ入力なら同じ id になる",
  ids(["A", "B"], "inputs"),
  ids(["A", "B"], "inputs"),
);

// ラウンドトリップ: 正規化 → 保存形 → 再正規化で内容が変わらない
{
  const first = M.serializeElements(M.normalizeElements(["A", "B"], "inputs"));
  const second = M.serializeElements(M.normalizeElements(first, "inputs"));
  check("正規化→保存→再正規化で変わらない", second, first);
}

// 三層の振り分け（旧 outcomes からの救済）
{
  const cols = M.normalizeColumns({
    inputs: ["予算"],
    activities: [],
    outputs: [],
    initial_outcomes: [],
    intermediate_outcomes: [],
    long_outcomes: [],
    outcomes: [
      { term: "short", text: "短期のもの" },
      { term: "intermediate", text: "中間のもの" },
      { term: "long", text: "長期のもの" },
    ],
  });
  check("旧outcomes を term で三層に振り分ける", [
    cols.initial_outcomes.map((e) => e.text),
    cols.intermediate_outcomes.map((e) => e.text),
    cols.long_outcomes.map((e) => e.text),
  ], [["短期のもの"], ["中間のもの"], ["長期のもの"]]);
}

{
  // 専用列に値がある行は、旧 outcomes で上書きされてはならない
  const cols = M.normalizeColumns({
    initial_outcomes: ["人が手で直した短期"],
    intermediate_outcomes: [],
    long_outcomes: [],
    outcomes: [{ term: "short", text: "AIが入れた古い短期" }],
  });
  check(
    "専用列の値を旧outcomes で上書きしない",
    cols.initial_outcomes.map((e) => e.text),
    ["人が手で直した短期"],
  );
}

{
  // term を持たない旧データは中間に置く（従来の表示と同じ）
  const cols = M.normalizeColumns({ outcomes: ["層の分からない成果"] });
  check(
    "term 無しの旧outcomes は中間に置く",
    cols.intermediate_outcomes.map((e) => e.text),
    ["層の分からない成果"],
  );
}

// エッジ
check("自己ループと欠損を落とす", M.normalizeEdges([
  { from: "a", to: "b" },
  { from: "a", to: "a" },
  { from: "", to: "b" },
  { to: "c" },
  "ゴミ",
]), [{ from: "a", to: "b" }]);

// 列の定義と評価側の階層の対応
check("列は6つ", M.LOGIC_COLUMN_KEYS.length, 6);
check("長期列が評価側の outcome_long に対応する", M.COLUMN_TO_INDICATOR_TYPE.long_outcomes, "outcome_long");
check(
  "中間列が評価側の outcome_intermediate に対応する",
  M.COLUMN_TO_INDICATOR_TYPE.intermediate_outcomes,
  "outcome_intermediate",
);

console.log(`\n結果: 成功 ${passed} 件 / 失敗 ${failed} 件`);
if (failed > 0) {
  console.error("\nロジックモデル要素の正規化が期待と異なります。");
  process.exit(1);
}
