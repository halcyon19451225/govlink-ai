#!/usr/bin/env node
/**
 * Libera連携（S3 D②段2＋C①タスク通知）の検証 — check:libera
 *
 * この検査を作った理由:
 *   ブリッジは**別リポジトリ（Libera）のDBへ直接書く**ため、sourceId の規約が
 *   崩れると冪等性が壊れて相手側に二重登録が起きる。ペイロードの決定性・
 *   ID規約（英数ハイフン80字以内 = Libera側 coeBridge の検証と同一）を毎回機械検証する。
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

const work = mkdtempSync(join(tmpdir(), "libera-"));
try {
  const libFile = join(work, "payload.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "libera", "payload.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${libFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const p = await import(pathToFileURL(libFile).href);

  const SUB = "12345678-abcd-4000-8000-1234567890ab";
  const SRC_RE = /^[A-Za-z0-9_-]{1,80}$/; // Libera側 coeBridge の sourceId 検証と同一

  // ── 予定の組み立て ───────────────────────────────
  const events = p.buildScheduleEvents(
    SUB,
    [
      { id: "11111111-1111-1111-1111-111111111111", title: "健診の周知開始", due_date: "2026-10-01", owner_department: "健康推進課", measure_title: "受診勧奨", completed: false },
      { id: "22222222-2222-2222-2222-222222222222", title: "完了済みタスク", due_date: "2026-04-01", owner_department: null, measure_title: null, completed: true },
      { id: "33333333-3333-3333-3333-333333333333", title: "期限なしは送らない", due_date: null, owner_department: null, measure_title: null, completed: false },
    ],
    [{ id: "44444444-4444-4444-4444-444444444444", name: "年次評価", phase: "C", scheduled_date: "2026-11-01", completed: false }],
    "検証計画",
  );
  check("予定: 期限つきタスク＋チェックポイントのみ（期限なしは除外）", events.length === 3);
  check("予定: sourceId は行UUID起点の決定的な値でID規約に適合",
    events[0].sourceId === "task-11111111-1111-1111-1111-111111111111" &&
    events.every((e) => SRC_RE.test(e.sourceId)));
  check("予定: 完了は✓接頭辞で送り続ける（消さない）",
    events.some((e) => e.title.startsWith("✓ ")));
  check("予定: 終日・JST・説明に施策/担当/プロジェクト",
    events[0].allDay === true && events[0].start === "2026-10-01T00:00:00+09:00" &&
    events[0].description.includes("施策: 受診勧奨") && events[0].description.includes("担当: 健康推進課"));
  check("予定: 同一入力→同一出力（決定的）",
    JSON.stringify(events) === JSON.stringify(p.buildScheduleEvents(
      SUB,
      [
        { id: "11111111-1111-1111-1111-111111111111", title: "健診の周知開始", due_date: "2026-10-01", owner_department: "健康推進課", measure_title: "受診勧奨", completed: false },
        { id: "22222222-2222-2222-2222-222222222222", title: "完了済みタスク", due_date: "2026-04-01", owner_department: null, measure_title: null, completed: true },
        { id: "33333333-3333-3333-3333-333333333333", title: "期限なしは送らない", due_date: null, owner_department: null, measure_title: null, completed: false },
      ],
      [{ id: "44444444-4444-4444-4444-444444444444", name: "年次評価", phase: "C", scheduled_date: "2026-11-01", completed: false }],
      "検証計画",
    )));

  // ── タスクの組み立て ─────────────────────────────
  const tasks = p.buildScheduleTasks(
    SUB,
    [
      { id: "11111111-1111-1111-1111-111111111111", title: "未完了", due_date: "2026-10-01", owner_department: null, measure_title: null, completed: false },
      { id: "22222222-2222-2222-2222-222222222222", title: "完了済みは送らない", due_date: "2026-04-01", owner_department: null, measure_title: null, completed: true },
    ],
    "検証計画",
  );
  check("タスク: 未完了・期限つきのみ（完了操作を尊重）", tasks.length === 1 && tasks[0].dueAt === "2026-10-01T00:00:00+09:00");

  // ── 実績報告のタスク通知 ─────────────────────────
  const notify = p.buildReportTasks(SUB, {
    requestId: "55555555-5555-5555-5555-555555555555",
    requestTitle: "2026年度 実績報告のお願い",
    dueDate: "2026-12-01",
    targets: [{ target_key: "66666666-6666-6666-6666-666666666666", measure_title: "受診勧奨", url: "https://example.com/report/tok" }],
  });
  check("報告通知: 依頼×対象で決定的なsourceId・URL入りnote・期限つきHIGH",
    notify.length === 1 && SRC_RE.test(notify[0].sourceId) &&
    notify[0].note.includes("https://example.com/report/tok") &&
    notify[0].priority === "HIGH" && notify[0].dueAt === "2026-12-01T00:00:00+09:00");
  check("日付: 不正な日付はnull（送らない）", p.dateToIso("2026/10/01") === null && p.dateToIso("あ") === null);

  // ── 配線（テキスト検査）──────────────────────────
  const migDirA = join(APP_ROOT, "_migrations");
  const migDirB = join(REPO_ROOT, "infra", "migrations");
  const migPath = existsSync(join(migDirA, "054_libera_bridge.sql"))
    ? join(migDirA, "054_libera_bridge.sql")
    : join(migDirB, "054_libera_bridge.sql");
  const mig = readFileSync(migPath, "utf8");
  check("054: 送信先（メール×sub）と連携ログ（冪等）",
    mig.includes("CREATE TABLE IF NOT EXISTS libera_bridge_targets") &&
    mig.includes("CREATE TABLE IF NOT EXISTS libera_bridge_logs") &&
    mig.includes("UNIQUE (project_id, email)"));

  const bridgeSrc = readFileSync(join(APP_ROOT, "src", "lib", "libera", "bridge.ts"), "utf8");
  check("クライアント: 共有鍵ヘッダ・未設定検出・100件分割",
    bridgeSrc.includes("x-bridge-key") && bridgeSrc.includes("isBridgeConfigured") && bridgeSrc.includes("i += 100"));
  const cogSrc = readFileSync(join(APP_ROOT, "src", "lib", "libera", "cognito.ts"), "utf8");
  check("sub解決: AdminGetUser＋曖昧（2件以上）は解決しない",
    cogSrc.includes("AdminGetUserCommand") && cogSrc.includes("users.length !== 1"));
  const apiSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "libera", "route.ts"), "utf8");
  check("API: 送信は宛先ごとにsourceIdへ宛先suffixを混ぜる（宛先間のID衝突防止）",
    apiSrc.includes("suffix") && apiSrc.includes("libera_bridge_logs"));
  check("API: 実績報告通知は未回答/差し戻しのみ・受付中のみ",
    apiSrc.includes('"pending" || r.status === "returned"') && apiSrc.includes('"sent"'));
  const schedClient = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "schedule", "ScheduleClient.tsx"), "utf8");
  check("画面: Libera連携カード（未設定時は案内・設定済みで送信先/送信/ログ）",
    schedClient.includes("LiberaBridgeCard") && schedClient.includes("LIBERA_BRIDGE_URL"));
  const reportClient = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "report-requests", "ReportRequestsClient.tsx"), "utf8");
  check("画面: 実績報告の「Liberaで通知」", reportClient.includes("notify_report"));

  const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
  check("package.json: check:libera 連鎖", String(pkg.scripts?.check ?? "").includes("check:libera"));

  console.log(`check-libera: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
