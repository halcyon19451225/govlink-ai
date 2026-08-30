#!/usr/bin/env node
/**
 * AI呼び出しの失敗履歴を読む — ai_usage_logs
 *
 * ゲートウェイ（lib/ai/gateway.ts）は成功・失敗のいずれもログに残し、
 * 失敗時は例外のメッセージを error_message に保存している。
 * 画面には「AIとの通信に失敗しました」としか出ないため、
 * 原因（レート制限・過負荷・不正なリクエスト等）はここで確認する。
 *
 * 使い方:
 *   cd ~/Documents/govlink-ai/app
 *   npm run ai:errors              # 直近20件の失敗
 *   npm run ai:errors -- 50        # 件数を指定
 *   npm run ai:errors -- 20 all    # 成功も含めて直近の呼び出しを見る
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

const limit = Number(process.argv[2] ?? 20) || 20;
const includeOk = process.argv[3] === "all";

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

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60_000,
});

try {
  const where = includeOk ? "" : "WHERE status <> 'ok'";
  const { rows } = await pool.query(
    `SELECT occurred_at, task_type, model, status,
            input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
            latency_ms, error_message
     FROM ai_usage_logs
     ${where}
     ORDER BY occurred_at DESC
     LIMIT $1`,
    [limit],
  );

  if (rows.length === 0) {
    console.log(includeOk ? "呼び出しの記録がありません" : "失敗の記録はありません");
  }
  for (const r of rows) {
    const when = new Date(r.occurred_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    // キャッシュの内訳。read が大きいほど入力コストが下がっている
    const cache =
      r.cache_read_tokens != null || r.cache_write_tokens != null
        ? ` cache(read=${r.cache_read_tokens ?? 0} write=${r.cache_write_tokens ?? 0})`
        : "";
    const io =
      r.input_tokens != null || r.output_tokens != null
        ? ` in=${r.input_tokens ?? "-"} out=${r.output_tokens ?? "-"}${cache}`
        : "";
    console.log(
      `\n[${when}] ${r.status.toUpperCase()} ${r.task_type} / ${r.model} ` +
        `(${r.latency_ms}ms${io})`,
    );
    if (r.error_message) console.log(`  ${r.error_message}`);
  }
  console.log("");
} catch (e) {
  console.error(`✗ 失敗: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
