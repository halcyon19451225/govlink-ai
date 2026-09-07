#!/usr/bin/env node
/**
 * Aurora 休止復帰の検証（読み取りのみ・破壊的操作なし）
 *
 * 使い方（app/ ディレクトリで実行）:
 *   node scripts/probe-db-wakeup.mjs               … 1回測る
 *   node scripts/probe-db-wakeup.mjs --wait 7      … DB に触れず 7 分待ってから 1回測る
 *   node scripts/probe-db-wakeup.mjs --loop        … 8 分おきに繰り返し、決着したら止まる（最大 12 回）
 *   node scripts/probe-db-wakeup.mjs --loop 10 --max 6
 *   node scripts/probe-db-wakeup.mjs --sync        … PostgreSQL ログから「次に休止する時刻」を
 *                                                   計算し、休止直後に測る（aws CLI が要る）
 *
 * 何を確かめるか
 * -------------
 * `6b25bed` は「Aurora Serverless v2 が min 0 ACU で休止し、復帰に十数秒かかるため、
 * src/lib/db.ts の connectionTimeoutMillis: 5_000 では復帰を待ちきれず、休止後の
 * 最初のリクエストが落ちていた」という**状況証拠による推定**のまま入れた
 * （claude/coe-tenant-isolation.md §12-2）。
 *
 * 2026-09-07 に確定したこと:
 *   ・Aurora は実際に休止している（ServerlessDatabaseCapacity の 24h・288点のうち 135点が 0.0）
 *   ・自動一時停止までの秒数は 300（describe-db-clusters）
 * まだ確かめられていないこと:
 *   ・**復帰に何秒かかるか。5 秒を超えるのか。** ← このスクリプトが測る
 *
 * 測り方
 * -----
 *   Phase 1: 旧設定（5_000）で接続 → 休止中なら「落ちるはず」
 *   Phase 2: 直後に現行設定（30_000）で接続 → 「待たされたうえで成功するはず」
 *   Phase 3: もう一度 接続 → 起きているので「即座に成功するはず」
 *
 * Phase 1 の接続試行そのものが Aurora の復帰を始動させる。この順序に意味がある。
 *
 * 結果の読み方（pg_postmaster_start_time と突き合わせる）
 * -------------------------------------------------------
 *   Phase 1 が落ちた                        → 5 秒では足りない。推定を裏づけた
 *   Phase 1 が通り、postmaster の起動が
 *     この測定の中（uptime ≤ 経過秒数）     → 休止していたが 5 秒以内に復帰した。
 *                                             **推定を否定しうる**重要な結果
 *     この測定より前（uptime が長い）        → DB は既に起きていた。測定として無効
 *
 * ⚠ 「Aurora の復帰時に postmaster が再起動する」は本番でまだ未確認の前提。
 *   CloudWatch の ServerlessDatabaseCapacity（60 秒刻み）で 0 → 非0 の切り替わりが
 *   起動時刻と一致するかで裏を取ること。2 回の観測（13:11:09Z・13:38:41Z）が突き合わせ待ち。
 *
 * 何が DB を起こしているか（2026-09-07 に PostgreSQL ログで特定）
 * ------------------------------------------------------------
 *   5432 が 0.0.0.0/0 に開いているため、インターネット上のスキャナ
 *   （観測時は 159.65.148.75、admin@postgres で no pg_hba.conf entry）が
 *   **約 5.5 分おき**に接続してくる。自動一時停止が 300 秒なので、
 *   「休止 → 30〜40 秒後にスキャナが来て復帰」を一日中繰り返している。
 *   postmaster の起動時刻とスキャナの FATAL が 1〜2 秒差で一致した（2 回とも）。
 *   → 「復帰＝postmaster 再起動」は確定。
 *   → 40 秒程度の休止は 1 分刻みの ServerlessDatabaseCapacity に 0 が乗らない。
 *
 *   1 回きりの測定では休止の窓（30〜40 秒）に当たりにくい。
 *   --loop は当てずっぽうに繰り返す。--sync はログから最後の接続時刻を読み、
 *   その 300 秒後（＝休止直後、スキャナが戻る前）を狙って測る。
 *
 * 接続情報は inspect-tenants.mjs / run-migration.mjs と同じく app/.env.local の
 * DATABASE_URL を読む。認証情報は出力しない（ホスト名のみ表示する）。
 */
