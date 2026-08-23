#!/usr/bin/env node
/**
 * ロジックモデル改訂（版の複製）の検証（L5）
 *
 * この検査を作った理由:
 *   改訂は「現行版を丸ごと複製して新しい版を積む」処理である。
 *   複製漏れがあると **改訂した瞬間に内容の一部が消える** という、
 *   もっとも取り返しのつかない事故になる。
 *   列を手で並べる実装をやめ information_schema から取るようにしたが、
 *   それが本当に全列を運んでいるかを実DBで確かめる。
 *
 * 必要なもの:
 *   使い捨ての PostgreSQL。既定の接続先は検証用インスタンス。
 *   REVISE_TEST_DATABASE_URL で上書きできる。
 *   接続できない場合はスキップする（開発機で毎回DBを要求しないため）。
 *
 *   ※ この検査は実際に版を作る。本番DBを指してはいけない。
 *
 * 使い方:
 *   node scripts/check-logicmodel-revise.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const URL_ = process.env.REVISE_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/revtest";

let pg;
try {
  pg = await import("pg");
} catch {
  console.log("pg が見つからないためスキップします");
  process.exit(0);
}

const pool = new pg.default.Pool({ connectionString: URL_, connectionTimeoutMillis: 3000 });
let client;
try {
  client = await pool.connect();
} catch {
  console.log(`DB (${URL_}) に接続できないためスキップしました`);
  console.log(
    "実行したい場合は、使い捨ての PostgreSQL を立てて logic_models と\n" +
      "improvement_actions を作り、REVISE_TEST_DATABASE_URL を指定してください。\n" +
      "本番DBは指すと版が増えるので絶対に指定しないこと。",
  );
  process.exit(0);
}

// ── revise.ts を読み込む ─────────────────────────────────
const work = mkdtempSync(join(tmpdir(), "lmrev-"));
const outFile = join(work, "revise.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "logicmodel", "revise.ts"),
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
const { reviseLogicModel } = await import(pathToFileURL(outFile).href);
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

const PROJECT = "11111111-1111-1111-1111-111111111111";
const ACTION = "aaaaaaaa-0000-0000-0000-000000000001";

try {
  const before = (
    await client.query("SELECT * FROM logic_models WHERE project_id = $1 AND is_current", [PROJECT])
  ).rows[0];
  if (!before) {
    console.error("検証用データがありません。fixture を投入してください。");
    process.exit(2);
  }

  await client.query("BEGIN");
  const result = await reviseLogicModel(client, {
    projectId: PROJECT,
    reason: "参加勧奨の方法を見直すため",
    improvementActionId: ACTION,
  });
  await client.query("COMMIT");

  check("改訂が作成される", !!result);
  check("版が1つ進む", result.version === before.version + 1, `${before.version} → ${result?.version}`);
  check("派生元を記録する", result.revisedFromId === before.id);

  const after = (
    await client.query("SELECT * FROM logic_models WHERE id = $1", [result.id])
  ).rows[0];

  check("新版が現行版になる", after.is_current === true);
  check("改訂の理由が残る", after.revision_reason === "参加勧奨の方法を見直すため");
  check("どの改善が理由かが残る", after.source_improvement_action_id === ACTION);

  const old = (await client.query("SELECT * FROM logic_models WHERE id = $1", [before.id])).rows[0];
  check("元の版は現行版から降りる", old.is_current === false);
  check("元の版の中身は変わらない", JSON.stringify(old.activities) === JSON.stringify(before.activities));

  // ── ここが本命: 内容の複製漏れが無いこと ────────────
  const managed = new Set([
    "id",
    "version",
    "is_current",
    "revised_from_id",
    "revision_reason",
    "source_improvement_action_id",
    "created_at",
    "updated_at",
    "generated_at",
  ]);
  const cols = (
    await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'logic_models' AND table_schema = current_schema()
       ORDER BY ordinal_position`,
    )
  ).rows.map((r) => r.column_name);

  const mismatched = cols
    .filter((c) => !managed.has(c))
    .filter((c) => JSON.stringify(before[c]) !== JSON.stringify(after[c]));

  check(
    "管理列以外はすべて複製される（複製漏れなし）",
    mismatched.length === 0,
    mismatched.length > 0
      ? `複製されなかった列: ${mismatched.join(", ")}`
      : "",
  );
  console.log(`    （検査した列: ${cols.filter((c) => !managed.has(c)).length}個）`);

  // 要素IDが保たれること（KPI割当と因果の宛先が生き残る）
  const beforeIds = (before.initial_outcomes ?? []).map((e) => e.id).join(",");
  const afterIds = (after.initial_outcomes ?? []).map((e) => e.id).join(",");
  check("要素IDが保たれる（KPI割当と因果の宛先が生きる）", beforeIds === afterIds && beforeIds !== "");
  check(
    "因果エッジがそのまま運ばれる",
    JSON.stringify(before.edges) === JSON.stringify(after.edges),
  );

  // 改善アクションが新版を指す
  const act = (await client.query("SELECT * FROM improvement_actions WHERE id = $1", [ACTION])).rows[0];
  check("改善アクションの反映先が新版に向く", act.reflect_logic_model_id === result.id);
  check("反映日時が入る", act.reflected_at !== null);
  check("反映メモが入る", typeof act.reflection_note === "string" && act.reflection_note.includes("改訂"));

  // 現行版はプロジェクトごとに1件（部分ユニークインデックスに反しない）
  const n = (
    await client.query(
      "SELECT COUNT(*)::int AS n FROM logic_models WHERE project_id = $1 AND is_current",
      [PROJECT],
    )
  ).rows[0].n;
  check("現行版はプロジェクトごとに1件だけ", n === 1);

  // 続けてもう一度改訂できる（版が積み上がる）
  await client.query("BEGIN");
  const second = await reviseLogicModel(client, {
    projectId: PROJECT,
    reason: "2回目の改訂",
  });
  await client.query("COMMIT");
  check("続けて改訂できる", second.version === result.version + 1);
  check("2回目の派生元は1回目", second.revisedFromId === result.id);

  // 存在しないプロジェクトでは null
  await client.query("BEGIN");
  const none = await reviseLogicModel(client, {
    projectId: "99999999-9999-9999-9999-999999999999",
    reason: "存在しない",
  });
  await client.query("ROLLBACK");
  check("起点が無ければ null を返す", none === null);
} finally {
  client.release();
  await pool.end();
}

console.log(`\n結果: 成功 ${passed} 件 / 失敗 ${failed} 件`);
if (failed > 0) {
  console.error("\n改訂（版の複製）が期待と異なります。");
  process.exit(1);
}
