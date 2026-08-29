#!/usr/bin/env node
/**
 * スキーマ差分の監査 — 「どのマイグレーションが未適用か」を洗い出す
 *
 * このリポジトリにはマイグレーション適用履歴のテーブルが無く、
 * 適用漏れが本番で初めて発覚する（2026-08-29: 033 未適用による
 * improvement_dialogues 不在が、055 の適用時にはじめて判明した）。
 *
 * 各マイグレーションが宣言している
 *   ① CREATE TABLE のテーブル名
 *   ② ALTER TABLE … ADD COLUMN の列名
 * を実DBと突き合わせ、未適用の疑いがあるものを列挙する。
 * ②まで見るのは、列追加だけのマイグレーション（全体の半数近く）が
 * ①だけでは判定不能で、そこに漏れがあっても気づけないため。
 *
 * 使い方:
 *   cd ~/Documents/govlink-ai/app
 *   npm run check:drift
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const MIG_DIR = resolve(APP_ROOT, "..", "infra", "migrations");

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

/** コメントと DO $$ … $$ ブロックを除いた SQL を返す（誤検出を減らすため） */
function strip(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/gi, "");
}

// ── 各マイグレーションの宣言を抽出 ─────────────────
const files = readdirSync(MIG_DIR).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
const declared = [];
for (const f of files) {
  const sql = strip(readFileSync(join(MIG_DIR, f), "utf8"));

  const tables = [
    ...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi),
  ].map((m) => m[1].toLowerCase());

  // ALTER TABLE <t> … ADD COLUMN <c>（複数行・複数列に対応）
  const columns = [];
  for (const stmt of sql.matchAll(
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?([\s\S]*?);/gi,
  )) {
    const table = stmt[1].toLowerCase();
    for (const add of stmt[2].matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi,
    )) {
      columns.push({ table, column: add[1].toLowerCase() });
    }
  }

  declared.push({ file: f, tables: [...new Set(tables)], columns });
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60_000, // Aurora Serverless v2 は min 0 ACU のため起動待ちが要る
});
const client = await pool.connect();
try {
  const { rows: tRows } = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const tableSet = new Set(tRows.map((r) => r.table_name.toLowerCase()));

  const { rows: cRows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const colSet = new Set(cRows.map((r) => `${r.table_name.toLowerCase()}.${r.column_name.toLowerCase()}`));

  console.log(`実DB: ${tableSet.size} テーブル / ${colSet.size} 列\n`);

  const suspect = [];
  const undecidable = [];
  for (const d of declared) {
    const missingTables = d.tables.filter((t) => !tableSet.has(t));
    // 自身が作るテーブルへの列追加は、テーブル不在の時点で二重報告になるので除く
    const missingCols = d.columns.filter(
      (c) => tableSet.has(c.table) && !colSet.has(`${c.table}.${c.column}`),
    );
    if (missingTables.length > 0 || missingCols.length > 0) {
      suspect.push({ ...d, missingTables, missingCols });
    } else if (d.tables.length === 0 && d.columns.length === 0) {
      undecidable.push(d.file);
    }
  }

  if (suspect.length === 0) {
    console.log("✓ 未適用の疑いがあるマイグレーションはありません");
  } else {
    console.log("⚠ 未適用の疑いがあるマイグレーション:\n");
    for (const s of suspect) {
      const partial =
        s.missingTables.length > 0 && s.missingTables.length < s.tables.length
          ? "（一部のみ不在＝部分適用の疑い）"
          : "";
      console.log(`  ${s.file}${partial}`);
      if (s.missingTables.length > 0) console.log(`    テーブル不在: ${s.missingTables.join(", ")}`);
      for (const c of s.missingCols) console.log(`    列 不在: ${c.table}.${c.column}`);
    }
    console.log(`\n  → 番号の小さい順に  npm run migrate <番号>  で適用してください`);
  }

  if (undecidable.length > 0) {
    console.log(
      `\n（判定不能: CREATE TABLE も ADD COLUMN も含まない ${undecidable.length} 件` +
        ` — 制約変更・INSERT・関数定義のみ。適用済みかは判定できません）`,
    );
    console.log(`  ${undecidable.join(", ")}`);
  }
} catch (e) {
  console.error(`✗ 失敗: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