import pg from "pg";
import { execFileSync } from "node:child_process";
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

let hostLabel = "(不明)";
try {
  hostLabel = new URL(connectionString).hostname;
} catch {
  /* 表示だけなので無視 */
}

// ── 引数 ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function optNumber(name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
const waitMinutes = optNumber("--wait", 7) ?? 0;
const loopMinutes = optNumber("--loop", 8); // null なら 1 回だけ
const maxAttempts = optNumber("--max", 12) ?? 12;
const syncMode = argv.includes("--sync");

// --sync が読む PostgreSQL ログ（2026-09-07 に modify-db-cluster で有効化した）
const REGION = "ap-northeast-1";
const CLUSTER_ID = "govlinkdatastack-appdbae2ca689-nsxguoq1jyy4";
const PG_LOG_GROUP = `/aws/rds/cluster/${CLUSTER_ID}/postgresql`;
const AUTO_PAUSE_SEC = 300; // describe-db-clusters の SecondsUntilAutoPause（2026-09-07 確認）

const SSL = { rejectUnauthorized: false };

function jst(d) {
  return new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
}

/** 1 回の接続を試み、所要時間とともに結果を返す */
async function attempt(label, timeoutMs, withQueries = false) {
  const client = new pg.Client({ connectionString, ssl: SSL, connectionTimeoutMillis: timeoutMs });
  const t0 = Date.now();
  try {
    await client.connect();
    const ms = Date.now() - t0;
    let extra = null;
    if (withQueries) {
      // ⚠ interval をそのまま返すと node-pg がオブジェクトに変換し [object Object] になる。
      //   秒数（整数）で受け取る。
      const r = await client.query(
        `SELECT pg_postmaster_start_time() AS started,
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
      /* 失敗した接続の後始末 */
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

async function sleepMinutes(min, note) {
  for (let left = min; left > 0; left--) {
    process.stdout.write(`\r    ${note} 残り ${left} 分…   `);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  process.stdout.write("\r" + " ".repeat(60) + "\r");
}

/**
 * 3 フェーズを 1 回実行し、判定を返す。
 * decisive=true なら結論が出た（--loop はここで止まる）。
 */
async function measure() {
  const startedAt = Date.now();
  const p1 = await attempt("Phase 1 旧設定 5_000（8625022 相当）", 5_000);
  const p2 = await attempt("Phase 2 現行 30_000（6b25bed）", 30_000, true);
  const p3 = await attempt("Phase 3 再接続（温まった状態）", 30_000, true);

  const uptimeSec = p2.extra ? Number(p2.extra.uptime_seconds) : null;
  // uptime が「Phase 1 開始からの経過秒数」に収まっていれば、起こしたのはこの測定。
  const elapsed = Math.ceil((Date.now() - startedAt) / 1000) + 5;
  const wokeItOurselves = uptimeSec !== null && uptimeSec <= elapsed;

  let verdict; // { kind, decisive, lines[] }
  if (!p1.ok && p2.ok && p2.ms > 5_000) {
    verdict = {
      kind: "confirmed",
      decisive: true,
      lines: [
        "✅ 推定を裏づけた。",
        `   旧設定（5s）では落ち、現行設定では ${(p2.ms / 1000).toFixed(2)}s 待って成功した。`,
        "   休止後の最初のリクエストは、6b25bed の前なら確実に失敗していた。",
      ],
    };
  } else if (!p1.ok && p2.ok) {
    verdict = {
      kind: "confirmed-weak",
      decisive: true,
      lines: [
        "⚠ Phase 1 は 5s で落ちたが、Phase 2 は 5s 以内に成功した。",
        "   復帰が Phase 1 の試行で始まっていたため Phase 2 が短く出たと見られる。",
        "   Phase 1 が落ちた事実は、旧設定では落ちていたことを示す。",
      ],
    };
  } else if (p1.ok && wokeItOurselves) {
    verdict = {
      kind: "refuted",
      decisive: true,
      lines: [
        "❗ 推定を否定しうる結果。DB は休止していて、5 秒以内に復帰した可能性が高い。",
        `   postmaster の uptime が ${uptimeSec} 秒＝この測定の中で起動している。`,
        `   休止していたにもかかわらず Phase 1（5s）が ${(p1.ms / 1000).toFixed(2)}s で成功した。`,
        "",
        "   これが正しければ、6b25bed の「5秒では復帰を待ちきれず落ちていた」という",
        "   説明は成り立たない。30 秒に揃えた判断自体は単独で正しいが、",
        "   coe-tenant-isolation.md §12-2 の因果の記述は書き直しが要る",
        "   （/public/[slug] の描画エラーには別の原因がある）。",
        "",
        "   ⚠ 結論づける前に、同じ時刻の ServerlessDatabaseCapacity を 60 秒刻みで引き、",
        "     0 → 非0 の切り替わりが上の pg_postmaster_start_time と一致することを確かめること。",
      ],
    };
  } else if (p1.ok && p1.ms > 3_000) {
    verdict = {
      kind: "borderline",
      decisive: true,
      lines: [
        "⚠ 境界付近。5s 以内だが 3s 超で接続できた。",
        "   復帰中ではあったが今回はぎりぎり間に合った。5s が危険な設定だったことの傍証。",
      ],
    };
  } else if (p1.ok) {
    verdict = {
      kind: "skipped",
      decisive: false,
      lines: [
        "⏸ 測定として無効。DB は既に起きていた（即座に接続できた）。",
        uptimeSec !== null
          ? `   postmaster の uptime は ${uptimeSec} 秒（起動 ${jst(p2.extra.started)} JST）。` +
            "この測定より前に別の何かが DB を起こしている。"
          : "",
      ],
    };
  } else {
    verdict = {
      kind: "unreachable",
      decisive: true,
      lines: [
        "❌ 30s でも接続できない。休止復帰とは別の原因（到達性・SG・認証・停止）。",
        "   describe-db-clusters で Status を確認すること。",
      ],
    };
  }

  return { p1, p2, p3, uptimeSec, verdict };
}

function printFull(r) {
  console.log(line(r.p1));
  console.log(line(r.p2));
  console.log(line(r.p3));
  console.log("");
  if (r.p2.extra) {
    const mm = Math.floor(r.uptimeSec / 60);
    const ss = r.uptimeSec % 60;
    console.log("  DB 側の申告");
    console.log(`    server_version          : ${r.p2.extra.version}`);
    console.log(`    pg_postmaster_start_time: ${r.p2.extra.started.toISOString()}（${jst(r.p2.extra.started)} JST）`);
    console.log(`    uptime                  : ${r.uptimeSec} 秒（${mm}分${ss}秒）`);
    console.log("");
  }
  console.log("  判定");
  for (const l of r.verdict.lines) console.log(`    ${l}`);
  console.log("");
  if (r.p3.ok) {
    console.log(`  参考: 温まった後の接続は ${(r.p3.ms / 1000).toFixed(2)}s。`);
    console.log("");
  }
}

/**
 * PostgreSQL ログにある直近の接続（FATAL 行）の時刻をミリ秒で返す。
 * スキャナの接続は認証で落ちるので必ず FATAL として残る。
 * ⚠ 自分たちの正常な接続は FATAL にならないので、ここには出ない。
 *   よって「最後の接続」＝「最後のスキャナ接続」として扱っている。
 *   その間に正常な接続（本番サイト等）があれば休止はずれ、measure() が無効を返す。
 */
function latestFatalMs() {
  const out = execFileSync(
    "aws",
    [
      "logs", "filter-log-events",
      "--log-group-name", PG_LOG_GROUP,
      "--start-time", String(Date.now() - 20 * 60 * 1000),
      "--region", REGION,
      "--filter-pattern", "FATAL",
      "--query", "max_by(events, &timestamp).timestamp",
      "--output", "text",
      "--no-cli-pager",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (!out || out === "None" || out === "null") return null;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

async function sleepMs(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// ── 本体 ──────────────────────────────────────────────────────
console.log("");
console.log("Aurora 休止復帰の検証（読み取りのみ）");
console.log(`  ホスト : ${hostLabel}`);
console.log(`  開始   : ${new Date().toISOString()}（${jst(Date.now())} JST）`);
console.log("");
console.log("  ⚠ 自動一時停止は 300 秒。この間、本番サイトを開かないでください。");
console.log("");

if (waitMinutes > 0 && loopMinutes === null) {
  console.log(`  --wait ${waitMinutes}: DB に触れずに ${waitMinutes} 分待ってから測ります。`);
  await sleepMinutes(waitMinutes, "待機中");
}

if (syncMode) {
  console.log("  --sync: PostgreSQL ログから最後の接続を読み、その 300 秒後（休止直後）を狙います。");
  console.log("          スキャナは約 5.5 分周期なので、窓は 30〜40 秒。ずれたら次の周期で再試行。");
  console.log("");
  const MARGIN_MS = 8_000; // 休止判定の直後に少し余裕
  for (let n = 1; n <= maxAttempts; n++) {
    let last;
    try {
      last = latestFatalMs();
    } catch (e) {
      console.error("  aws logs の実行に失敗しました。aws CLI と認証情報を確認してください。");
      console.error("  " + String(e.message).split("\n")[0]);
      process.exit(1);
    }
    if (last === null) {
      console.log("  直近 20 分に FATAL が無い。60 秒待って再確認します。");
      await sleepMs(60_000);
      continue;
    }
    let target = last + AUTO_PAUSE_SEC * 1000 + MARGIN_MS;
    if (target < Date.now()) {
      // 窓を過ぎている（スキャナがもう戻っているはず）。次の FATAL を待つ
      process.stdout.write(`  [${n}/${maxAttempts}] 最後の接続 ${jst(last)} の窓は過ぎている。次の接続を待機…`);
      const seen = last;
      while (true) {
        await sleepMs(15_000);
        let now;
        try { now = latestFatalMs(); } catch { now = null; }
        if (now !== null && now > seen) { last = now; break; }
        process.stdout.write(".");
      }
      process.stdout.write("\n");
      target = last + AUTO_PAUSE_SEC * 1000 + MARGIN_MS;
    }
    const waitMs = target - Date.now();
    console.log(`  [${n}/${maxAttempts}] 最後の接続 ${jst(last)} → 休止見込み ${jst(last + AUTO_PAUSE_SEC * 1000)} → 測定 ${jst(target)}（${Math.round(waitMs / 1000)} 秒後）`);
    if (waitMs > 0) await sleepMs(waitMs);
    const r = await measure();
    if (r.verdict.decisive) {
      console.log("");
      printFull(r);
      process.exit(0);
    }
    const up = r.uptimeSec !== null ? `uptime ${r.uptimeSec}s` : "uptime 不明";
    console.log(`       → 無効（DB は起きていた・Phase1 ${(r.p1.ms / 1000).toFixed(2)}s・${up}）。次の周期へ。`);
  }
  console.log("");
  console.log(`  ${maxAttempts} 回とも窓に当たりませんでした。`);
  process.exit(0);
}

if (loopMinutes === null) {
  const r = await measure();
  printFull(r);
  if (!r.verdict.decisive) {
    console.log("  再実行の前に、CloudWatch で「今まさに 0 ACU か」を確認するか、");
    console.log("  --loop で自動的に繰り返してください: node scripts/probe-db-wakeup.mjs --loop");
    console.log("");
  }
  process.exit(0);
}

// --loop: 決着するまで繰り返す
console.log(`  --loop: ${loopMinutes} 分おきに最大 ${maxAttempts} 回まで測り、決着したら止まります。`);
console.log(`          最長 ${loopMinutes * maxAttempts} 分。Ctrl+C でいつでも止められます。`);
console.log("");

for (let n = 1; n <= maxAttempts; n++) {
  const r = await measure();
  const stamp = jst(Date.now());
  if (r.verdict.decisive) {
    console.log(`  [${n}/${maxAttempts}] ${stamp}  決着`);
    console.log("");
    printFull(r);
    process.exit(0);
  }
  const up = r.uptimeSec !== null ? `uptime ${r.uptimeSec}s（起動 ${jst(r.p2.extra.started)}）` : "uptime 不明";
  console.log(`  [${n}/${maxAttempts}] ${stamp}  無効（DB は起きていた・Phase1 ${(r.p1.ms / 1000).toFixed(2)}s・${up}）`);
  if (n < maxAttempts) await sleepMinutes(loopMinutes, `次の測定まで`);
}

console.log("");
console.log(`  ${maxAttempts} 回とも DB が起きていました。何かが常に DB を起こしています。`);
console.log("  ServerlessDatabaseCapacity（60 秒刻み）と Amplify の SSR ログで、");
console.log("  起動時刻に届いているリクエストを突き止めてください。");
console.log("");
