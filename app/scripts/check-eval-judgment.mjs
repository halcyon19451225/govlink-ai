#!/usr/bin/env node
/**
 * 図E1判定（fig7e1・migration 060 — CA2-3改）の検査
 *
 * この検査を作った理由:
 *   ①「この施策をどうするか」は裁量ではなく判定から機械的に導く（様式集 §13 形骸化予防）。
 *     記号列→報告書No.→ルート→標準処遇の対応が崩れると、G1台帳の全行が誤る。
 *   ②判定保留は正規の状態。保留のときも記号列は途中まで出し、処遇は行わない。
 *   ③②接近の判定は3か年傾向。点数に応じて 確定／暫定／なし に段階化する（2026-09-02 決定）。
 *   ④財政効果率は 効果÷事業費 で 100% を閾値に J/K。X は目標差ではなくベースライン差。
 *   ⑤サーバーは画面の report_no/route を信用せず judge() から導く。標準処遇と異なる決定処遇には
 *     理由書（H4）が必須で、無ければ承認できない（comply or explain の必須化）。
 *   ⑥評価が書く値は評価側（program_evaluations）に置き、施策構築(EBPM)のデータを書き換えない。
 *
 * 使い方: node scripts/check-eval-judgment.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const ROOT = resolve(APP_ROOT, "..");

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

function bundle(work, rel, out) {
  const outFile = join(work, out);
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", ...rel),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  return import(pathToFileURL(outFile).href);
}

// ── 1. 判定の体系（純粋関数）────────────────────────────
const work = mkdtempSync(join(tmpdir(), "eval-judgment-"));
try {
  const j = await bundle(work, ["lib", "evaluation", "judgment.ts"], "judgment.mjs");
  const f = await bundle(work, ["lib", "evaluation", "flow.ts"], "flow.mjs");
  const b = await bundle(work, ["lib", "evaluation", "judgmentFromFlow.ts"], "bridge.mjs");

  // 11経路 → 9報告書（様式集 §2 の表そのまま）
  const cases = [
    [{ q1: "not_met", q2: "not_approaching" }, "B→I", 1, "B"],
    [{ q1: "not_met", q2: "approaching", q3: "not_attributable", q4a: "unknown" }, "B→C→D→F", 2, "B"],
    [{ q1: "not_met", q2: "approaching", q3: "not_attributable", q4a: "not_reproducible" }, "B→C→D→H", 2, "B"],
    [{ q1: "not_met", q2: "approaching", q3: "not_attributable", q4a: "reproducible" }, "B→C→D→G", 3, "C"],
    [{ q1: "not_met", q2: "approaching", q3: "attributable", q4b: "inefficient" }, "B→C→E→K", 4, "D"],
    [{ q1: "not_met", q2: "approaching", q3: "attributable", q4b: "efficient" }, "B→C→E→J", 5, "A"],
    [{ q1: "met", q3: "not_attributable", q4a: "unknown" }, "A→D→F", 6, "B"],
    [{ q1: "met", q3: "not_attributable", q4a: "not_reproducible" }, "A→D→H", 6, "B"],
    [{ q1: "met", q3: "not_attributable", q4a: "reproducible" }, "A→D→G", 7, "C"],
    [{ q1: "met", q3: "attributable", q4b: "inefficient" }, "A→E→K", 8, "D"],
    [{ q1: "met", q3: "attributable", q4b: "efficient" }, "A→E→J", 9, "A"],
  ];
  for (const [a, path, no, route] of cases) {
    const r = j.judge(a);
    check(`${path} → No.${no}（ルート${route}）`, r && r.path === path && r.pattern.no === no && r.pattern.route === route);
    check(`${path} の標準処遇が空でない`, r && r.pattern.standardTreatment.length > 0);
  }
  // 保留: 問いが足りなければ null。途中経過の記号列は出る
  check("q1 だけなら判定保留", j.judge({ q1: "met" }) === null);
  check("保留でも記号列は途中まで出る（A→E→?）", j.partialPath({ q1: "met", q3: "attributable" }) === "A→E→?");
  check("未達で②が無ければ B→?", j.partialPath({ q1: "not_met" }) === "B→?");
  check("回答なしは ?", j.partialPath(null) === "?");
  // 正規化: 分岐上あり得ない回答を落とす
  const n = j.normalizeJudgment({ q1: "met", q2: "approaching", q3: "attributable", q4a: "reproducible", q4b: "efficient" });
  check("達成なのに q2 があれば落とす", n.q2 === undefined);
  check("起因するのに q4a があれば落とす", n.q4a === undefined && n.q4b === "efficient");

  // ② 3か年傾向
  const up = [{ fiscal_year: 2024, value: 10 }, { fiscal_year: 2025, value: 12 }, { fiscal_year: 2026, value: 15 }];
  const t3 = j.trendJudgment(up, "gte", 20, 10);
  check("3点・上昇・目標は以上 → 近づいている（確定）", t3.verdict === "approaching" && t3.confidence === "confirmed");
  const t3d = j.trendJudgment(up, "lte", 5, 10);
  check("3点・上昇・目標は以下 → 近づいていない", t3d.verdict === "not_approaching");
  const t2 = j.trendJudgment(up.slice(0, 2), "gte", 20, 10);
  check("2点は暫定判定（担当者確認）", t2.verdict === "approaching" && t2.confidence === "provisional");
  const t1 = j.trendJudgment(up.slice(0, 1), "gte", 20, 10);
  check("1点はシステム判定なし（単年判断）", t1.verdict === null && t1.confidence === "none");
  const t0 = j.trendJudgment([], "gte", 20, 10);
  check("実績なしは判定なし", t0.verdict === null && t0.points === 0);
  const noisy = [{ fiscal_year: 2024, value: 10 }, { fiscal_year: 2025, value: 16 }, { fiscal_year: 2026, value: 13 }];
  check("単年のブレ（最終年の下落）に引きずられず傾きで見る", j.trendJudgment(noisy, "gte", 20, 10).verdict === "approaching");
  check("直近3点だけを使う（4点目以前は捨てる）",
    j.trendJudgment([{ fiscal_year: 2020, value: 100 }, ...up], "gte", 20, 10).used.length === 3);

  // ④b 財政効果率 — 効果÷事業費。100% 閾値
  check("効果 ≥ 事業費 → J", j.fiscalEffectRate({ fiscalEffect: 1000, totalCost: 1000 }).mark === "J");
  check("効果 < 事業費 → K", j.fiscalEffectRate({ fiscalEffect: 999, totalCost: 1000 }).mark === "K");
  check("効果未入力 → 保留（mark null）", j.fiscalEffectRate({ fiscalEffect: null, totalCost: 1000 }).mark === null);
  check("経路別の累計を合算する", j.sumFiscalEffect([{ pathway_key: "a", cumulative: 300 }, { pathway_key: "b", cumulative: 200 }]) === 500);
  check("経路が空なら推計不能（null）", j.sumFiscalEffect([]) === null);
  check("標準処遇と同じ決定処遇は理由書不要", j.treatmentDiffers("継続", "継続") === false);
  check("空の決定処遇は標準どおりとみなす", j.treatmentDiffers("継続", "") === false);
  check("異なれば理由書が要る", j.treatmentDiffers("廃止", "対象を絞って継続") === true);

  // ── fig7e1（図E1の4問 → 委任 → 比較 → 処遇 → 引き継ぎ）
  const g = f.FIG7E1;
  check("FIG7E1 が定義されている", g && g.key === "fig7e1" && f.getFlow("fig7e1")?.key === "fig7e1");
  check("tier は outcome_intermediate", g.tier === "outcome_intermediate");
  check("① は No.8 の実績 vs 目標（自動）", g.steps.e1_q1.autoSource === "indicator" && g.steps.e1_q1.autoIndicator === 8);
  check("② は3か年傾向（自動）", g.steps.e1_q2.autoSource === "trend");
  check("④b は財政効果率（自動）", g.steps.e1_q4b.autoSource === "fiscal_effect");
  check("達成→③、未達→②", f.resolveNext(g.steps.e1_q1, "met") === "e1_q3" && f.resolveNext(g.steps.e1_q1, "not_met") === "e1_q2");
  check("近づいていない（I）は No.1 へ直行（③を問わない）", f.resolveNext(g.steps.e1_q2, "not_approaching") === "delegated_issues");
  check("起因しない→④a、起因する→④b",
    f.resolveNext(g.steps.e1_q3, "not_attributable") === "e1_q4a" && f.resolveNext(g.steps.e1_q3, "attributable") === "e1_q4b");
  check("処遇の工程は treatment kind", g.steps.treatment.kind === "treatment");
  check("異なる処遇は理由必須（H4）", g.steps.treatment.options.find((o) => o.value === "modified").requiresNote === true);
  check("④b に「推計不能（保留）」の逃げ道がある", g.steps.e1_q4b.options.some((o) => o.value === "pending"));
  check("fig7v2 は残る（保存済みの読み取り）", f.getFlow("fig7v2")?.key === "fig7v2");
  const cats = new Set([8]);
  check("委任が無ければ消化を飛ばし、比較先が無ければ比較も飛ばして処遇へ",
    f.nextAvailableStep(g, "delegated_issues", cats, { hasBenchmark: false, hasDelegations: false }) === "treatment");

  // 橋: fig7e1 の回答 → 4問
  const ans = [
    { step_id: "e1_q1", value: "met" }, { step_id: "e1_q3", value: "attributable" }, { step_id: "e1_q4b", value: "efficient" },
  ];
  const br = b.judgeFromFlow("fig7e1", ans);
  check("fig7e1 の回答から No.9 が出る", br.result?.pattern.no === 9);
  check("④b が pending なら判定保留", b.judgeFromFlow("fig7e1", [ans[0], ans[1], { step_id: "e1_q4b", value: "pending" }]).result === null);
  check("保存済みの judgment が最優先", b.judgeFromFlow("fig7v2", [], { q1: "not_met", q2: "not_approaching" }).result?.pattern.no === 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 2. migration 060 ────────────────────────────────
const mig = read(join(ROOT, "infra", "migrations", "060_evaluation_judgment.sql"));
check("migration 060 がある", mig.length > 0);
check("060 に BEGIN/COMMIT を書かない（ランナーが張る）", !/^\s*(BEGIN|COMMIT)\s*;/m.test(mig));
for (const col of ["judgment", "judgment_path", "report_no", "route", "standard_treatment", "decided_treatment", "rationale_required", "rationale", "comparison_grade", "fiscal_effect"]) {
  check(`program_evaluations.${col} を足す`, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(mig));
}
check("measure_indicators.natural_baseline / baseline_source", /natural_baseline NUMERIC/.test(mig) && /baseline_source\s+TEXT/.test(mig));
for (const col of ["contribution_pathways", "fiscal_effect_estimates", "judgment_exemption", "preconditions"]) {
  check(`measure_designs.${col} を足す`, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(mig));
}
check("report_no は 1〜9 に制約", /report_no BETWEEN 1 AND 9/.test(mig));
check("冪等（IF NOT EXISTS のみ）", !/ADD COLUMN(?! IF NOT EXISTS)/.test(mig));

// ── 3. サーバー: 画面の判定を信用せず導く／理由書の必須化 ──
const store = read(join(APP_ROOT, "src", "lib", "evaluation", "judgmentStore.ts"));
check("judgmentStore が judge() から report_no を導く", /judge\(stored\)/.test(store) && /report_no: result\?\.pattern\.no/.test(store));
check("判定保留で「標準処遇どおり」は拒否する", /判定保留のため標準処遇は定まりません/.test(store));
check("異なる処遇は rationale_required", /rationaleRequired = treatmentDiffers/.test(store));
const post = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "evaluations", "route.ts"));
check("POST が deriveJudgmentColumns を通す", /deriveJudgmentColumns\(d\)/.test(post));
check("POST が 060 の列へ書く", /judgment, judgment_path, report_no, route, standard_treatment,\s*decided_treatment, rationale_required, rationale, comparison_grade, fiscal_effect/.test(post));
check("POST の本文に report_no を直接受ける口が無い", !/report_no: z\./.test(post));
const patch = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "evaluations", "[evalId]", "route.ts"));
check("承認時に理由書未記入なら拒否（H4 必須化）", /理由書（様式H4）が必須です/.test(patch) && /status === "approved"/.test(patch));
check("決定処遇の変更で rationale_required を再計算", /treatmentDiffers\(cur\?\.standard_treatment/.test(patch));

// ── 4. 置き場: 評価が施策構築のデータを書き換えない ──
const dsRoute = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "measure-design", "[measureId]", "dataset", "route.ts"));
check("施策データセットの setup に判定・処遇の口が無い", !/report_no|decided_treatment|comparison_grade/.test(dsRoute));
check("自然体推計は指標（施策側）に持つ", /natural_baseline/.test(dsRoute));
const wizard = read(join(APP_ROOT, "src", "components", "program-eval", "MeasureEvaluationWizard.tsx"));
check("ウィザードは評価API（/evaluations）にだけ書く", /fetch\(`\/api\/admin\/projects\/\$\{projectId\}\/evaluations`,\s*\{\s*method: "POST"/.test(wizard) && !/method: "PATCH"/.test(wizard));
check("ウィザードは比較の段を記録する", /comparison_grade: comparisonGrade/.test(wizard));
check("ウィザードは寄与経路ごとの期末実績を入れる", /期末実績・累計/.test(wizard));
check("暫定・単年の傾向判定は根拠必須", /trend\.confidence !== "confirmed"\) return true/.test(wizard));

// ── 5. 報告書: 保存した判定・処遇を写す（作り直さない）──
const rd = read(join(APP_ROOT, "src", "lib", "evaluation", "reportData.ts"));
check("報告書は保存済み judgment を優先する", /judgeFromFlow\(flowKey, answers, ev\.judgment\)/.test(rd));
check("保留でも途中までの記号列を出す", /partialPath\(ev\.judgment/.test(rd));
check("決定処遇は decided_treatment（result 要約ではない）", /decided: ev\.decided_treatment/.test(rd) && !/decided: ev\.result/.test(rd));
check("X は実績 − 自然体推計", /result_value - outcomeItem\.natural_baseline/.test(rd));
const rows = read(join(APP_ROOT, "src", "lib", "evaluation", "reportRows.ts"));
check("説明的な単位は括弧で添える（値と単位を直結しない）", /u\.length <= 4 \? `\$\{v\}\$\{u\}` : `\$\{v\}（\$\{u\}）`/.test(rows));
const snap = read(join(APP_ROOT, "src", "lib", "evaluation", "indicatorSnapshot.ts"));
check("凍結スナップショットに自然体推計を写す", /natural_baseline: ind\.natural_baseline/.test(snap));

console.log(`check-eval-judgment: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
