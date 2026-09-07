#!/usr/bin/env node
/**
 * レート制限の実挙動を確認する（読み取りのみ・破壊的操作なし）
 *
 * 使い方（app/ ディレクトリで実行）:
 *   node scripts/inspect-rate-limits.mjs            … 直近のバケットを一覧
 *   node scripts/inspect-rate-limits.mjs --scope contact
 *
 * 何のためにあるか
 * ---------------
 * check:ratelimit は**ソースの形**しか見ない。実際に効いているかは別。
 * とくに次の1点は、本番の前段構成に依存するため、確かめないと分からない:
 *
 *   **X-Forwarded-For の「末尾」が本当に閲覧者の IP か。**
 *
 * CloudFront は閲覧者が付けてきた XFF の後ろに実 IP を追記する仕様なので、
 * 末尾を採るのが正しい。ただし Amplify SSR に届くまでに別のホップが
 * 挟まっていれば、末尾は内部ホップの IP になりうる。
 * 「たぶん CloudFront 1段だろう」で済ませない（§12-3）。
 *
 * 確認のしかた
 * -----------
 *   1) 本番へ、偽装した X-Forwarded-For を付けて1回だけ POST する
 *
 *        curl -s -o /dev/null -w '%{http_code}\n' -X POST \
 *          https://main.d28aydpmu6jocl.amplifyapp.com/api/auth/forgot-password \
 *          -H 'Content-Type: application/json' \
 *          -H 'X-Forwarded-For: 203.0.113.9' \
 *          -d '{"email":"probe-not-a-real-user@example.com"}'
 *
 *      （forgot-password は存在しないアドレスでも 200 を返す＝列挙対策。
 *        実在しないアドレスを使えばメールは飛ばない）
 *
 *   2) このスクリプトを実行し、記録されたバケットを見る
 *
 *        forgot-password:ip:203.0.113.9  → **先頭を採っている＝偽装可能。誤り**
 *        forgot-password:ip:<自分の実IP> → 末尾を採れている＝正しい
 *        forgot-password:ip:unknown      → XFF が届いていない。別途要調査
 *
 * 接続情報は他のスクリプトと同じく app/.env.local の DATABASE_URL を読む。
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  console.error("DATABASE_URL が見つかりません（app/.env.local）");
  process.exit(1);
}

const args = process.argv.slice(2);
const scopeIdx = args.indexOf("--scope");
const scope = scopeIdx >= 0 ? args[scopeIdx + 1] : null;

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60_000, // Aurora Serverless v2 は min 0 ACU のため起動待ちが要る
});

const client = await pool.connect();
try {
  const exists = await client.query(
    `SELECT to_regclass('public.rate_limits') IS NOT NULL AS present`,
  );
  if (!exists.rows[0].present) {
    console.log("\n✗ rate_limits テーブルがありません。");
    console.log("  先に migration を適用してください: node scripts/run-migration.mjs 065\n");
    console.log("  ⚠ 適用前にデプロイすると、enforceRateLimit が毎回失敗し、");
    console.log("    fail closed により公開フォームが全部 503 になります。\n");
    process.exit(1);
  }

  const rows = (
    await client.query(
      `SELECT bucket, count, window_started_at, updated_at
       FROM rate_limits
       ${scope ? "WHERE bucket LIKE $1" : ""}
       ORDER BY updated_at DESC
       LIMIT 60`,
      scope ? [`${scope}:%`] : [],
    )
  ).rows;

  console.log("");
  if (rows.length === 0) {
    console.log("  記録がありません（まだ誰も対象のエンドポイントを叩いていない）。");
    console.log("");
    process.exit(0);
  }

  console.log(`  直近 ${rows.length} 件（新しい順）`);
  console.log("");
  console.log("  " + "バケット".padEnd(52) + "回数  窓の開始");
  console.log("  " + "-".repeat(84));
  for (const r of rows) {
    const bucket = r.bucket.length > 50 ? r.bucket.slice(0, 49) + "…" : r.bucket;
    console.log(
      "  " +
        bucket.padEnd(52) +
        String(r.count).padStart(4) +
        "  " +
        r.window_started_at.toISOString(),
    );
  }
  console.log("");

  const ips = rows.filter((r) => /:ip:/.test(r.bucket));
  if (ips.length > 0) {
    console.log("  IP の採り方の確認");
    if (ips.some((r) => r.bucket.endsWith(":unknown"))) {
      console.log("    ⚠ :ip:unknown が記録されています。X-Forwarded-For が");
      console.log("      届いていないか、IP として妥当な形をしていません。");
      console.log("      この状態では IP 単位の制限が全員1つのバケットに集まります。");
    }
    console.log("    上の一覧に、偽装した値（例 203.0.113.9）が入っていないか確認してください。");
    console.log("    入っていれば XFF の先頭を採っており、ヘッダ1つで回避できます。");
    console.log("");
  }
} finally {
  client.release();
  await pool.end();
}
