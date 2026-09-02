#!/usr/bin/env node
/**
 * 取組評価（図6v2 — CA2-2）の検査
 *
 * この検査を作った理由:
 *   ①図6v2 は「指標が無い工程は自動スキップ」で成立している。スキップの規則が壊れると、
 *     指標を設定していない自治体で評価フローが止まる（設計の柱「止まるものだけ必須」の工程版）。
 *   ②委任（evaluation_delegations）は図6→図7の唯一の受け渡し路。起票の level と
 *     消化の状態語彙が揃っていないと、課題が主要施策評価に届かない。
 *   ③承認の副作用（指標凍結・No.5実体化・PDCA自動完了）は初回承認だけ。
 *     再承認で数字が動いたり、二重に実績が入ったりしないこと。
 *   ④旧プログラム評価の画面に図6v2 が漏れ出ないこと（専用メニューで実施する）。
 *
 * 使い方: node scripts/check-eval-flow.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
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

// ── 1. フロー定義（純粋関数として実行して確かめる） ─────────
const work = mkdtempSync(join(tmpdir(), "eval-flow-"));
const outFile = join(work, "flow.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "evaluation", "flow.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);
  const f = m.FIG6V2;

  check("FIG6V2 が定義されている", f && f.key === "fig6v2");
  check("tier は outcome_initial（年次・取組）", f.tier === "outcome_initial");
  check("年次を直書きしない（評価時点の設定に従う）",
    !f.cycleNote.includes("6月") && !f.cycleNote.includes("2年目"));

  // 工程の存在（設計 §5: 強化版工程＋委任）
  for (const id of [
    "structure_ok", "implemented", "impl_barrier", "reach_ok", "target_met",
    "gap_cause", "outcome_initial_met", "attributable", "cost_check",
    "next_action", "improvement", "delegation",
  ]) {
    check(`工程 ${id} がある`, Boolean(f.steps[id]));
  }

  // 指標前提の工程タグ
  check("工程0（体制）は No.4 が前提", (f.steps.structure_ok.requiresIndicator ?? []).join() === "4");
  check("工程2b（到達と質）は No.10・11 が前提",
    (f.steps.reach_ok.requiresIndicator ?? []).join() === "10,11");

  // 自動判定の材料
  check("工程1は No.5 実施率の自動集計", f.steps.implemented.autoSource === "activity_rate");
  check("工程2は No.6 の実績 vs 目標",
    f.steps.target_met.autoSource === "indicator" && f.steps.target_met.autoIndicator === 6);
  check("工程3は No.7 の実績 vs 目標",
    f.steps.outcome_initial_met.autoSource === "indicator" && f.steps.outcome_initial_met.autoIndicator === 7);

  // 帰属（工程4）の暫定P判定 — 図の逃げ道をそのまま持つ
  check("帰属に暫定P判定の選択肢がある",
    f.steps.attributable.options.some((o) => o.value === "provisional_p"));

  // 委任は結論その2（最終工程・delegation kind）
  check("委任は delegation kind の最終工程",
    f.steps.delegation.kind === "delegation" && f.steps.delegation.next === null);
  check("改善策 → 委任の順で終わる", f.steps.improvement.next === "delegation");

  // スキップの規則
  const none = new Set();
  check("指標が無ければ工程0を飛ばして工程1から始まる",
    m.nextAvailableStep(f, null, none) === "implemented");
  check("No.4 があれば工程0から始まる",
    m.nextAvailableStep(f, null, new Set([4])) === "structure_ok");
  check("実施OKの次、No.10・11 が無ければ工程2b を飛ばして工程2へ",
    m.nextAvailableStep(f, m.resolveNext(f.steps.implemented, "done"), none) === "target_met");
  check("No.11 だけでも工程2b は出る",
    m.nextAvailableStep(f, "reach_ok", new Set([11])) === "reach_ok");

  // 旧フロー（fig6/fig7）は変えない — 保存済み flow_decision_path の互換
  check("旧図6は従来の3工程構成のまま",
    m.FIG6.start === "implemented" && m.FIG6.steps.improvement.next === null);
  check("getFlow が fig6v2 を引ける", m.getFlow("fig6v2")?.key === "fig6v2");
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 2. 保存（POST /evaluations）─────────────────
const postRoute = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "evaluations", "route.ts"));
check("POST が measure_work_id を受ける", /measure_work_id: z\.string\(\)\.uuid\(\)/.test(postRoute));
check("取組の帰属を確かめる（他計画・他施策の取組を指せない）",
  /FROM measure_works[\s\S]*?project_id = \$2 AND measure_design_id = \$3/.test(postRoute));
check("保存時に指標スナップショットを写す", /buildIndicatorSnapshot/.test(postRoute));
check("委任は to_measure で起票する", /'to_measure'/.test(postRoute));
check("委任の件数上限がある", /\.max\(20\)/.test(postRoute));

// ── 3. 承認（PATCH /evaluations/[evalId]）────────
const patchRoute = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "evaluations", "[evalId]", "route.ts"));
check("承認時に指標スナップショットを作り直して凍結する",
  /buildIndicatorSnapshot/.test(patchRoute) && /indicator_snapshot = \$/.test(patchRoute));
check("凍結は初回承認だけ（approved_snapshot_at ガード）",
  /!current\.approved_snapshot_at/.test(patchRoute));
check("No.5 実体化は二重登録を防ぐ（NOT EXISTS）",
  /NOT EXISTS[\s\S]*?source = 'auto_tasks'/.test(patchRoute));
check("No.5 実体化は auto_tasks・auto_computed で入る",
  /'auto_tasks', true/.test(patchRoute));
check("PDCA自動完了は未完了の行だけ・評価類型と年度で絞る",
  /status IN \('upcoming', 'in_progress'\)/.test(patchRoute) &&
  /ANY\(evaluation_tiers\)/.test(patchRoute) &&
  /completed_by_evaluation_id/.test(patchRoute));
check("副作用の失敗で承認自体は巻き戻さない", /承認自体は成立/.test(patchRoute));

// ── 4. 画面とメニュー ───────────────────────────
const sidebar = read(join(APP_ROOT, "src", "components", "ProjectSidebar.tsx"));
check("サイドバーCに取組評価（年次）がある",
  /work-evaluation/.test(sidebar) && sidebar.includes("取組評価（年次）"));

const page = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "work-evaluation", "page.tsx"));
check("取組評価ページがある", page.length > 0);
check("取り下げた取組は評価対象に出さない", /NOT w?\.?retired|NOT retired/.test(page));

const wizard = read(join(APP_ROOT, "src", "components", "program-eval", "WorkEvaluationWizard.tsx"));
check("取組評価ウィザードがある", wizard.length > 0);
check("実績の確認・記入フェーズを持つ", /実績の確認/.test(wizard));
check("システム判定の上書きを記録する", /overridden: value !== sys/.test(wizard));
check("委任の記入がある", /委任する課題/.test(wizard));

const legacyWizard = read(join(APP_ROOT, "src", "components", "program-eval", "EvaluationWizard.tsx"));
check("旧プログラム評価の画面に図6v2 を出さない",
  /\["fig6", "fig7"\] as FlowKey\[\]/.test(legacyWizard));

console.log(`check-eval-flow: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
