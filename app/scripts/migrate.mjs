#!/usr/bin/env node
/**
 * マイグレーションランナー
 * 使用: node scripts/migrate.mjs [--dry-run] [010 011 ...]
 * 引数なしの場合、010〜以降の未適用マイグレーションをすべて実行
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// .env.local を手動でパース（dotenvなしで動作）
function loadEnv() {
  const envPath = resolve(__dirname, '../.env.local');
  if (!existsSync(envPath)) {
    console.error('❌  .env.local が見つかりません:', envPath);
    process.exit(1);
  }
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '');
  }
}

loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL が設定されていません');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetNums = args.filter(a => /^\d+$/.test(a));

// 010以降のマイグレーションファイルを対象とする
const MIGRATIONS = ['010_care_plan_suite.sql', '011_system_templates.sql'];

const targets = targetNums.length > 0
  ? MIGRATIONS.filter(f => targetNums.some(n => f.startsWith(n)))
  : MIGRATIONS;

if (targets.length === 0) {
  console.error('❌  対象ファイルが見つかりません:', targetNums);
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    for (const file of targets) {
      const filePath = resolve(ROOT, 'infra/migrations', file);
      if (!existsSync(filePath)) {
        console.error(`❌  ファイルが見つかりません: ${filePath}`);
        process.exit(1);
      }
      const sql = readFileSync(filePath, 'utf8');
      console.log(`\n▶  ${file} を${dryRun ? '（DRY RUN）' : ''}実行中...`);
      if (dryRun) {
        console.log('--- SQL ---');
        console.log(sql.slice(0, 500), '...[省略]');
      } else {
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('COMMIT');
          console.log(`✅  ${file} 完了`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`❌  ${file} 失敗 (ROLLBACK):`, err.message);
          process.exit(1);
        }
      }
    }

    // 完了確認クエリ
    if (!dryRun) {
      console.log('\n📊  完了確認クエリ:');
      const checks = [
        ["plan_modules 件数",     "SELECT COUNT(*) FROM plan_modules"],
        ["plan_templates 件数",   "SELECT COUNT(*) FROM plan_templates"],
        ["dataset_definitions 件数", "SELECT COUNT(*) FROM dataset_definitions"],
        ["pdca_cycle_defs 件数",  "SELECT COUNT(*) FROM pdca_cycle_defs"],
        ["pdca_checkpoint_defs 件数", "SELECT COUNT(*) FROM pdca_checkpoint_defs"],
        ["projects 件数（既存保持確認）", "SELECT COUNT(*) FROM projects"],
        ["logic_models 件数",     "SELECT COUNT(*) FROM logic_models"],
        ["kpis 件数",             "SELECT COUNT(*) FROM kpis"],
        ["kpis.indicator_type 存在確認",
          "SELECT column_name FROM information_schema.columns WHERE table_name='kpis' AND column_name='indicator_type'"],
        ["plan_templates_legacy 存在確認",
          "SELECT COUNT(*) FROM plan_templates_legacy"],
      ];
      for (const [label, query] of checks) {
        try {
          const res = await client.query(query);
          const val = res.rows[0]?.count ?? res.rows[0]?.column_name ?? JSON.stringify(res.rows[0]);
          console.log(`  ${label}: ${val}`);
        } catch (e) {
          console.log(`  ${label}: ⚠️  ${e.message}`);
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('予期しないエラー:', err);
  process.exit(1);
});
