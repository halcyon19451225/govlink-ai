#!/usr/bin/env node
/**
 * マイグレーションの予行演習（本番のデータのまま試して、必ず元に戻す）
 *
 *   node scripts/rehearse-migration.mjs 069
 *
 * run-migration.mjs と同じ SQL を同じ DB に対して流すが、**必ず ROLLBACK する**。
 * 適用したときに何が起きるか（通るのか・列がどう変わるのか・行が何行増えるのか）を、
 * 適用する前に、実際のデータで見るためのもの。
 *
 * なぜ要るか（2026-09-14）
 * ------------------------
 *   069 は「kpi_id を持たない measure_indicators が1行でもあると失敗する」という
 *   欠陥を抱えたまま「適用済み」と引き継がれていた。スクラッチ DB で試したときには
 *   該当する行が無く、通ってしまっていた。
 *   **スクラッチのデータで通ることは、実データで通ることの保証にならない。**
 *   実データで試す唯一の安全な方法が、トランザクションの中で流してロールバックすること。
 *
 * 注意
 * ----
 *   - DDL の間、対象テーブルに短い排他ロックがかかる。利用者がいる時間帯は避けること
 *   - CREATE INDEX CONCURRENTLY 等、トランザクションの中で動かせない文があると、
 *     予行演習はできない（その旨を表示して止まる）
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const MIG_DIR = resolve(APP_ROOT, "..", "infra", "migrations");

const arg = process.argv[2];
if (!arg) {
  console.error("使い方: node scripts/rehearse-migration.mjs <番号またはファイル名>");
  process.exit(1);
}
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
const matched = files.filter((f) => f === arg || f.startsWith(arg));
if (matched.length !== 1) {
  console.error(`✗ "${arg}" に一致するマイグレーションが ${matched.length} 件です: ${matched.join(", ")}`);
  process.exit(1);
}
const sql = readFileSync(join(MIG_DIR, matched[0]), "utf8");
console.log(`対象: ${matched[0]}（${sql.length} 文字）`);

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
console.log(`接続先: ${connectionString.replace(/\/\/[^@]*@/, "//***@").split("?")[0]}`);

// SQL が触るテーブル名を拾う（行数の前後比較に使う。拾い漏れても予行演習自体は成立する）
const touched = new Set();
for (const re of [/\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)/gi, /\bUPDATE\s+([a-z_][a-z0-9_]*)/gi,
                  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
                  /\bALTER\s+TABLE\s+([a-z_][a-z0-9_]*)/gi]) {
  for (const m of sql.matchAll(re)) touched.add(m[1].toLowerCase());
}

const SCHEMA_SQL = `SELECT table_name, column_name, is_nullable, data_type
                      FROM information_schema.columns WHERE table_schema = 'public'`;
const KIND_SQL = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public'`;

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 60_000 });
const client = await pool.connect();
client.on("notice", (msg) => { if (msg?.message) console.log("  [DB] " + msg.message); });

const counts = async () => {
  const out = {};
  for (const t of [...touched].sort()) {
    // ⚠ 存在しない表に COUNT を投げるとトランザクションごと abort する（以後の文が全部
    //    "current transaction is aborted" になり、本当の失敗箇所が見えなくなる）。
    //    先に to_regclass で存在を確かめる。
    const { rows } = await client.query(`SELECT to_regclass($1) AS r`, [`public.${t}`]);
    if (!rows[0].r) { out[t] = null; continue; }
    out[t] = Number((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
  }
  return out;
};
const snap = async (q) => (await client.query(q)).rows;
const key = (r) => `${r.table_name}.${r.column_name}`;

let ok = false;
try {
  await client.query("BEGIN");
  const beforeCols = await snap(SCHEMA_SQL);
  const beforeKinds = await snap(KIND_SQL);
  const beforeCounts = await counts();

  await client.query(sql);
  ok = true;
  console.log("\n✓ 通った（このあとロールバックする）");

  const afterCols = await snap(SCHEMA_SQL);
  const afterKinds = await snap(KIND_SQL);
  const afterCounts = await counts();

  const b = new Set(beforeCols.map(key)), a = new Set(afterCols.map(key));
  const added = [...a].filter((k) => !b.has(k)).sort();
  const removed = [...b].filter((k) => !a.has(k)).sort();
  const bk = new Map(beforeKinds.map((r) => [r.table_name, r.table_type]));
  const ak = new Map(afterKinds.map((r) => [r.table_name, r.table_type]));
  const kindChanged = [...ak].filter(([t, k]) => bk.has(t) && bk.get(t) !== k)
    .map(([t, k]) => `${t}: ${bk.get(t)} → ${k}`);
  const newTables = [...ak.keys()].filter((t) => !bk.has(t)).sort();
  const goneTables = [...bk.keys()].filter((t) => !ak.has(t)).sort();

  const list = (label, xs) => { if (xs.length) console.log(`\n${label}（${xs.length}）:\n  ` + xs.join("\n  ")); };
  list("増えた表", newTables);
  list("消えた表", goneTables);
  list("種類が変わった表", kindChanged);
  list("増えた列", added);
  list("消えた列", removed);

  const rows = [...touched].sort()
    .map((t) => ({ 表: t, 前: beforeCounts[t] ?? "（無し）", 後: afterCounts[t] ?? "（無し）" }))
    .filter((r) => r.前 !== r.後);
  if (rows.length) { console.log("\n行数が変わった表:"); console.table(rows); }
} catch (e) {
  console.error(`\n✗ 失敗した: ${e instanceof Error ? e.message : e}`);
  console.error("  → このまま run-migration.mjs を実行しても、同じところで止まる。");
  process.exitCode = 1;
} finally {
  try { await client.query("ROLLBACK"); } catch { /* BEGIN 前 */ }
  console.log(`\n↩ ロールバックした。DB は変わっていない${ok ? "（通ることだけ確かめた）" : ""}`);
  client.release();
  await pool.end();
}
