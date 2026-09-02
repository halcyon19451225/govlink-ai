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

  // ── 図7v2（主要施策評価 — CA2-3）────────────────────
  const g = m.FIG7V2;
  check("FIG7V2 が定義されている", g && g.key === "fig7v2");
  check("tier は outcome_intermediate（計画期間・主要施策）", g.tier === "outcome_intermediate");
  check("実施時期は指標の評価時点に従う（3年目を直書きしない）",
    !g.cycleNote.includes("3年目") && g.cycleNote.includes("評価時点"));
  for (const id of [
    "mid_met", "caused_by_initial", "delegated_issues", "cost_appropriate",
    "benchmark", "cost_effectiveness", "policy_direction", "plan_level_issues", "handover",
  ]) {
    check(`図7v2 工程 ${id} がある`, Boolean(g.steps[id]));
  }
  check("工程1は No.8 の実績 vs 目標",
    g.steps.mid_met.autoSource === "indicator" && g.steps.mid_met.autoIndicator === 8);
  check("委任の消化は delegation_review", g.steps.delegated_issues.kind === "delegation_review");
  check("他団体比較は比較先があるときだけ", g.steps.benchmark.requiresBenchmark === true);
  check("費用対効果は No.16 が前提", (g.steps.cost_effectiveness.requiresIndicator ?? []).join() === "16");
  check("処遇は4択（継続・改変・統合・廃止）",
    g.steps.policy_direction.options.map((o) => o.value).join() === "continue,revise,merge,abolish");
  check("処遇は理由を必須にする（継続以外）",
    g.steps.policy_direction.options.filter((o) => o.requiresNote).length === 3);
  check("次期への引き継ぎ課題は delegation kind",
    g.steps.plan_level_issues.kind === "delegation");
  check("最後は引き継ぎ事項の記入で終わる",
    g.steps.handover.next === null && g.steps.handover.noteRequired === true);
  check("getFlow が fig7v2 を引ける", m.getFlow("fig7v2")?.key === "fig7v2");

  // スキップの規則（図7v2）
  const catsWithMid = new Set([8]);
  check("比較先が無ければ他団体比較を飛ばす",
    m.nextAvailableStep(g, "benchmark", catsWithMid, { hasBenchmark: false, hasDelegations: false })
      === "policy_direction");
  check("比較先があれば他団体比較に入る",
    m.nextAvailableStep(g, "benchmark", catsWithMid, { hasBenchmark: true, hasDelegations: false })
      === "benchmark");
  check("委任が無ければ消化の工程を飛ばす",
    m.nextAvailableStep(g, "delegated_issues", catsWithMid, { hasBenchmark: false, hasDelegations: false })
      === "cost_appropriate");
  check("委任があれば消化の工程に入る",
    m.nextAvailableStep(g, "delegated_issues", catsWithMid, { hasBenchmark: false, hasDelegations: true })
      === "delegated_issues");
  check("No.16 が無ければ費用対効果を飛ばす",
    m.nextAvailableStep(g, "cost_effectiveness", catsWithMid, { hasBenchmark: false, hasDelegations: false })
      === "policy_direction");
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 1b. 評価予定の日付換算（CA2-4）─────────────────
const work2 = mkdtempSync(join(tmpdir(), "eval-due-"));
const dueFile = join(work2, "duecheck.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "evaluation", "duecheck.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${dueFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const d = await import(pathToFileURL(dueFile).href);

  // 相対 → 絶対（計画開始2024年度）
  check("第1年度・上期末は 2024-09-30",
    d.resolveDueDate({ relative_year: 1, relative_period: "first", absolute_date: null }, 2024) === "2024-09-30");
  check("第3年度・年度末は 2027-03-31",
    d.resolveDueDate({ relative_year: 3, relative_period: "end", absolute_date: null }, 2024) === "2027-03-31");
  check("絶対日付が相対より優先される",
    d.resolveDueDate({ relative_year: 1, relative_period: "first", absolute_date: "2026-05-01" }, 2024) === "2026-05-01");
  check("相対年次が無ければ期日未定",
    d.resolveDueDate({ relative_year: null, relative_period: null, absolute_date: null }, 2024) === null);
  // 年度の境界
  check("3月31日は前年度、4月1日は当年度",
    d.fiscalYearOfDate("2027-03-31") === 2026 && d.fiscalYearOfDate("2027-04-01") === 2027);

  // 済み判定は 単位（取組/主要施策）×年度×tier で見る
  const inds = [
    { id: "i5", category_no: 5, label: "実施回数", measure_work_id: "w1", measure_design_id: "m1",
      checkpoints: [{ id: "c1", measure_indicator_id: "i5", label: "年度末", relative_year: 1,
                      relative_period: "end", absolute_date: null, evaluation_type: "process" }] },
    { id: "i8", category_no: 8, label: "中間", measure_work_id: null, measure_design_id: "m1",
      checkpoints: [{ id: "c2", measure_indicator_id: "i8", label: "計画期間末", relative_year: 3,
                      relative_period: "end", absolute_date: null, evaluation_type: "outcome" }] },
  ];
  const listNone = d.buildDueList(inds, [], 2024, "2026-09-02");
  check("期日を過ぎた未評価は due", listNone.find((x) => x.checkpoint_id === "c1").state === "due");
  check("先の期日は upcoming", listNone.find((x) => x.checkpoint_id === "c2").state === "upcoming");
  const listDone = d.buildDueList(inds, [
    { id: "e1", measure_work_id: "w1", measure_design_id: "m1", fiscal_year: 2024, evaluation_tier: "outcome_initial" },
  ], 2024, "2026-09-02");
  check("同じ取組・同じ年度の評価があれば done",
    listDone.find((x) => x.checkpoint_id === "c1").state === "done");
  check("取組の評価は主要施策の予定を消さない",
    listDone.find((x) => x.checkpoint_id === "c2").state === "upcoming");
  check("要約が件数を返す", d.dueSummary(listDone).done === 1);
} finally {
  rmSync(work2, { recursive: true, force: true });
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

// 委任の起票と消化（図7v2）
check("委任の起票に level を持たせる（to_measure / to_next_plan）",
  /level: z\.enum\(\["to_measure", "to_next_plan"\]\)/.test(postRoute));
check("委任の消化は open のものだけ進める",
  /SET status = \$1, addressed_in_evaluation_id = \$2[\s\S]*?status = 'open'/.test(postRoute));
check("委任の消化語彙は to_status（評価の status と混同しない）",
  /to_status: z\.enum\(\["addressed", "carried_over"\]\)/.test(postRoute));

const mePage = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "measure-evaluation", "page.tsx"));
check("主要施策評価ページがある", mePage.length > 0);
check("主要施策評価は取組が紐づかない中間アウトカム評価を並べる",
  /measure_work_id IS NULL[\s\S]*?evaluation_tier = 'outcome_intermediate'/.test(mePage));

