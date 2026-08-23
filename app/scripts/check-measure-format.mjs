#!/usr/bin/env node
/**
 * 施策データセット（EBPM）のフォーマット検査 — E1
 *
 * この検査を作った理由:
 *   measure_designs はC評価・A改善との契約になるデータセットで、
 *   JSONB の中身（エビデンス項目・実験設計・指標）の形が崩れると
 *   下流の評価が読めなくなる。正規化の挙動と確定条件をここで固定する。
 *
 * 使い方:
 *   node scripts/check-measure-format.mjs
 */

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

const work = mkdtempSync(join(tmpdir(), "mdfmt-"));
const outFile = join(work, "types.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "measure", "types.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
} catch (e) {
  console.error("esbuild での変換に失敗しました。");
  console.error(String(e.stderr ?? e));
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}

const M = await import(pathToFileURL(outFile).href);

// 対話ロジック（E2）も同様に読み込む
const dlgFile = join(work, "dialogue.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "measure", "dialogue.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${dlgFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
} catch (e) {
  console.error("esbuild での変換に失敗しました（dialogue.ts）。");
  console.error(String(e.stderr ?? e));
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}
const D = await import(pathToFileURL(dlgFile).href);
rmSync(work, { recursive: true, force: true });

let failed = 0;
let passed = 0;
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}${extra ? `\n    ${extra}` : ""}`);
  }
}

const base = {
  id: "m1",
  project_id: "p1",
  title: "通いの場への個別勧奨",
  status: "draft",
  evidence_status: "none",
  evidence_items: [],
  gap_analysis_ids: [],
  kpi_ids_initial: [],
  kpi_ids_intermediate: [],
  structure_indicators: [],
  process_indicators: [],
  milestones: [],
  risks: [],
  sort_order: 0,
  created_at: "2026-08-22",
  updated_at: "2026-08-22",
};

// ── 正規化 ───────────────────────────────────────────────
{
  const m = M.normalizeMeasure({ ...base, evidence_items: "not-json", experiment: 42 });
  check("壊れたJSONBでも落ちない", m.evidence_items.length === 0 && m.experiment === null);
}
{
  const m = M.normalizeMeasure({
    ...base,
    evidence_items: [
      { title: "介護予防教室のRCT", source: "BEST年次報告", design: "rct", effect_summary: "外出頻度+12%" },
      { title: "レベル明示", source: "x", design: "case", evidence_level: 3, effect_summary: "y" },
      { title: "", source: "", design: "rct", effect_summary: "" }, // 空は落ちる
    ],
  });
  check("エビデンスの design からレベルを補完する", m.evidence_items[0].evidence_level === 4);
  check("明示されたレベルは尊重する", m.evidence_items[1].evidence_level === 3);
  check("空のエビデンス項目は落とす", m.evidence_items.length === 2);
}
{
  const m = M.normalizeMeasure({
    ...base,
    experiment: { design: "stepped_wedge", rationale: "順次導入", unit: "地区" },
  });
  check("実験設計を正規化できる", m.experiment?.design === "stepped_wedge" && m.experiment.unit === "地区");
  const bad = M.normalizeMeasure({ ...base, experiment: { design: "unknown_design" } });
  check("未知の設計種別は null にする", bad.experiment === null);
}
{
  const m = M.normalizeMeasure({
    ...base,
    structure_indicators: ["会場数", { id: "keep", text: "専門職の配置数", kpi_id: "k1" }, ""],
  });
  check(
    "指標は文字列とオブジェクトの混在を受ける",
    m.structure_indicators.length === 2 && m.structure_indicators[1].id === "keep",
  );
}
{
  // JSONB が文字列で来ることがある（driver差）
  const m = M.normalizeMeasure({
    ...base,
    evidence_items: '[{"title":"文字列JSON","source":"s","design":"sr","effect_summary":"e"}]',
  });
  check("JSONBが文字列で来ても読める", m.evidence_items[0]?.evidence_level === 5);
}

// ── 確定条件（承認済み方針と一致すること）─────────────────
{
  const m = M.normalizeMeasure(base);
  check("エビデンス無し・実験設計無しは確定できない", M.canConfirm(m).ok === false);
}
{
  const m = M.normalizeMeasure({
    ...base,
    experiment: { design: "rct", rationale: "対象が十分に多い" },
  });
  check("実験設計を添えれば確定できる", M.canConfirm(m).ok === true);
}
{
  const m = M.normalizeMeasure({
    ...base,
    evidence_status: "sufficient",
    evidence_items: [{ title: "t", source: "s", design: "rct", effect_summary: "e" }],
  });
  check("エビデンス十分なら実験設計無しで確定できる", M.canConfirm(m).ok === true);
}
{
  const m = M.normalizeMeasure({ ...base, evidence_status: "sufficient" });
  check(
    "「十分」なのに項目ゼロは確定できない（空の主張を防ぐ）",
    M.canConfirm(m).ok === false,
  );
}
{
  const m = M.normalizeMeasure({ ...base, title: "  " });
  check("施策名が空だと確定できない", M.canConfirm(m).ok === false);
}

// ── 充足度 ───────────────────────────────────────────────
{
  const c = M.sectionCompleteness(M.normalizeMeasure(base));
  check("空の施策は origin/definition が未着手", c.origin === 0 && c.definition === 0);
  check("エビデンス不足＋実験設計無しは experiment=未着手", c.experiment === 0);
}
{
  const c = M.sectionCompleteness(
    M.normalizeMeasure({
      ...base,
      evidence_status: "sufficient",
      evidence_items: [{ title: "t", source: "s", design: "rct", effect_summary: "e" }],
    }),
  );
  check("エビデンス十分なら experiment は完了扱い", c.experiment === 2);
}

// ── 語彙の整合（設計のはしごとレベルの対応）────────────────
check("実験設計は7種類", M.EXPERIMENT_DESIGNS.length === 7);
check(
  "RCT系はレベル4を与える",
  ["rct", "cluster_rct", "stepped_wedge", "waitlist"].every(
    (k) => M.EXPERIMENT_DESIGN_META[k].level === 4,
  ),
);
check("前後比較はレベル2でしかない", M.EXPERIMENT_DESIGN_META.prepost.level === 2);
check("区画は7つ", M.MEASURE_SECTIONS.length === 7);

// ═══ 対話ロジック（E2）═══════════════════════════════════
//
// 現状整理でクロス分析が飛ばされた事故と同種の抜けを、
// 施策構築でも構造的に塞げているかを固定する。

{
  const a = D.sanitizeApproaches(
    [
      { root_cause: "移動手段が無い", approach: "送迎を提供して参加障壁を除く", measure_title: "通いの場送迎支援", target: "後期高齢者 約300人", intervention: "週1回の送迎" },
      { approach: "作用機序だけあるが施策名が無い" },
    ],
    0,
  );
  check("アプローチの取り込み: id採番と必須項目の検査", a.length === 1 && a[0].id === "a1");
}
{
  const base = [{ id: "a1", root_cause: "r", approach: "旧", measure_title: "旧名", target: "", intervention: "" }];
  const upd = D.applyApproachUpdates(base, [{ id: "a1", approach: "新しい作用機序" }, { id: "a9", approach: "存在しないid" }]);
  check("アプローチ更新はid一致のみ・部分上書き", upd[0].approach === "新しい作用機序" && upd[0].measure_title === "旧名" && upd.length === 1);
}
{
  const ev = D.sanitizeApproachEvidence(
    [
      { approach_id: "a1", status: "partial", items: [{ title: "t", source: "s", design: "rct", effect_summary: "e" }] },
      { approach_id: "a9", status: "sufficient", items: [] },
      { approach_id: "a1", status: "none", items: [] },
    ],
    new Set(["a1"]),
  );
  check("エビデンス評価: 無効id除外・同一idは先勝ち", ev.length === 1 && ev[0].status === "partial");
  check("エビデンス項目のレベルが補完される", ev[0].items[0].evidence_level === 4);
}

const appr = (id) => ({ id, root_cause: "r", approach: "x", measure_title: "m", target: "", intervention: "" });
const dlgData = (approaches, evidence) => ({ approaches, evidence, experiments: [], indicators: [], costs: [] });

{
  const d = dlgData([], []);
  check("ガード: アプローチ0件では evidence に進めない", D.guardMeasurePhase("evidence", "approach", d) === "approach");
}
{
  const d = dlgData([appr("a1")], []);
  check("ガード: 2段飛び（approach→experiment）を阻止", D.guardMeasurePhase("experiment", "approach", d) === "evidence");
}
{
  const d = dlgData([appr("a1"), appr("a2")], [{ approach_id: "a1", status: "none", items: [] }]);
  check("ガード: 未評価アプローチが残ると experiment に進めない", D.guardMeasurePhase("experiment", "evidence", d) === "evidence");
}
{
  const d = dlgData(
    [appr("a1")],
    [{ approach_id: "a1", status: "sufficient", items: [] }],
  );
  check("ガード: 全評価済みなら experiment へ進める", D.guardMeasurePhase("experiment", "evidence", d) === "experiment");
  // E4 で全フェーズ実装。ただし前提ガードにより done 要求は indicators で止まる
  // （2段飛び制限 + 短期KPI未設定のため）
  check("ガード: done を要求しても前提不足なら indicators で止まる", D.guardMeasurePhase("done", "experiment", d) === "indicators");
}
{
  const d = dlgData([appr("a1")], [{ approach_id: "a1", status: "none", items: [] }]);
  check("全アプローチ評価済みの判定", D.allApproachesAssessed(d) === true);
  check("アプローチ0件は評価済みとみなさない", D.allApproachesAssessed(dlgData([], [])) === false);
}
{
  const merged = D.upsertEvidence(
    [{ approach_id: "a1", status: "none", items: [] }],
    [{ approach_id: "a1", status: "sufficient", items: [] }, { approach_id: "a2", status: "partial", items: [] }],
  );
  check("エビデンスは approach_id 単位で上書きマージ", merged.length === 2 && merged.find((e) => e.approach_id === "a1").status === "sufficient");
}

// ═══ 実験設計フェーズ（E3）═══════════════════════════════

const dlgData3 = (approaches, evidence, experiments, indicators = [], costs = []) => ({ approaches, evidence, experiments, indicators, costs });

{
  const ex = D.sanitizeExperiments(
    [
      { approach_id: "a1", design: "stepped_wedge", rationale: "全員に行き渡る前提で導入時期をずらせる", unit: "地区" },
      { approach_id: "a2", design: "unknown", rationale: "x" },
      { approach_id: "a1", design: "rct", rationale: "重複は先勝ち" },
      { approach_id: "a9", design: "rct", rationale: "無効id" },
      { approach_id: "a3", design: "rct" },
    ],
    new Set(["a1", "a2", "a3"]),
  );
  check("実験設計: 有効idのみ・design検査・rationale必須・先勝ち", ex.length === 1 && ex[0].design === "stepped_wedge");
}
{
  const merged = D.upsertExperiments(
    [{ approach_id: "a1", design: "prepost", rationale: "旧" }],
    [{ approach_id: "a1", design: "rct", rationale: "新" }],
  );
  check("実験設計は approach_id 単位で上書き", merged.length === 1 && merged[0].design === "rct");
}
{
  const d = dlgData3(
    [appr("a1"), appr("a2")],
    [
      { approach_id: "a1", status: "sufficient", items: [] },
      { approach_id: "a2", status: "none", items: [] },
    ],
    [],
  );
  check("実験設計が必要なのは sufficient でないアプローチだけ", D.approachesNeedingExperiment(d).map((a) => a.id).join() === "a2");
  check("ガード: 設計不足では indicators に進めない", D.guardMeasurePhase("indicators", "experiment", d) === "experiment");
}
{
  const d = dlgData3(
    [appr("a1"), appr("a2")],
    [
      { approach_id: "a1", status: "sufficient", items: [] },
      { approach_id: "a2", status: "none", items: [] },
    ],
    [{ approach_id: "a2", design: "did", rationale: "対照が作れないため近隣比較" }],
  );
  check("ガード: 必要な設計が揃えば indicators へ進める", D.guardMeasurePhase("indicators", "experiment", d) === "indicators");
  // E4: cost へは短期KPIが揃うまで進めない
  check("ガード: 短期KPIが無いと cost へ進めない", D.guardMeasurePhase("cost", "indicators", d) === "indicators");
}
{
  // 全アプローチ sufficient → 実験設計ゼロでも indicators へ進める
  const d = dlgData3(
    [appr("a1")],
    [{ approach_id: "a1", status: "sufficient", items: [] }],
    [],
  );
  check("全て sufficient なら実験設計ゼロで indicators へ進める", D.guardMeasurePhase("indicators", "experiment", d) === "indicators");
  check("全て sufficient は allExperimentsDesigned=true", D.allExperimentsDesigned(d) === true);
}
{
  // E2 のガードは experiments フィールドを持つ形でも変わらない
  const d = dlgData3([appr("a1")], [], []);
  check("ガード（回帰）: 未評価では experiment に進めない", D.guardMeasurePhase("experiment", "evidence", d) === "evidence");
}

// ═══ 指標・コストフェーズ（E4）═══════════════════════════

{
  const ind = D.sanitizeIndicators(
    [
      {
        approach_id: "a1",
        structure: ["専門職の配置数", ""],
        process: ["開催回数"],
        outcome_initial: [
          { label: "教室参加率", unit: "%", baseline: 20, target: 30, deadline: "2027-03-31", condition: "gte" },
          { existing_kpi_id: "k-1" },
          { unit: "%" },
        ],
        outcome_intermediate: [{ label: "要支援認定率", unit: "%", target: 10, condition: "lte" }],
      },
      { approach_id: "a9", structure: [], process: [], outcome_initial: [], outcome_intermediate: [] },
    ],
    new Set(["a1"]),
  );
  check("指標: 無効id除外・空文字列除去", ind.length === 1 && ind[0].structure.length === 1);
  check("KPI案: 新規はlabel必須・既存参照はid だけで通る", ind[0].outcome_initial.length === 2);
  check("KPI案: deadline と condition を検査して保持", ind[0].outcome_initial[0].deadline === "2027-03-31" && ind[0].outcome_intermediate[0].condition === "lte");
}
{
  const costs = D.sanitizeCosts(
    [
      { approach_id: "a1", total_budget: 5000000, cost_per_outcome_note: "総事業費÷新規参加者数" },
      { approach_id: "a2" },
      { approach_id: "a3", cost_per_outcome_note: "式のみ" },
    ],
    new Set(["a1", "a2", "a3"]),
  );
  check("コスト: 算定式か総額のどちらかが無い項目は落とす", costs.length === 2);
}
{
  const withKpi = { approach_id: "a1", structure: [], process: [], outcome_initial: [{ label: "x", unit: "" }], outcome_intermediate: [] };
  const noKpi = { approach_id: "a1", structure: ["体制"], process: [], outcome_initial: [], outcome_intermediate: [] };
  const evOk = [{ approach_id: "a1", status: "sufficient", items: [] }];
  check("短期KPIゼロの指標では allIndicatorsSet=false", D.allIndicatorsSet(dlgData3([appr("a1")], evOk, [], [noKpi])) === false);
  const d1 = dlgData3([appr("a1")], evOk, [], [withKpi]);
  check("短期KPIが1件あれば allIndicatorsSet=true", D.allIndicatorsSet(d1) === true);
  check("ガード: 指標が揃えば cost へ進める", D.guardMeasurePhase("cost", "indicators", d1) === "cost");
  check("ガード: コスト未整理では done にできない", D.guardMeasurePhase("done", "cost", d1) === "cost");
  const d2 = dlgData3([appr("a1")], evOk, [], [withKpi], [{ approach_id: "a1", cost_per_outcome_note: "式" }]);
  check("ガード: コストが揃えば done にできる", D.guardMeasurePhase("done", "cost", d2) === "done");
  check("全コスト判定", D.allCostsSet(d2) === true && D.allCostsSet(d1) === false);
}

console.log(`\n結果: 成功 ${passed} 件 / 失敗 ${failed} 件`);
if (failed > 0) {
  console.error("\n施策データセットのフォーマットが期待と異なります。");
  process.exit(1);
}
