#!/usr/bin/env node
/**
 * 指標の実績値・ベンチマーク・課題の委任（058 — CA2-1）の検査
 *
 * この検査を作った理由:
 *   ①実績は履歴で持つ（上書きしない）ことが設計の柱。上書き型に退行すると
 *     承認済み評価の凍結（indicator_snapshot）が根拠を失う。
 *   ②auto_computed（自動集計値の印）は「手で直すと外れる」規約（auto_filled と同じ）。
 *     この規約が崩れると、画面の「自動」表示が嘘になる。
 *   ③承認時に凍結された自動集計値（source='auto_tasks'）は消せないこと。
 *   ④ベンチマークは出典（source_name）必須であること。
 *   ⑤No.5実施率の分母は「スケジュール反映と同じ展開計算」で数えること。
 *     別の計算式を持つと、反映したタスク数と計画値が食い違う。
 *
 * 使い方: node scripts/check-eval-results.mjs
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
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// ── 1. マイグレーション 058 ─────────────────────
const mig = join(REPO_ROOT, "infra", "migrations", "058_evaluation_results.sql");
check("058_evaluation_results.sql が存在する", existsSync(mig));
if (existsSync(mig)) {
  const sql = read(mig);
  for (const t of ["measure_indicator_results", "measure_indicator_benchmarks", "evaluation_delegations"]) {
    check(`058 が ${t} を作る`, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(sql));
  }
  check("058 は冪等（IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）",
    !/CREATE TABLE (?!IF NOT EXISTS)/.test(sql) && !/ADD COLUMN (?!IF NOT EXISTS)/.test(sql));
  check("058: 実績の出所は4種に限る",
    /source IN \('manual', 'auto_tasks', 'report_request', 'import'\)/.test(sql));
  check("058: 自動集計の印を持つ", /auto_computed\s+BOOLEAN/.test(sql));
  check("058: ベンチマークは出典必須",
    /source_name\s+TEXT\s+NOT NULL/.test(sql));
  check("058: 委任は二段（図6→図7、図7→次期計画）",
    /level IN \('to_measure', 'to_next_plan'\)/.test(sql));
  check("058: 委任の状態語彙", /status IN \('open', 'addressed', 'carried_over'\)/.test(sql));
  check("058: 評価の単位を取組まで下ろす",
    /program_evaluations[\s\S]*?measure_work_id UUID REFERENCES measure_works/.test(sql));
  check("058: 指標凍結の器がある", /indicator_snapshot JSONB/.test(sql));
  check("058: 改善の反映先5系統目", /reflect_measure_design_id/.test(sql));
  check("058: PDCA自動完了の痕跡", /completed_by_evaluation_id/.test(sql));
  // ランナー（run-migration.mjs）が全体をトランザクションで囲む。
  // ファイル側に BEGIN/COMMIT を書くと二重になり、先に確定してロールバック保証が消える
  check("058: 自前のトランザクションで囲まない", !/^BEGIN;/m.test(sql) && !/^COMMIT;/m.test(sql));
}

// ── 2. API ルート ──────────────────────────────
const datasetDir = join(
  APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
  "measure-design", "[measureId]", "dataset",
);
const resultsRoute = read(join(datasetDir, "results", "route.ts"));
check("results ルートが存在する", resultsRoute.length > 0);
check("results: 認可を通す", /requireModulePermission/.test(resultsRoute));
check("results: 他計画の指標に書けない（指標の帰属を確かめる）",
  /project_id = \$2 AND measure_design_id = \$3/.test(resultsRoute));
check("results: 凍結済みの自動集計値は消せない",
  /source <> 'auto_tasks'/.test(resultsRoute));
check("results: 手で直すと auto_computed が外れる",
  /auto_computed = CASE WHEN/.test(resultsRoute));
check("results: 登録は履歴（INSERT。既存行のUPSERTをしない）",
  /INSERT INTO measure_indicator_results/.test(resultsRoute) && !/ON CONFLICT/.test(resultsRoute));

const benchRoute = read(join(datasetDir, "benchmarks", "route.ts"));
check("benchmarks ルートが存在する", benchRoute.length > 0);
check("benchmarks: 出典必須（zodで必須文字列）", /source_name: z\.string\(\)\.min\(1\)/.test(benchRoute));
check("benchmarks: 認可を通す", /requireModulePermission/.test(benchRoute));

const rateRoute = read(join(datasetDir, "activity-rate", "route.ts"));
check("activity-rate ルートが存在する", rateRoute.length > 0);
check("activity-rate: 実体化しない（オンデマンド計算のみ）",
  !/INSERT INTO measure_indicator_results/.test(rateRoute));

// ── 3. 画面 ───────────────────────────────────
const panel = read(join(APP_ROOT, "src", "components", "measure", "MeasureDatasetPanel.tsx"));
check("データセット画面に実績列がある", panel.includes(">実績</th>"));
check("実績の記入・履歴モーダルがある", /function ResultModal\(/.test(panel));
check("画面は履歴で持つ旨を担当者に伝える", panel.includes("実績は履歴で残ります"));

// ── 4. 純粋関数（実施率の計算部） ────────────────
const work = mkdtempSync(join(tmpdir(), "eval-results-"));
const outFile = join(work, "activityMath.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "evaluation", "activityMath.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);

  check("年度の窓は4月始まり", m.fiscalYearWindow(2026).start === "2026-04-01"
    && m.fiscalYearWindow(2026).end === "2027-03-31");
  check("3月31日は前年度に入る", m.inFiscalYear("2027-03-31", 2026) && !m.inFiscalYear("2027-04-01", 2026));

  const annual = {
    id: "a1", measure_work_id: "w1", title: "運営協議会で未達検証", note: null,
    start_date: null, due_date: "2026-07-01", recurrence: "annual", occurrences: 4,
    owner_department: null, document_required: false, document_deadline: null,
    document_offset_days: null, sort_order: 0,
  };
  const single = {
    id: "a2", measure_work_id: "w1", title: "仕様書に明記", note: null,
    start_date: null, due_date: "2026-06-30", recurrence: "none", occurrences: null,
    owner_department: null, document_required: false, document_deadline: null,
    document_offset_days: null, sort_order: 1,
  };
  const noDue = { ...single, id: "a3", title: "期限未定", due_date: null };

  // 毎年度×4回は各年度に1件ずつ落ちる → 初年度の計画は annual 1 + single 1 = 2
  const y1 = m.plannedCountInYear([annual, single, noDue], 4, 2026);
  check("初年度の計画件数（毎年度1件＋単発1件）", y1.planned === 2);
  // 2年目は annual の2回目だけ
  const y2 = m.plannedCountInYear([annual, single, noDue], 4, 2027);
  check("2年目は繰り返し分だけ", y2.planned === 1 && y2.byActivity[0].activity_id === "a1");
  check("期限の無いアクティビティは分母に入れない",
    !y1.byActivity.some((b) => b.activity_id === "a3"));
  // 展開計算がスケジュール反映（planTasks）と同一であること — 月末丸めの挙動で確かめる
  const monthly = { ...annual, id: "a4", due_date: "2027-01-31", recurrence: "monthly", occurrences: 3 };
  const y3 = m.plannedCountInYear([monthly], 4, 2026);
  check("月末は丸める（1/31→2/28→3/31 の3件が同一年度）", y3.planned === 3);

  // 計画年数はJSで数える（SQLの日付演算は型混在で500を出した — 2026-09-02）
  check("計画年数: 2024-04〜2027-03 は3年", m.planYearsBetween("2024-04-01", "2027-03-31") === 3);
  check("計画年数: 終了日なしは1年", m.planYearsBetween("2026-04-01", null) === 1);
  check("計画年数: 逆転や不正は安全側", m.planYearsBetween("2026-04-01", "2025-01-01") === 1
    && m.planYearsBetween("bad", null) === 3);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 5. サーバー集計の規約 ─────────────────────────
const stats = read(join(APP_ROOT, "src", "lib", "evaluation", "activityStats.ts"));
check("activityStats が存在する", stats.length > 0);
check("分子は schedule_tasks.completed_at から数える",
  /completed_at IS NOT NULL/.test(stats));
check("分母0のとき rate は null（0%と区別）", /rate: planned > 0 \?/.test(stats));
check("年数の算出はSQLでなくJS（planYearsBetween）", /planYearsBetween\(/.test(stats) && !/CEIL\((?!interval\))/.test(stats));
check("計算部（純粋関数）は activityMath に分離",
  /from "\.\/activityMath"/.test(stats));

console.log(`check-eval-results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
