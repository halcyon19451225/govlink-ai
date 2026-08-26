#!/usr/bin/env node
/**
 * スケジュール強化（S1 D①・D②段1）の検証 — check:schedule
 *
 * この検査を作った理由:
 *   ICSはバイト単位の折返し・エスケープ規約（RFC 5545）を持ち、壊れていても
 *   ブラウザでは見えない（購読側のカレンダーで初めて壊れる）。純関数で毎回検証する。
 *   進捗ボードの四半期計算（年度区切り）と期限超過判定も同様に機械検証する。
 *
 * 検査対象:
 *   1. ICS（lib/schedule/ics.ts）… エスケープ・75オクテット折返し・カレンダー構造・決定性
 *   2. 進捗ボードの純関数（ScheduleClient から export）… 年度四半期・期限超過判定
 *   3. 配線 … 052 / 生成ルートの実データ接続 / フィードルート / トークン管理 / 完了率表示
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const work = mkdtempSync(join(tmpdir(), "schedule-"));
try {
  // ── 1. ICS ──────────────────────────────────────────────
  const icsFile = join(work, "ics.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "schedule", "ics.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${icsFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const ics = await import(pathToFileURL(icsFile).href);

  check("escape: \\ ; , 改行", ics.icsEscape("a;b,c\\d\ne") === "a\\;b\\,c\\\\d\\ne");
  check("date: YYYY-MM-DD→YYYYMMDD・不正はnull",
    ics.icsDate("2026-08-26") === "20260826" && ics.icsDate("2026/08/26") === null && ics.icsDate("あ") === null);

  // 折返し: 75オクテット以内・継続行は先頭スペース・UTF-8のバイト数で数える
  const longJa = "SUMMARY:" + "日本語の長いタスク名".repeat(10);
  const folded = ics.foldLine(longJa);
  const foldedLines = folded.split("\r\n");
  const enc = new TextEncoder();
  check("fold: 全行75オクテット以内",
    foldedLines.every((l) => enc.encode(l).length <= 75));
  check("fold: 継続行は先頭スペース", foldedLines.length > 1 && foldedLines.slice(1).every((l) => l.startsWith(" ")));
  check("fold: 復元すると元に戻る", foldedLines.map((l, i) => (i === 0 ? l : l.slice(1))).join("") === longJa);
  check("fold: 短い行はそのまま", ics.foldLine("SUMMARY:短い") === "SUMMARY:短い");

  const cal = ics.buildIcsCalendar(
    "Coe: 検証計画",
    [
      { uid: "task-abc", date: "2026-10-01", summary: "健診の周知; 開始", description: "担当: 健康推進課\nメモ", completed: false, category: "Coeタスク" },
      { uid: "checkpoint-xyz", date: "2027-06-15", summary: "✓ 【Coe/C】年次評価", completed: true },
      { uid: "bad-date", date: "not-a-date", summary: "落とされる" },
    ],
    "20260826T000000Z",
  );
  check("calendar: VCALENDAR/VEVENT 構造と終日イベント",
    cal.startsWith("BEGIN:VCALENDAR\r\n") && cal.trimEnd().endsWith("END:VCALENDAR") &&
    (cal.match(/BEGIN:VEVENT/g) ?? []).length === 2 &&
    cal.includes("DTSTART;VALUE=DATE:20261001") && cal.includes("DTEND;VALUE=DATE:20261002"));
  check("calendar: 不正日付の行は防御的に飛ばす", !cal.includes("落とされる"));
  check("calendar: エスケープが効く（; がそのまま出ない）", cal.includes("健診の周知\\; 開始"));
  check("calendar: UIDは決定的・DTSTAMP固定で同一出力",
    cal.includes("UID:task-abc@coe.schedule") &&
    cal === ics.buildIcsCalendar("Coe: 検証計画",
      [
        { uid: "task-abc", date: "2026-10-01", summary: "健診の周知; 開始", description: "担当: 健康推進課\nメモ", completed: false, category: "Coeタスク" },
        { uid: "checkpoint-xyz", date: "2027-06-15", summary: "✓ 【Coe/C】年次評価", completed: true },
        { uid: "bad-date", date: "not-a-date", summary: "落とされる" },
      ], "20260826T000000Z"));
  check("calendar: 完了はSTATUS:COMPLETEDでなくX-COE-DONE（VEVENTにCOMPLETEDは無い）",
    !cal.includes("STATUS:COMPLETED") && cal.includes("X-COE-DONE:TRUE"));
  check("calendar: 月末の翌日繰り上がり（DTENDが翌月1日）",
    ics.buildIcsCalendar("t", [{ uid: "u", date: "2026-12-31", summary: "s" }], "20260826T000000Z")
      .includes("DTEND;VALUE=DATE:20270101"));

  // ── 2. 進捗ボードの純関数（lib/schedule/board.ts が正本）──
  const boardFile = join(work, "board.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "schedule", "board.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${boardFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const sc = await import(pathToFileURL(boardFile).href);

  check("四半期: 年度区切り（4月=Q1・2月=前年度Q4）",
    sc.fiscalQuarterKey("2026-04-15") === "2026Q1" &&
    sc.fiscalQuarterKey("2026-12-01") === "2026Q3" &&
    sc.fiscalQuarterKey("2027-02-01") === "2026Q4");
  check("四半期: 範囲列挙が年度をまたぐ",
    JSON.stringify(sc.quarterRange("2026-10-01", "2027-05-01")) === '["2026Q3","2026Q4","2027Q1"]');
  check("四半期: ラベル", sc.quarterLabel("2026Q1") === "2026年度Q1（4〜6月）");
  const past = "2000-01-01";
  const future = "2999-01-01";
  check("期限超過: 未完了×期限過ぎのみ（完了・期限内・期限なしは除外）",
    sc.taskState({ due_date: past, completed_at: null }) === "overdue" &&
    sc.taskState({ due_date: past, completed_at: "2000-01-02" }) === "done" &&
    sc.taskState({ due_date: future, completed_at: null }) === "pending" &&
    sc.taskState({ due_date: null, completed_at: null }) === "pending");

  // ── 3. 配線（テキスト検査）──────────────────────────────
  const migDirA = join(APP_ROOT, "_migrations");
  const migDirB = join(REPO_ROOT, "infra", "migrations");
  const migPath = existsSync(join(migDirA, "052_schedule_feed.sql"))
    ? join(migDirA, "052_schedule_feed.sql")
    : join(migDirB, "052_schedule_feed.sql");
  const mig = readFileSync(migPath, "utf8");
  check("052: schedule_tasks列追加とトークンテーブル（冪等）",
    mig.includes("ADD COLUMN IF NOT EXISTS measure_design_id") &&
    mig.includes("ADD COLUMN IF NOT EXISTS owner_department") &&
    mig.includes("CREATE TABLE IF NOT EXISTS schedule_feed_tokens") &&
    mig.includes("token       TEXT        NOT NULL UNIQUE"));

  const genSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "ai", "generate-schedule", "route.ts"), "utf8");
  check("生成: 確定済み施策のG区画・実験設計・チェックポイントを入力に接続",
    genSrc.includes("status = 'confirmed'") && genSrc.includes("milestones") &&
    genSrc.includes("experiment") && genSrc.includes("project_pdca_checkpoints"));
  check("生成: タスクをmeasure_design_id/owner_departmentつきで保存（範囲外indexは防御）",
    genSrc.includes("measure_design_id") && genSrc.includes("measure_index") &&
    genSrc.includes("mi >= 1 && mi <= measures.length"));

  const feedSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "public", "schedule-feed", "[token]", "route.ts"), "utf8");
  check("フィード: token能力方式・失効チェック・.ics許容・タスク＋チェックポイント配信",
    feedSrc.includes("revoked_at IS NULL") && feedSrc.includes('replace(/\\.ics$/i') &&
    feedSrc.includes("buildIcsCalendar") && feedSrc.includes("project_pdca_checkpoints") &&
    feedSrc.includes("text/calendar"));
  const tokSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "schedule-feed", "route.ts"), "utf8");
  check("トークン発行: サーバー生成（randomBytes）・上限つき", tokSrc.includes("randomBytes") && tokSrc.includes(">= 20"));

  const clientSrc = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "schedule", "ScheduleClient.tsx"), "utf8");
  check("画面: 進捗ボード・改善バッジ・カレンダー連携カード",
    clientSrc.includes("ProgressBoard") && clientSrc.includes("🔧") && clientSrc.includes("CalendarFeedCard"));
  const pdcaSrc = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "pdca", "PdcaDashboardClient.tsx"), "utf8");
  check("PDCAダッシュボード: チェックポイント完了率を併記（日数経過率のみを解消）",
    pdcaSrc.includes("チェックポイント完了率"));

  const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
  check("package.json: check:schedule 連鎖", String(pkg.scripts?.check ?? "").includes("check:schedule"));

  console.log(`check-schedule: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
