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
        // ⚠ interval をそのまま返すと node-pg がオブジェクトに変換し、
        //   文字列化すると [object Object] になる。秒数（整数）で受け取る。
        `SELECT now() AS now,
                pg_postmaster_start_time() AS started,
                EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())::bigint AS uptime_seconds,
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

// --wait <分>: DB に触れずに指定分だけ待ってから測る。
// 自分の手で DB を起こしてしまう事故を避けるための待機。
const waitIdx = process.argv.indexOf("--wait");
const waitMinutes = waitIdx >= 0 ? Number(process.argv[waitIdx + 1]) : 0;

console.log("");
console.log("Aurora 休止復帰の検証（読み取りのみ）");
console.log(`  ホスト : ${hostLabel}`);
console.log(`  開始   : ${new Date().toISOString()}`);
console.log("");
console.log("  ⚠ 直前に本番サイトや他のスクリプトで DB に触れていると、");
console.log("    DB が起きているため検証になりません。");
console.log("    自動一時停止は 300 秒（2026-09-07 に describe-db-clusters で確認）。");
console.log("");

if (waitMinutes > 0) {
  console.log(`  --wait ${waitMinutes}: DB に触れずに ${waitMinutes} 分待ってから測ります。`);
  console.log("    この間、本番サイトを開かないでください。");
  for (let left = waitMinutes; left > 0; left--) {
    process.stdout.write(`\r    残り ${left} 分…   `);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  process.stdout.write("\r    待機おわり。測定します。\n\n");
}

const startedAt = Date.now();

const p1 = await attempt("Phase 1 旧設定 5_000（8625022 相当）", 5_000);
console.log(line(p1));

const p2 = await attempt("Phase 2 現行 30_000（6b25bed）", 30_000, true);
console.log(line(p2));

const p3 = await attempt("Phase 3 再接続（温まった状態）", 30_000, true);
console.log(line(p3));

console.log("");

const uptimeSec = p2.extra ? Number(p2.extra.uptime_seconds) : null;

if (p2.extra) {
  const mm = Math.floor(uptimeSec / 60);
  const ss = uptimeSec % 60;
  console.log("  DB 側の申告");
  console.log(`    server_version          : ${p2.extra.version}`);
  console.log(`    pg_postmaster_start_time: ${p2.extra.started.toISOString()}`);
  console.log(`    uptime                  : ${uptimeSec} 秒（${mm}分${ss}秒）`);
  console.log("");
  console.log("    ※ uptime が短ければ「最近 postmaster が起動した」ことは確かだが、");
  console.log("      それが Aurora の 0 ACU からの復帰によるものだと**断定はできない**");
  console.log("      （フェイルオーバーやパッチ適用でも再起動する）。");
  console.log("      下の判定は「復帰＝postmaster 再起動」を前提に置いている。");
  console.log("      前提の当否は CloudWatch の ServerlessDatabaseCapacity を");
  console.log("      同じ時刻について 60 秒刻みで引き、0 → 非0 の切り替わりが");
  console.log("      この起動時刻と一致するかで確かめること。");
  console.log("");
}

// ── 判定 ──────────────────────────────────────────────────────
// この接続そのものが復帰を起動したのか、それとも既に起きていたのか。
// uptime が「Phase 1 開始からの経過時間」に収まっていれば、起こしたのは我々。
// ⚠ これは「Aurora の復帰時に postmaster が再起動する」ことを前提にした判定。
//   その前提自体はまだ本番で確認できていない（上の注記を参照）。
const elapsedSinceStart = Math.ceil((Date.now() - startedAt) / 1000) + 5;
const wokeItOurselves = uptimeSec !== null && uptimeSec <= elapsedSinceStart;

console.log("  判定");
if (p1.ok && wokeItOurselves) {
  console.log("    ❗ **推定を否定しうる結果。** DB は休止していて、5秒以内に復帰した可能性が高い。");
  console.log(`       postmaster の uptime が ${uptimeSec} 秒＝この検証の中で起動している。`);
  console.log("       つまり休止していたにもかかわらず Phase 1（5s）が成功した。");
  console.log("");
  console.log("       これが正しければ、6b25bed の「5秒では復帰を待ちきれず落ちていた」");
  console.log("       という説明は成り立たない。タイムアウトを 30 秒に揃えた判断自体は");
  console.log("       単独で正しいが、coe-tenant-isolation.md §12-2 の因果の記述は");
  console.log("       書き直しが要る（/public/[slug] の描画エラーには別の原因がある）。");
  console.log("");
  console.log("       ⚠ 結論づける前に、同じ時刻の ServerlessDatabaseCapacity を");
  console.log("         60秒刻みで引き、0 → 非0 の切り替わりが上の");
  console.log("         pg_postmaster_start_time と一致することを確かめること。");
} else if (!p1.ok && p2.ok && p2.ms > 5_000) {
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
  console.log("    ⏸ 検証になっていない。DB は既に起きていた（即座に接続できた）。");
  if (uptimeSec !== null) {
    console.log(`       postmaster の uptime は ${uptimeSec} 秒。この検証より前に`);
    console.log("       別の何かが DB を起こしている（本番サイトへのアクセス、Amplify の");
    console.log("       デプロイ、他のスクリプト、監視など）。");
  }
  console.log("");
  console.log("       やり直す前に、CloudWatch で「今まさに 0 ACU か」を確認してください:");
  console.log("");
  console.log("         aws cloudwatch get-metric-statistics --namespace AWS/RDS \\");
  console.log("           --metric-name ServerlessDatabaseCapacity --dimensions \\");
  console.log("           Name=DBClusterIdentifier,Value=govlinkdatastack-appdbae2ca689-nsxguoq1jyy4 \\");
  console.log("           --start-time $(date -u -v-20M +%Y-%m-%dT%H:%M:%SZ) \\");
  console.log("           --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) --period 60 \\");
  console.log("           --statistics Minimum --region ap-northeast-1 --output text --no-cli-pager");
  console.log("");
  console.log("       直近の行が 0.0 になってから、--wait を付けて実行するのが確実です:");
  console.log("         node scripts/probe-db-wakeup.mjs --wait 7");
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
