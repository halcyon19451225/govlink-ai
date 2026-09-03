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

import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
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

// ── 6. 様式H1 評価総括表（収束工程 段階1・全様式の転記元）──
const refl = read(join(APP_ROOT, "src", "lib", "evaluation", "reflectionData.ts"));
check("H1 は1行1指標セット（No.6→7→8）", /category_no IN \(6, 7, 8\)/.test(refl));
check("H1 の判定は保存値を写す（承認済み > レビュー中 > 下書き）", /STATUS_RANK/.test(refl) && /judgment_path, report_no, route/.test(refl));
check("H1 は事業費を按分しない（施策計）", /按分/.test(refl));
check("H1 の実績は履歴の最新（LATERAL）", /LEFT JOIN LATERAL/.test(refl));
check("H1 に「主要施策評価が未実施」「判定保留」「共有指標」の自動注記", /主要施策評価が未実施/.test(refl) && /判定保留/.test(refl) && /共有されている/.test(refl));
const h1Route = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-reflection", "h1", "route.ts"));
check("H1 API がある（GET=JSON / POST=docx）", /export async function GET/.test(h1Route) && /export async function POST/.test(h1Route));
check("H1 docx は横向き", /landscape: true/.test(h1Route));
check("H1 docx は未承認の判定を【暫定】と刷る", /【暫定】/.test(h1Route));
const sidebar = read(join(APP_ROOT, "src", "components", "ProjectSidebar.tsx"));
check("サイドバーAに「次期計画への反映」がある", /plan-reflection/.test(sidebar) && sidebar.includes("次期計画への反映"));
const topics = read(join(APP_ROOT, "src", "lib", "manual", "topics.ts"));
check("マニュアル索引に plan-reflection がある", /id: "plan-reflection"/.test(topics));
const client = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "plan-reflection", "PlanReflectionClient.tsx"));
check("タブは H1→G1→G4→G2→H3 の順", /"h1"[\s\S]*"g1"[\s\S]*"g4"[\s\S]*"g2"[\s\S]*"h3"/.test(client));
check("画面は施策データを書き換えない（PATCH/PUT を持たない）", !/method: "PATCH"|method: "PUT"/.test(client));