const meWizard = read(join(APP_ROOT, "src", "components", "program-eval", "MeasureEvaluationWizard.tsx"));
check("主要施策評価ウィザードがある", meWizard.length > 0);
check("取組評価のロールアップを出す", /この施策の取組評価/.test(meWizard));
check("次期への引き継ぎは to_next_plan で送る", /level: "to_next_plan" as const/.test(meWizard));

check("サイドバーCに主要施策評価（計画期間）がある",
  /measure-evaluation/.test(sidebar) && sidebar.includes("主要施策評価（計画期間）"));
check("旧プログラム評価はメニューから外れている",
  !/\{ id: "program-evaluation", label:/.test(sidebar));

const legacyPage = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "program-evaluation", "page.tsx"));
check("旧プログラム評価の画面が新メニューへ案内する",
  /work-evaluation/.test(legacyPage) && /measure-evaluation/.test(legacyPage));

// ── 評価予定（CA2-4）────────────────────────────
const wizard2 = read(join(APP_ROOT, "src", "components", "program-eval", "WorkEvaluationWizard.tsx"));
const duePanel = read(join(APP_ROOT, "src", "components", "program-eval", "DueSchedulePanel.tsx"));
check("評価予定パネルがある", duePanel.length > 0);
check("評価予定は評価時点が未設定でも説明を出す", /評価時点がまだ設定されていません/.test(duePanel));
const wePage = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "work-evaluation", "page.tsx"));
check("取組評価ページが評価予定を組み立てる", /buildDueList/.test(wePage));
check("主要施策評価ページが評価予定を組み立てる", /buildDueList/.test(mePage));

// ── フロー全体図（CA2-4）──────────────────────────
for (const f of ["flow-fig6.html", "flow-fig7.html", "_flow.css"]) {
  check(`ヘルプのフロー図 ${f} がある`, existsSync(join(APP_ROOT, "public", "help", f)));
}
const fig6Html = read(join(APP_ROOT, "public", "help", "flow-fig6.html"));
const fig7Html = read(join(APP_ROOT, "public", "help", "flow-fig7.html"));
check("図6の全体図に評価の目的が書いてある", /この評価の目的/.test(fig6Html) && /委任/.test(fig6Html));
check("図7の全体図に処遇と引き継ぎが書いてある",
  /処遇/.test(fig7Html) && /ニーズ評価・セオリー評価/.test(fig7Html));
check("図7の全体図は現行計画を書き換えないと明記する",
  /施策構築の内容）は評価では書き換えません/.test(fig7Html));
check("ウィザードからフロー全体図へ行ける",
  /help\/flow-fig6\.html/.test(wizard2) && /help\/flow-fig7\.html/.test(meWizard));

const legacyWizard = read(join(APP_ROOT, "src", "components", "program-eval", "EvaluationWizard.tsx"));
check("旧プログラム評価の画面に図6v2 を出さない",
  /\["fig6", "fig7"\] as FlowKey\[\]/.test(legacyWizard));

console.log(`check-eval-flow: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
