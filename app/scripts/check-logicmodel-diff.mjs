#!/usr/bin/env node
/**
 * 版の差分計算のテスト（L4）
 *
 * この検査を作った理由:
 *   034 で改訂を「新しい版の追加」に変えたため、版が積まれるようになった。
 *   過去の評価は自分が使った版を指したままになるので、
 *   「その版と現行版が何が違うのか」を正しく出せないと、
 *   評価の前提を説明できない。差分が嘘をつくと、版を残す意味が消える。
 *
 *   特に、要素IDで突き合わせること（L2の成果）が効いているかを固定する。
 *   文言を直しただけの要素が「削除＋追加」に見えてはいけない。
 *
 * 使い方:
 *   node scripts/check-logicmodel-diff.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

const work = mkdtempSync(join(tmpdir(), "lmdiff-"));
const outFile = join(work, "diff.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "logicmodel", "diff.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
} catch (e) {
  console.error("esbuild での変換に失敗しました。");
  console.error(String(e.stderr ?? e));
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}

const { diffModel } = await import(pathToFileURL(outFile).href);
rmSync(work, { recursive: true, force: true });

let failed = 0;
let passed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}${extra ? `\n    ${extra}` : ""}`);
  }
}

const el = (id, text, kpi_ids = []) => ({ id, text, kpi_ids });
const cols = (o = {}) => ({
  inputs: [],
  activities: [],
  outputs: [],
  initial_outcomes: [],
  intermediate_outcomes: [],
  long_outcomes: [],
  ...o,
});
const colOf = (d, key) => d.columns.find((c) => c.key === key);
const statuses = (d, key) => colOf(d, key).elements.map((e) => e.status);

// ── 変更なし ─────────────────────────────────────────────
{
  const a = cols({ activities: [el("e1", "教室の開催")] });
  const d = diffModel(a, a);
  check("同じ内容なら差分なし", !d.hasChanges);
  check("変更なしと表示する", d.summary.includes("違いはありません"));
}

// ── 文言の変更（IDで突き合わせる）────────────────────────
{
  const before = cols({ activities: [el("e1", "教室の開催")] });
  const after = cols({ activities: [el("e1", "介護予防教室の開催")] });
  const d = diffModel(before, after);
  check("文言を直しただけなら変更として出す", statuses(d, "activities").join() === "changed");
  const e = colOf(d, "activities").elements[0];
  check("変更の内訳が文言だけと判る", e.textChanged === true && e.kpiChanged === false);
  check(
    "削除+追加には見えない",
    colOf(d, "activities").removed === 0 && colOf(d, "activities").added === 0,
  );
}

// ── KPI割当の変更 ────────────────────────────────────────
{
  const before = cols({ initial_outcomes: [el("e1", "認知度が上がる", [])] });
  const after = cols({ initial_outcomes: [el("e1", "認知度が上がる", ["k1"])] });
  const d = diffModel(before, after);
  const e = colOf(d, "initial_outcomes").elements[0];
  check("KPI割当だけの変更も検出する", e.status === "changed" && e.kpiChanged === true);
  check("文言は変わっていないと判る", e.textChanged === false);
}
{
  // 順序だけ違うKPI配列は変更とみなさない
  const before = cols({ initial_outcomes: [el("e1", "成果", ["k1", "k2"])] });
  const after = cols({ initial_outcomes: [el("e1", "成果", ["k2", "k1"])] });
  const d = diffModel(before, after);
  check("KPIの並び順違いは変更としない", !d.hasChanges);
}

// ── 追加・削除 ───────────────────────────────────────────
{
  const before = cols({ activities: [el("e1", "A")] });
  const after = cols({ activities: [el("e1", "A"), el("e2", "B")] });
  const d = diffModel(before, after);
  check("追加を検出する", colOf(d, "activities").added === 1);
}
{
  const before = cols({ activities: [el("e1", "A"), el("e2", "B")] });
  const after = cols({ activities: [el("e1", "A")] });
  const d = diffModel(before, after);
  check("削除を検出する", colOf(d, "activities").removed === 1);
  check("削除された要素の中身を持っている", colOf(d, "activities").elements.some((e) => e.status === "removed" && e.before?.text === "B"));
}

// ── 並べ替え ─────────────────────────────────────────────
{
  const before = cols({ activities: [el("e1", "A"), el("e2", "B")] });
  const after = cols({ activities: [el("e2", "B"), el("e1", "A")] });
  const d = diffModel(before, after);
  check("並べ替えを変更と区別する", colOf(d, "activities").moved === 2);
  check("並べ替えでは追加も削除も出ない", colOf(d, "activities").added === 0 && colOf(d, "activities").removed === 0);
  const e = colOf(d, "activities").elements.find((x) => x.after?.id === "e1");
  check("移動元と移動先の位置を持つ", e.fromIndex === 0 && e.toIndex === 1);
}

// ── 035 より前の版（idが無い）の救済 ─────────────────────
{
  // 旧版は id が "inputs_0" のような仮id、新版は採番済みUUID。
  // 文言が一致するので同じ要素とみなせるはず。
  const before = cols({ inputs: [el("inputs_0", "予算1000万円")] });
  const after = cols({ inputs: [el("uuid-aaa", "予算1000万円")] });
  const d = diffModel(before, after);
  check("idが変わっても文言一致で同じ要素とみなす", !d.hasChanges);
}
{
  // 文言もidも違えば、別物として追加＋削除
  const before = cols({ inputs: [el("x", "旧")] });
  const after = cols({ inputs: [el("y", "新")] });
  const d = diffModel(before, after);
  check("別物なら追加と削除になる", colOf(d, "inputs").added === 1 && colOf(d, "inputs").removed === 1);
}
{
  // 同じ文言が2つある場合、1つを消しても救済で誤って結び付かないこと
  const before = cols({ inputs: [el("a", "同じ文言"), el("b", "同じ文言")] });
  const after = cols({ inputs: [el("a", "同じ文言")] });
  const d = diffModel(before, after);
  check("重複文言でも過不足なく数える", colOf(d, "inputs").removed === 1 && colOf(d, "inputs").added === 0);
}

// ── 因果エッジ ───────────────────────────────────────────
{
  const c = cols({ activities: [el("a", "A")], outputs: [el("b", "B")] });
  const d = diffModel(c, c, [], [{ from: "a", to: "b" }]);
  check("因果の追加を検出する", d.edges.added.length === 1 && d.edges.removed.length === 0);
  check("因果だけの変更でも差分ありとする", d.hasChanges);
}
{
  const c = cols({ activities: [el("a", "A")], outputs: [el("b", "B")] });
  const d = diffModel(c, c, [{ from: "a", to: "b" }], []);
  check("因果の削除を検出する", d.edges.removed.length === 1);
}
{
  const c = cols();
  const e = [{ from: "a", to: "b" }];
  const d = diffModel(c, c, e, [{ from: "a", to: "b", note: "メモ" }]);
  check("noteの違いは因果の増減にしない", d.edges.added.length === 0 && d.edges.removed.length === 0);
}

// ── 要約 ─────────────────────────────────────────────────
{
  const before = cols({ activities: [el("e1", "A"), el("e2", "消える")] });
  const after = cols({ activities: [el("e1", "A改"), el("e3", "増える")] });
  const d = diffModel(before, after);
  check("要約に追加・削除・変更が出る", /追加 1/.test(d.summary) && /削除 1/.test(d.summary) && /変更 1/.test(d.summary), d.summary);
}

// ── 6列すべてを返す ──────────────────────────────────────
{
  const d = diffModel(cols(), cols());
  check("列は常に6つ返る", d.columns.length === 6);
}

console.log(`\n結果: 成功 ${passed} 件 / 失敗 ${failed} 件`);
if (failed > 0) {
  console.error("\n版の差分計算が期待と異なります。");
  process.exit(1);
}