// docx スモーク: 汎用帳票（formDocx）＋ H1 の行変換をダミーで組む
const work3 = mkdtempSync(join(tmpdir(), "eval-form-docx-"));
const bundleOut = join(APP_ROOT, "node_modules", ".check-eval-judgment.mjs");
const stub = join(work3, "server-only.mjs");
try {
  writeFileSync(stub, "export {}\n");
  const build = (src, out) => {
    execFileSync(
      "npx",
      [
        "--no-install", "esbuild", join(APP_ROOT, "src", "lib", "evaluation", src),
        "--bundle", "--format=esm", "--platform=node", "--target=node18",
        `--alias:@=${join(APP_ROOT, "src")}`, `--alias:server-only=${stub}`,
        "--external:docx", "--external:pg", `--outfile=${out}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
    );
    return import(pathToFileURL(out).href);
  };
  const fd = await build("formDocx.ts", bundleOut);
  const isZip = (buf) => Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  const buf = await fd.buildFormDocx({
    municipality: "団体", title: "様式H1 評価総括表", subtitle: "テスト", warnings: ["【暫定】"], landscape: true,
    version: fd.REFLECT_FORM_VERSION,
    sections: [{ heading: "1. 一覧", table: { headers: ["a", "b"], rows: [["1", "2\n3"]], widths: [30, 70] } }, { heading: "2. 空", table: { headers: ["a"], rows: [] } }, { heading: "3. kv", kv: [{ label: "x", value: "y" }] }],
  });
  check("汎用帳票 docx が組める（有効なZIP・横向き・空表・kv）", isZip(buf));
  // h1RowText は DB を持つモジュール内にあるので、db を外して純粋関数だけ呼ぶ
  const dbStub = join(work3, "db.mjs");
  writeFileSync(dbStub, "export const query = async () => []; export const queryOne = async () => null;\n");
  const out2 = join(APP_ROOT, "node_modules", ".check-eval-judgment-h1.mjs");
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild", join(APP_ROOT, "src", "lib", "evaluation", "reflectionData.ts"),
      "--bundle", "--format=esm", "--platform=node", "--target=node18",
      `--alias:@=${join(APP_ROOT, "src")}`, `--alias:server-only=${stub}`, `--alias:@/lib/db=${dbStub}`,
      "--external:pg", `--outfile=${out2}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const rd = await import(pathToFileURL(out2).href);

  // ── 7. G1／G2／G4／H3（migration 061）────────────────
  const mig61 = read(join(ROOT, "infra", "migrations", "061_plan_reflection.sql"));
  check("migration 061 がある", mig61.length > 0);
  check("061 に BEGIN/COMMIT を書かない", !/^\s*(BEGIN|COMMIT)\s*;/m.test(mig61));
  check("plan_reflections は evaluation_id で一意（報告書1件=1行）", /evaluation_id\s+UUID\s+NOT NULL UNIQUE/.test(mig61));
  check("G1-8 の反映先は measure/chapter/not_adopted", /reflect_kind IN \('measure', 'chapter', 'not_adopted'\)/.test(mig61));
  check("G2-4 の採否語彙", /adoption IN \('adopted', 'partial', 'rejected'\)/.test(mig61));
  check("H3 の状態機械（deferred/re_proposed/adopted/dropped）", /status IN \('deferred', 're_proposed', 'adopted', 'dropped'\)/.test(mig61));
  check("061 に判定・処遇の本体（report_no 等）を持たない（program_evaluations が正）", !/report_no|standard_treatment/.test(mig61.replace(/--.*$/gm, "")));
  const reflApi = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-reflection", "[evaluationId]", "route.ts"));
  check("不採用には理由が必須（行き先として有効にする）", /不採用とする場合は理由を記入してください/.test(reflApi));
  check("反映先の施策はこの計画のクローンに限る", /cloned_from_project_id = \$2/.test(reflApi));
  check("処遇の変更は履歴（decision_history）に stage 付きで追記", /decision_history/.test(reflApi) && /stage: d\.decision_stage/.test(reflApi));
  check("確定段階で理由書が無ければ拒否", /理由書（H4）が必須です/.test(reflApi));
  check("PATCH は施策構築のデータを書き換えない", !/UPDATE measure_designs|UPDATE measure_indicators/.test(reflApi));
  const defApi = read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-reflection", "deferred", "[itemId]", "route.ts"));
  check("H3 は行を消さず、取り下げに理由必須", /取り下げには理由/.test(defApi) && !/DELETE FROM plan_deferred_items/.test(defApi));
  check("H3 の遷移表（deferred→re_proposed/dropped, re_proposed→adopted/deferred/dropped）", /deferred: \["re_proposed", "dropped"\]/.test(defApi) && /re_proposed: \["adopted", "deferred", "dropped"\]/.test(defApi));
  check("G1 docx は照合結果と理由書の過半判定を刷る", /行き先のない報告書が/.test(read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-reflection", "g1", "route.ts"))));
  check("G2 docx は例外の件数（過半→ルール改定）を刷る", /過半を超えています/.test(read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-reflection", "g2", "route.ts"))));
  check("G4 は①〜⑦自動・⑧〜⑫手入力（g4Sections が12節）", /heading: "⑫ 答申後の反映先"/.test(refl) && /heading: "① 諮問の基本事項"/.test(refl));
  check("G4-⑩ 諮問事項はルートから定型選択（INQUIRY_ITEMS）", /inquiry_items: route \? INQUIRY_ITEMS\[route\]/.test(refl));
  const tabs = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "plan-reflection", "ReflectionTabs.tsx"));
  check("G4 の入力欄は内側コンポーネントではなく関数（フォーカス喪失の回避）", /const field = \(label: string/.test(tabs) && !/<Field /.test(tabs));

  // ── 8. 様式H2 前提条件表（migration 062）────────────
  const mig62 = read(join(ROOT, "infra", "migrations", "062_precondition_checks.sql"));
  check("migration 062 がある", mig62.length > 0 && !/^\s*(BEGIN|COMMIT)\s*;/m.test(mig62));
  check("年次の前提確認は評価側（program_evaluations.precondition_checks）", /ADD COLUMN IF NOT EXISTS precondition_checks/.test(mig62));
  check("改善アクションの出所に precondition を追加（上位集合）", /'precondition'/.test(mig62) && /'handover'/.test(mig62) && /'improvement_dialogue'/.test(mig62));
  check("060 の preconditions は定義だけ（status を施策側に持たない）", !/checked_fiscal_year/.test(mig));
  const workWizard = read(join(APP_ROOT, "src", "components", "program-eval", "WorkEvaluationWizard.tsx"));
  check("取組評価ウィザードに前提確認フェーズがある", /phase === "preconditions"/.test(workWizard));
  check("前提が無ければ前提確認を飛ばす", /preconditions\.length > 0\) \{\s*setPhase\("preconditions"\)/.test(workWizard));
  check("不成立には確認した事実が必須", /不成立の前提には、確認した事実を記入してください/.test(workWizard));
  check("保存本文に precondition_checks を載せる", /precondition_checks: preconditions\.map/.test(workWizard));
  check("POST が precondition_checks を受けて保存する", /precondition_checks:/.test(post) && /JSON\.stringify\(d\.precondition_checks \?\? \[\]\)/.test(post));
  check("初回承認で不成立の前提ごとに改善アクションを自動起票（source=precondition・二重防止）",
    /'precondition'/.test(patch) && /WHERE NOT EXISTS \(\s*SELECT 1 FROM improvement_actions\s*WHERE program_evaluation_id = \$2 AND source = 'precondition'/.test(patch));
  check("承認の副作用は初回だけ（firstApproval の中）", patch.indexOf("'precondition'") > patch.indexOf("if (firstApproval) {"));
  const panel = read(join(APP_ROOT, "src", "components", "measure", "MeasureDatasetPanel.tsx"));
  check("施策データセットに前提条件表（H2）の区画がある", /PreconditionSection/.test(panel) && /前提条件表（様式H2）/.test(panel));
  check("前提の上限は8（3〜5項目に限定）", /rows\.length < 8/.test(panel) && /\.max\(8\)/.test(dsRoute));
  check("前提の状態は評価側から合成（施策側を書き換えない）", /loadPreconditionStatus/.test(dsRoute) && /precondition_checks AS checks/.test(dsRoute));
  check("2回以上不成立で取組差替の検討を促す", /2回以上不成立/.test(panel));
  check("H2 docx API がある（施策1件・履歴つき）", /export async function POST/.test(read(join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-reflection", "h2", "[measureId]", "route.ts"))));
  const impTypes = read(join(APP_ROOT, "src", "lib", "improvement", "types.ts"));
  check("改善アクションの出所ラベルに precondition がある", /precondition: \{ label: "前提条件の不成立"/.test(impTypes));

  const baseReport = {
    evaluation_id: "e1", measure_id: "m1", measure_title: "施策A", owner_department: "福祉課", status: "approved", frozen: true,
    fiscal_year: 2028, evaluated_at: "2029-05-01", evaluated_by: "担当", path: "A→E→K", report_no: 8, report_title: "目標達成・効率化報告書（圧縮・統廃合）",
    state: "達成・寄与あり。財政効果率100%未満", route: "D", route_name: "構造（費用再設計）", review: "費用計画の承認",
    standard_treatment: "達成水準を維持目標へ・圧縮し他施策へ再配分", decided_treatment: "達成水準を維持目標へ・圧縮し他施策へ再配分", rationale_required: false, rationale: null,
    outcome: { label: "認定率", baseline: "5.1%", target: "4.8%", result: "4.7%", natural_baseline: "5.0%", x: "-0.3%" }, comparison_grade: "C",
    cost_total: 1000000, fiscal_effect: 800000, fiscal_rate: 80, fiscal_mark: "K", pathways: "認定率: ¥800,000", exemption: null,
    inquiry_items: ["ア 案の妥当性", "カ 費用計画の可否"],
    reflection: { id: null, decision_history: [], reflect_kind: null, reflect_measure_id: null, reflect_location: null, reflect_reason: null, adoption: null, inquiry_no: null, inquiry_date: null, reply_due: null, opinions: {}, stakeholder_opinions: null, resource_change: {}, reply_result: null, reply_date: null, decided_on: null, decision_meeting: null, set_notes: {} },
    adoption_effective: "adopted", reconciled: false, reconcile_note: "未対応 — 反映箇所（または不採用・理由）が未記入",
  };
  const g1 = rd.g1RowText(baseReport, []);
  check("G1 行は9列（G1-1〜G1-9）", g1.length === 9 && rd.G1_HEADERS.length === 9);
  check("G1 の反映箇所が未記入なら「未対応」", g1[8].startsWith("未対応") && g1[7] === "（未記入）");
  const done = { ...baseReport, reconciled: true, reflection: { ...baseReport.reflection, reflect_kind: "not_adopted", reflect_reason: "法定必須のため現行維持" } };
  check("不採用・理由は行き先として有効", rd.g1RowText(done, [])[7].startsWith("不採用・理由:") && rd.g1RowText(done, [])[8] === "対応済み");
  const linked = { ...baseReport, reflection: { ...baseReport.reflection, reflect_kind: "measure", reflect_measure_id: "n1", reflect_location: "第4章 p.42" } };
  check("次期施策へのリンクは施策名と箇所を併記", rd.g1RowText(linked, [{ id: "n1", title: "次期施策A", cloned_from_measure_id: "m1" }])[7] === "次期施策「次期施策A」／第4章 p.42");
  const g2 = rd.g2RowText({ ...baseReport, adoption_effective: "partial", rationale: "現場の意見により対象を絞る" }, []);
  check("G2 は標準処遇に対する採否で書き、理由は理由書の要旨", g2[3] === "一部採用" && g2[4] === "現場の意見により対象を絞る");
  check("G2 で標準どおりなら理由は「－」", rd.g2RowText(baseReport, [])[4] === "－");
  const g4 = rd.g4Sections(baseReport, []);
  check("G4 は12節（①〜⑫）", g4.length === 12 && g4[0].heading.startsWith("①") && g4[11].heading.startsWith("⑫"));
  check("G4-⑩ はルートDの定型（ア・カ）", g4[9].kv[0].value === "ア 案の妥当性／カ 費用計画の可否");
  check("G4-⑦ は標準どおりなら「標準処遇のとおり」", g4[6].kv[1].value === "標準処遇のとおり");

  const row = {
    set_no: 1, measure_id: "m", measure_title: "施策", work_id: "w", work_code: "W-1", work_title: "取組",
    output: { indicator_id: "i6", label: "回数", target: "2回", result: "1回", baseline: "0回", achieved: "×", shared: false },
    initial: { indicator_id: "i7", label: "完了", target: "1（実施=1・未実施=0）", result: "—", baseline: "0（実施=1・未実施=0）", achieved: "－", shared: true },
    intermediate: { indicator_id: "i8", label: "認定率", target: "4.8%", result: "4.7%", baseline: "5.1%", achieved: "○", shared: false },
    primary: true,
    judgment: { evaluation_id: "e", status: "in_review", fiscal_year: 2026, path: "A→E→?", report_no: null, report_title: "判定保留", route: null, standard_treatment: null, decided_treatment: null, rationale_required: false, comparison_grade: "C", frozen: false },
    cost_total: 350000, fiscal_rate: null, fiscal_mark: null, comparison_grade: "C", exemption: null,
    auto_notes: ["※判定保留（記号列 A→E→?）"],
  };
  const t = rd.h1RowText(row);
  check("H1 行は9列（H1-1〜H1-9）", t.length === 9 && rd.H1_HEADERS.length === 9);
  check("H1 行に ◎・達否・共有・【暫定】・保留が写る", t[4].startsWith("◎") && t[2].includes("×") && t[3].includes("（共有）") && t[5].includes("判定保留") && t[5].includes("【暫定】"));
  check("H1 の判定は報告書No.とルートを併記する",
    rd.h1RowText({ ...row, judgment: { ...row.judgment, path: "A→E→J", report_no: 9, report_title: "達成・継続", route: "A", frozen: true } })[5] === "A→E→J → No.9 達成・継続（ルートA 校正（単一ループ））");
  rmSync(out2, { force: true });
} finally {
  rmSync(work3, { recursive: true, force: true });
  rmSync(bundleOut, { force: true });
}

// ── 9. "use client" のファイルが server-only モジュールから値を import していないこと ──
// （Amplify のビルドで落ちた実績: ReflectionTabs → reflectionData の ADOPTION_LABEL）
{
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  };
  const files = walk(join(APP_ROOT, "src"));
  const serverOnly = new Set(
    files.filter((f) => /^\s*import "server-only";/m.test(read(f))).map((f) => f.replace(/\.tsx?$/, "")),
  );
  const offenders = [];
  for (const f of files) {
    const src = read(f);
    if (!/^\s*"use client";/m.test(src)) continue;
    const re = /^import\s+(?!type\s)([\s\S]*?)\s+from\s+"@\/([^"]+)";/gm;
    let m;
    while ((m = re.exec(src))) {
      const target = join(APP_ROOT, "src", m[2]);
      if (!serverOnly.has(target)) continue;
      // `import { type A, type B }` だけなら型のみ
      const names = m[1].replace(/[{}]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
      if (names.every((n) => n.startsWith("type "))) continue;
      offenders.push(`${f.replace(APP_ROOT + "/", "")} → @/${m[2]}`);
    }
  }
  check(`"use client" が server-only モジュールから値を import しない${offenders.length ? `: ${offenders.join(", ")}` : ""}`, offenders.length === 0);
}

console.log(`check-eval-judgment: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
