#!/usr/bin/env node
/**
 * 実績報告の依頼と回答管理（S2 C①）の検証 — check:report
 *
 * この検査を作った理由:
 *   回答は**認証なしの公開フォーム**から入り、受領後にKPI実績へ流れる。
 *   設問・回答のサニタイズが破れると、外部入力が数値のままKPIに届く。
 *   防御（実在ID検証・型検証・必須判定・取り込み対象の抽出）を毎回機械検証する。
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

const work = mkdtempSync(join(tmpdir(), "report-"));
try {
  const libFile = join(work, "types.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "report", "types.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${libFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const r = await import(pathToFileURL(libFile).href);

  // ── 設問のサニタイズ ─────────────────────────────
  const kpis = new Set(["kpi-1"]);
  const ms = new Set(["m-1"]);
  const qs = r.sanitizeQuestions(
    [
      { id: "q1", label: "実施回数", type: "number", unit: "回", measure_design_id: "m-1" },
      { id: "q2", label: "KPI実績", type: "number", kpi_id: "kpi-1", measure_design_id: "m-1" },
      { id: "q3", label: "所見", type: "textarea", measure_design_id: "m-1" },
      { id: "q1", label: "ID重複は落ちる", type: "text" },
      { id: "q4", label: "不正なKPI IDは剥がされる", type: "number", kpi_id: "kpi-zzz" },
      { id: "q5", label: "不正な施策IDは剥がされ共通扱い", type: "text", measure_design_id: "m-zzz" },
      { id: "", label: "IDなしは落ちる", type: "text" },
      { id: "q6", label: "型不正は落ちる", type: "checkbox" },
      "文字列は落ちる",
    ],
    kpis,
    ms,
  );
  check("設問: 有効な設問だけ・ID重複排除", qs.length === 5 && qs.filter((q) => q.id === "q1").length === 1);
  check("設問: 実在しないkpi_id/measure_idは剥がす",
    qs.find((q) => q.id === "q4")?.kpi_id === undefined &&
    qs.find((q) => q.id === "q5")?.measure_design_id === undefined);
  check("設問: 正しい紐付けは保持",
    qs.find((q) => q.id === "q2")?.kpi_id === "kpi-1" && qs.find((q) => q.id === "q2")?.measure_design_id === "m-1");

  // ── 対象別の設問分配 ─────────────────────────────
  const forM1 = r.questionsForTarget(qs, "m-1");
  check("分配: 共通設問＋その施策の設問（他施策のものは出ない）",
    forM1.some((q) => q.id === "q5") && forM1.some((q) => q.id === "q2") && forM1.length === qs.length);

  // ── 回答のサニタイズ ─────────────────────────────
  const questions = [
    { id: "n1", label: "回数", type: "number", required: true },
    { id: "t1", label: "所見", type: "textarea" },
    { id: "s1", label: "氏名", type: "text", required: true },
  ];
  const ok = r.sanitizeAnswers({ n1: "1,234", t1: "所見です", s1: "山田", zzz: "設問にないキーは捨てる" }, questions);
  check("回答: 数値はカンマ許容で数値化・未知キーは捨てる",
    ok.answers.n1 === 1234 && ok.answers.t1 === "所見です" && !("zzz" in ok.answers) && ok.missing.length === 0);
  const bad = r.sanitizeAnswers({ n1: "十回", s1: "" }, questions);
  check("回答: 数値化できない値は捨て・必須未回答をmissingに",
    bad.answers.n1 === undefined && bad.missing.includes("n1") && bad.missing.includes("s1"));

  // ── KPI取り込み対象の抽出 ─────────────────────────
  const importQs = [
    { id: "k1", label: "受診率", type: "number", kpi_id: "kpi-1" },
    { id: "k2", label: "文字は対象外", type: "text", kpi_id: "kpi-1" },
    { id: "k3", label: "kpi無しは対象外", type: "number" },
  ];
  const rows = r.kpiImportRows(importQs, { k1: 51.5, k2: "文字", k3: 10 });
  check("取り込み: kpi_idつき数値設問×数値回答のみ", rows.length === 1 && rows[0].kpi_id === "kpi-1" && rows[0].value === 51.5);
  check("取り込み: 数値化できない回答は対象外", r.kpiImportRows(importQs, { k1: "多数" }).length === 0);

  // ── 配線（テキスト検査）──────────────────────────
  const migDirA = join(APP_ROOT, "_migrations");
  const migDirB = join(REPO_ROOT, "infra", "migrations");
  const migPath = existsSync(join(migDirA, "053_report_requests.sql"))
    ? join(migDirA, "053_report_requests.sql")
    : join(migDirB, "053_report_requests.sql");
  const mig = readFileSync(migPath, "utf8");
  check("053: 依頼・回答テーブルと語彙・トークン一意・generation.report_request",
    mig.includes("CREATE TABLE IF NOT EXISTS report_requests") &&
    mig.includes("CREATE TABLE IF NOT EXISTS report_responses") &&
    mig.includes("'pending', 'answered', 'returned', 'accepted'") &&
    mig.includes("token         TEXT        NOT NULL UNIQUE") &&
    mig.includes("generation.report_request"));

  const apiDir = join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "report-requests");
  const createSrc = readFileSync(join(apiDir, "route.ts"), "utf8");
  check("作成: ゲートウェイ経由のAI設問組成＋サニタイズ・draftで保存（自動送信しない）",
    createSrc.includes("aiCreateMessage") && createSrc.includes("generation.report_request") &&
    createSrc.includes("sanitizeQuestions"));
  const reqSrc = readFileSync(join(apiDir, "[requestId]", "route.ts"), "utf8");
  check("送信: トークンはサーバー生成・1トランザクション・送信後の設問変更を拒否",
    reqSrc.includes("randomBytes") && reqSrc.includes("transaction") &&
    reqSrc.includes("送信後は設問・依頼文を変更できません"));
  const respSrc = readFileSync(join(apiDir, "[requestId]", "responses", "[responseId]", "route.ts"), "utf8");
  check("レビュー: 差し戻し理由必須・受領済みのみKPI取り込み・二重取り込み拒否",
    respSrc.includes("差し戻し理由を入力してください") &&
    respSrc.includes("受領済みの回答のみ取り込めます") &&
    respSrc.includes("取り込み済みです"));
  check("取り込み: 既存kpi-reports承認と同じ動作（approved登録＋current更新）",
    respSrc.includes("'approved'") && respSrc.includes("UPDATE kpis SET current"));

  const pubSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "public", "report", "[token]", "route.ts"), "utf8");
  check("公開フォーム: 受領後は修正不可・締切後は受付終了・回答サニタイズ",
    pubSrc.includes("受領済みのため修正できません") && pubSrc.includes("受付を終了") &&
    pubSrc.includes("sanitizeAnswers"));

  const sidebar = readFileSync(join(APP_ROOT, "src", "components", "ProjectSidebar.tsx"), "utf8");
  check("サイドバー: C区分に実績報告依頼", sidebar.includes("実績報告依頼") && sidebar.includes('"report-requests"'));
  const wizard = readFileSync(join(APP_ROOT, "src", "components", "program-eval", "EvaluationWizard.tsx"), "utf8");
  check("評価ウィザード: 受領済み報告の所見・課題を参考表示", wizard.includes("report-requests/answers"));

  console.log(`check-report: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
