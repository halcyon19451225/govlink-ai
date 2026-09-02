#!/usr/bin/env node
/**
 * 評価報告書（CA2-5）の検査
 *
 * この検査を作った理由:
 *   ①報告書は**評価の記録を写すもの**で、判定をやり直さない。
 *     再計算や再判定がここに紛れ込むと、報告書と画面で数字が食い違う。
 *   ②承認済み評価は凍結値（indicator_snapshot）を印字し、未承認は「暫定」と明示すること。
 *     どちらか分からない文書が出回るのが、アカウンタビリティ上いちばん困る。
 *   ③様式は差し替え前提（踏襲様式の提供待ち）。様式の定義がデータ取得・描画から
 *     切り離されていること＝ reportTemplate.ts だけ替えれば済む状態を守る。
 *   ④表はAIに書かせない（PL2/PL3と同じ原則）。
 *
 * 使い方: node scripts/check-eval-report.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

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

const LIB = join(APP_ROOT, "src", "lib", "evaluation");
const tpl = read(join(LIB, "reportTemplate.ts"));
const data = read(join(LIB, "reportData.ts"));
const docx = read(join(LIB, "reportDocx.ts"));
const route = read(
  join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "evaluations", "[evalId]", "report", "route.ts"),
);

// ── 1. 様式（差し替え可能であること）─────────────
check("reportTemplate.ts がある", tpl.length > 0);
check("様式は差し替え前提だと明記している", /様式は差し替え前提/.test(tpl));
check("様式にDB接続やSQLを持ち込んでいない", !/from "@\/lib\/db"/.test(tpl) && !/SELECT /.test(tpl));
check("様式のバージョンを持つ（報告書に刷る）", /REPORT_FORM_VERSION/.test(tpl));

// ── 2. 材料（記録を写す・再判定しない）───────────
check("reportData.ts がある", data.length > 0);
check("凍結済みスナップショットを優先する", /indicator_snapshot/.test(data));
check("未凍結のときだけ現在値から組む", /indicators\.length === 0 && ev\.measure_design_id/.test(data));
check("判定をやり直さない（achievement の再計算を持ち込まない）",
  !/calcAchievement/.test(data) && !/isAchieved/.test(data));
check("判定経路は保存された flow_decision_path を写す", /flow_decision_path/.test(data));
check("システム判定の上書きを報告書に残す", /システム判定「/.test(data));

// ── 3. 描画（表は実データ・暫定の明示）───────────
check("reportDocx.ts がある", docx.length > 0);
check("様式とデータを受け取って描くだけ（SQLを持たない）",
  !/from "@\/lib\/db"/.test(docx) && !/SELECT /.test(docx));
check("未承認の報告書には【暫定】と刷る", /【暫定】/.test(docx));
check("凍結済みは凍結値である旨を注記する", /承認時点で凍結した値/.test(docx));
check("ページ番号を入れる", /PageNumber\.CURRENT/.test(docx));
check("フォントは名前参照のみ（埋め込まない）", /游明朝/.test(docx) && !/embed/i.test(docx));

// ── 4. 出力API ─────────────────────────────────
check("報告書ルートがある", route.length > 0);
check("認可を通す", /requireModulePermission/.test(route));
check("GETはプレビュー用のJSONを返す", /export async function GET/.test(route));
check("POSTはdocxを返す", /export async function POST/.test(route) && /wordprocessingml\.document/.test(route));
check("S3保存に失敗してもダウンロードは成立させる", /best-effort|ダウンロードは継続/.test(route));
check("AIを呼ばない（記録を写すだけ）", !/taskType|dialogueTurn|callGateway/.test(route));

// ── 5. 画面 ────────────────────────────────────
const workClient = read(
  join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "work-evaluation", "WorkEvaluationClient.tsx"),
);
const measureClient = read(
  join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "measure-evaluation", "MeasureEvaluationClient.tsx"),
);
check("取組評価から報告書を出せる", /📄 報告書/.test(workClient) && /downloadReport/.test(workClient));
check("主要施策評価から報告書を出せる", /📄 報告書/.test(measureClient) && /downloadReport/.test(measureClient));

// ── 6. 様式の中身（純粋関数として実行）───────────
const work = mkdtempSync(join(tmpdir(), "eval-report-"));
const outFile = join(work, "reportTemplate.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(LIB, "reportTemplate.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);

  const w = m.WORK_REPORT_FORM;
  const s = m.MEASURE_REPORT_FORM;
  check("取組評価報告書の様式がある", w.kind === "work" && w.sections.length >= 6);
  check("主要施策評価報告書の様式がある", s.kind === "measure" && s.sections.length >= 6);
  check("欄記号が重複しない",
    new Set(w.sections.map((x) => x.mark)).size === w.sections.length &&
    new Set(s.sections.map((x) => x.mark)).size === s.sections.length);
  check("すべての節に趣旨（記入要領）がある",
    w.sections.every((x) => x.note) && s.sections.every((x) => x.note));

  // アカウンタビリティ上、落としてはいけない節
  const wKinds = w.sections.flatMap((x) => x.blocks.map((b) => b.kind));
  check("取組評価報告書に指標実績・判定経路・委任がある",
    wKinds.includes("indicator_table") && wKinds.includes("path_table") && wKinds.includes("delegation_table"));
  const sKinds = s.sections.flatMap((x) => x.blocks.map((b) => b.kind));
  check("主要施策評価報告書に指標実績・判定経路・取組集約・委任がある",
    sKinds.includes("indicator_table") && sKinds.includes("path_table") &&
    sKinds.includes("work_rollup_table") && sKinds.includes("delegation_table"));
  check("主要施策評価報告書に処遇の節がある",
    s.sections.some((x) => x.heading.includes("処遇")));
  check("指標実績・判定経路は空でも省略しない（空欄で出す）",
    w.sections.every((x) => x.blocks.every((b) =>
      !["indicator_table", "path_table"].includes(b.kind) || b.omitWhenEmpty !== true)));
  check("formOf が種別で様式を引ける",
    m.formOf("work").kind === "work" && m.formOf("measure").kind === "measure");
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 7. docx スモーク（様式×ダミーデータで実際に組んでみる）────
// 「出力ボタンを押したら壊れていた」を防ぐ。実DBは要らない。
const work2 = mkdtempSync(join(tmpdir(), "eval-report-docx-"));
const bundleOut = join(APP_ROOT, "node_modules", ".check-eval-report.mjs");
const stub = join(work2, "server-only.mjs");
try {
  writeFileSync(stub, "export {}\n");
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(LIB, "reportDocx.ts"),
      "--bundle", "--format=esm", "--platform=node", "--target=node18",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--alias:server-only=${stub}`,
      "--external:docx",
      `--outfile=${bundleOut}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const mod = await import(pathToFileURL(bundleOut).href);
  const base = {
    subject: "W-1 取組", project_title: "計画", municipality: "団体",
    fiscal_year: 2026, status: "approved", approved_at: "2026-09-02",
    keyValues: [{ label: "計画", value: "計画" }],
    indicators: [{
      indicator_id: "i1", category_no: 5, measure_work_id: "w1", label: "実施回数", unit: "回",
      baseline_value: 0, target_value: 2, achievement_condition: "gte",
      result_value: 0, result_text: null, result_measured_on: "2026-09-02",
      result_source: "auto_tasks", result_fiscal_year: 2026, achieved: false,
      activity_rate: 0, activity_planned: 2, activity_completed: 0,
    }],
    path: [{ section: "1. 実施状況", question: "実施できましたか", answer: "予定どおり", note: "", overridden: "システム判定「実施できなかった」を担当者が変更" }],
    narrative: { findings: "所見", barrier_factors: "制約", improvement_actions: "改善策", next_steps: "引き継ぎ", result: "継続する" },
    delegations: [{ origin: "取組 W-1", title: "所掌の空白", detail: "", root_cause: "", status: "未対応（上位評価へ委任中）" }],
    workRollup: [], costs: [{ fiscal_year: "令和8年度", total: "¥350,000", funding: "一般財源 ¥350,000", note: "" }],
    benchmarks: [], activities: [{ title: "仕様書の改訂", planned: "1件", completed: "0件" }],
  };
  const isZip = (b) => b.length > 5000 && b[0] === 0x50 && b[1] === 0x4b;
  const wDoc = await mod.buildEvaluationReportDocx({ ...base, kind: "work", frozen: true });
  check("取組評価報告書のdocxが組める（有効なZIP）", isZip(wDoc));
  const mDoc = await mod.buildEvaluationReportDocx({
    ...base, kind: "measure", frozen: false,
    workRollup: [{ code: "W-1", title: "取組", fiscal_year: "令和8年度", status: "承認済み", result: "継続" }],
    benchmarks: [{ indicator: "乖離率", comparator: "全国平均", value: "8%", own: "—", fiscal_year: "令和8年度", source: "事業状況報告" }],
  });
  check("主要施策評価報告書のdocxが組める（有効なZIP）", isZip(mDoc));
  // 空データでも落ちない（評価直後・指標未設定の計画）
  const empty = await mod.buildEvaluationReportDocx({
    ...base, kind: "work", frozen: false,
    indicators: [], path: [], delegations: [], costs: [], activities: [],
    narrative: { findings: "", barrier_factors: "", improvement_actions: "", next_steps: "", result: "" },
  });
  check("材料が空でも報告書が組める", isZip(empty));
} finally {
  rmSync(work2, { recursive: true, force: true });
  rmSync(bundleOut, { force: true });
}

console.log(`check-eval-report: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
