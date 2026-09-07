#!/usr/bin/env node
/**
 * Aurora 休止復帰の検証（読み取りのみ・破壊的操作なし）
 *
 * 使い方（app/ ディレクトリで実行）:
 *   node scripts/probe-db-wakeup.mjs
 *
 * 何を確かめるか
 * -------------
 * `6b25bed` は「Aurora Serverless v2 が min 0 ACU で休止し、復帰に十数秒かかるため、
 * src/lib/db.ts の connectionTimeoutMillis: 5_000 では復帰を待ちきれず、休止後の
 * 最初のリクエストが落ちていた」という**状況証拠による推定**のまま入れた
 * （claude/coe-tenant-isolation.md §12-2）。
 *
 * このスクリプトは、その推定を**再現によって**確かめる。
 *
 *   Phase 1: 旧設定（5_000）で接続 → 休止中なら「落ちるはず」
 *   Phase 2: 直後に現行設定（30_000）で接続 → 「待たされたうえで成功するはず」
 *   Phase 3: もう一度 接続 → 起きているので「即座に成功するはず」
 *
 * Phase 1 が落ちて Phase 2 が 5 秒超で成功したとき、初めて
 * 「旧設定なら落ち、新設定なら通る」ことが実証される。
 *
 * ⚠ **実行前に、DB を十分に放置していること。**
 *   Aurora の自動一時停止は既定 300 秒（SecondsUntilAutoPause）。
 *   本番サイトを開いた直後に実行しても DB は起きているので、検証にならない
 *   （その場合はスクリプトが「休止していなかった」と報告して終わる）。
 *   実際の休止までの秒数は CloudShell の describe-db-clusters で確認できる。
 *
 * ⚠ Phase 1 の接続試行そのものが Aurora の復帰を始動させる。
 *   したがって Phase 1 → 2 → 3 はこの順序でなければ意味を持たない。
 *
 * 接続情報は inspect-tenants.mjs / run-migration.mjs と同じく app/.env.local の
 * DATABASE_URL を読む。認証情報は出力しない（ホスト名のみ表示する）。
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

// 表示用（認証情報は出さない）
let hostLabel = "(不明)";
try {
  hostLabel = new URL(connectionString).hostname;
} catch {
  /* 表示だけなので無視 */
}

const SSL = { rejectUnauthorized: false };

/** 1 回の接続を試み、所要時間とともに結果を返す */
async function attempt(label, timeoutMs, withQueries = false) {
  const client = new pg.Client({
    connectionString,
    ssl: SSL,
    connectionTimeoutMillis: timeoutMs,
  });
  const t0 = Date.now();
  try {
    await client.connect();
    const ms = Date.now() - t0;
    let extra = null;
    if (withQueries) {
      const r = await client.query(
        `SELECT now() AS now,
                pg_postmaster_start_time() AS started,
                date_trunc('second', now() - pg_postmaster_start_time()) AS uptime,
                current_setting('server_version') AS version`,
      );
      extra = r.rows[0];
    }
    await client.end();
    return { label, timeoutMs, ok: true, ms, extra };
  } catch (e) {
    const ms = Date.now() - t0;
    try {
      await client.end();
    } catch {
      /* 失敗した接続の後始末。握りつぶす */
    }
    return { label, timeoutMs, ok: false, ms, error: e.message };
  }
}

function line(r) {
  const status = r.ok ? "成功" : "失敗";
  const s = (r.ms / 1000).toFixed(2);
  const tail = r.ok ? "" : `  — ${r.error}`;
  return `  ${r.label.padEnd(34, "…")} ${status}  ${s}s（上限 ${r.timeoutMs / 1000}s）${tail}`;
}

console.log("");
console.log("Aurora 休止復帰の検証（読み取りのみ）");
console.log(`  ホスト : ${hostLabel}`);
console.log(`  開始   : ${new Date().toISOString()}`);
console.log("");
console.log("  ⚠ 直前に本番サイトや他のスクリプトで DB に触れていると、");
console.log("    DB が起きているため検証になりません。");
console.log("");

const p1 = await attempt("Phase 1 旧設定 5_000（8625022 相当）", 5_000);
console.log(line(p1));

const p2 = await attempt("Phase 2 現行 30_000（6b25bed）", 30_000, true);
console.log(line(p2));

const p3 = await attempt("Phase 3 再接続（温まった状態）", 30_000, true);
console.log(line(p3));

console.log("");

if (p2.extra) {
  console.log("  DB 側の申告（参考）");
  console.log(`    server_version          : ${p2.extra.version}`);
  console.log(`    pg_postmaster_start_time: ${p2.extra.started.toISOString()}`);
  console.log(`    uptime                  : ${p2.extra.uptime}`);
  console.log("");
  console.log("    ※ Aurora Serverless v2 の 0 ACU からの復帰で postmaster が");
  console.log("      再起動するとは限らない。uptime が短ければ復帰の裏づけになるが、");
  console.log("      長くても休止していなかったことの証明にはならない。");
  console.log("      休止そのものの直接証拠は CloudWatch の ServerlessDatabaseCapacity。");
  console.log("");
}

// ── 判定 ──────────────────────────────────────────────────────
console.log("  判定");
if (!p1.ok && p2.ok && p2.ms > 5_000) {
  console.log("    ✅ 推定を裏づけた。");
  console.log(`       旧設定（5s）では落ち、現行設定では ${(p2.ms / 1000).toFixed(2)}s 待って成功した。`);
  console.log("       休止後の最初のリクエストは、6b25bed の前なら確実に失敗していた。");
} else if (!p1.ok && p2.ok && p2.ms <= 5_000) {
  console.log("    ⚠ 判断保留。Phase 1 は落ちたが Phase 2 は 5s 以内に成功している。");
  console.log("       復帰が Phase 1 の試行で始まっていたため Phase 2 が短く出た可能性が高い。");
  console.log("       Phase 1 の失敗（5s 到達）自体は、旧設定では落ちていたことを示す。");
} else if (p1.ok && p1.ms > 3_000) {
  console.log("    ⚠ 境界付近。5s 以内だが 3s 超で接続できた。");
  console.log("       休止からの復帰中ではあったが、今回はぎりぎり間に合った。");
  console.log("       5s が危険な設定だったことの傍証にはなる。もう少し放置して再実行を。");
} else if (p1.ok) {
  console.log("    ⏸ 検証になっていない。DB は休止していなかった（即座に接続できた）。");
  console.log("       本番サイトを触らずに、下記 SecondsUntilAutoPause + 5 分ほど放置して再実行してください。");
} else if (!p2.ok) {
  console.log("    ❌ 30s でも接続できない。休止復帰とは別の原因（到達性・SG・認証・停止）。");
  console.log("       CloudShell の describe-db-clusters で Status を確認してください。");
}
console.log("");

if (p3.ok) {
  console.log(`  参考: 温まった後の接続は ${(p3.ms / 1000).toFixed(2)}s。`);
  console.log("        通常運用でこの遅さが常態化するわけではないことの確認。");
  console.log("");
}
