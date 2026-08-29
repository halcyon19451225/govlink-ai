#!/usr/bin/env node
/**
 * マイグレーション実行スクリプト
 *
 * psql が無い環境でも `node` だけでマイグレーションを流せるようにするもの。
 * 接続情報は app/.env.local の DATABASE_URL（または環境変数）を使う。
 *
 * 使い方:
 *   cd ~/Documents/govlink-ai/app
 *   node scripts/run-migration.mjs 055        # 番号で指定（前方一致）
 *   node scripts/run-migration.mjs 055 --dry  # 適用せず、対象ファイルと現在の列だけ確認
 *
 * 全体をトランザクションで囲むので、途中で失敗すれば何も適用されない。
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const MIG_DIR = resolve(APP_ROOT, "..", "infra", "migrations");

const arg = process.argv[2];
const dryRun = process.argv.includes("--dry");
if (!arg) {
  console.error("使い方: node scripts/run-migration.mjs <番号またはファイル名> [--dry]");
  process.exit(1);
}

// ── 対象ファイルの特定 ──────────────────────────
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
const matched = files.filter((f) => f === arg || f.startsWith(arg));
if (matched.length === 0) {
  console.error(`✗ "${arg}" に一致するマイグレーションが見つかりません`);
  console.error(`  ${MIG_DIR} の中身: ${files.slice(-5).join(", ")} …`);
  process.exit(1);
}
if (matched.length > 1) {
  console.error(`✗ "${arg}" が複数に一致します: ${matched.join(", ")}`);
  process.exit(1);
}
const file = join(MIG_DIR, matched[0]);
const sql = readFileSync(file, "utf8");
console.log(`対象: ${matched[0]}（${sql.length} 文字）`);

// ── 接続情報 ────────────────────────────────
function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(APP_ROOT, ".env.local");
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const connectionString = readDatabaseUrl();
if (!connectionString) {
  console.error("✗ DATABASE_URL が見つかりません（環境変数か app/.env.local）");
  process.exit(1);
}
// 接続先だけ表示（認証情報は出さない）
console.log(`接続先: ${connectionString.replace(/\/\/[^@]*@/, "//***@").split("?")[0]}`);

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60_000, // Aurora Serverless v2 は min 0 ACU のため起動待ちが要る
});

const client = await pool.connect();
// マイグレーション内の RAISE NOTICE を拾って表示する（飛ばしたテーブル等の申し送り）
client.on("notice", (msg) => {
  if (msg && msg.message) console.log('  [DB] ' + msg.message);
});
try {
  if (dryRun) {
    console.log("\n--dry: 適用せずに終了します。SQL の先頭:");
    console.log(sql.split("\n").slice(0, 12).map((l) => "  " + l).join("\n"));
  } else {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("\n✓ 適用しました");
  }

  // ── 055 の場合は結果を検証する ────────────────
  if (matched[0].startsWith("055")) {
    const { rows } = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('asis_analyses','issue_dialogues','measure_dialogues','improvement_dialogues')
         AND column_name LIKE 'turn\\_%'
       ORDER BY table_name, column_name`,
    );
    console.log(`\n検証: turn_* 列 ${rows.length} 個（期待値 16 = 4テーブル × 4列）`);
    const byTable = {};
    for (const r of rows) (byTable[r.table_name] ??= []).push(r.column_name);
    for (const [t, cols] of Object.entries(byTable)) {
      console.log(`  ${cols.length === 4 ? "✓" : "✗"} ${t}: ${cols.join(", ")}`);
    }
    if (rows.length !== 16) {
      console.error("\n✗ 列が揃っていません。上の表示を確認してください");
      process.exitCode = 1;
    }
  }
} catch (e) {
  try { await client.query("ROLLBACK"); } catch { /* BEGIN 前の失敗 */ }
  console.error(`\n✗ 失敗（適用されていません）: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
