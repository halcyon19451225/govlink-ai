#!/usr/bin/env node
/**
 * 指標のサービス層を実 DB で動かす検査 — check:indicatorsvc（DB が要るので npm run check には入れない）
 *
 * 使い方:
 *   DATABASE_URL=postgres://… node scripts/check-indicator-service.mjs
 *   （.env.local があればそこから DATABASE_URL を読む。ローカルの検証用 PostgreSQL なら
 *     接続文字列に sslmode=disable を付ける）
 *
 * 何を確かめるか（設計 claude/coe-dataset-model.md §9-1・§9-4・§10-5）:
 *   ① 指標を作ると、定義（indicators）・目標（indicator_targets）・履歴（activity_log）が揃う
 *   ② 値は積むだけ。**同じ基準日で計算し直しても上書きしない**（古い値も残る）
 *   ③ 最新値は「基準日が最大のうち、計算が最新」で決まる
 *   ④ 人（via='ui'）と AI（via='dialogue'）で、**残るものが同じ形になる**
 *   ⑤ 互換ビュー `kpis` が、目標と最新値を組んで旧来の列を返す／書き込みは失敗する
 *   ⑥ 目標はスコープ（計画／主要施策／取組）で分かれ、同じスコープなら置き換わる
 *
 * 最後に一時データを消す（municipalities の CASCADE）。
 */
import { mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const require = createRequire(join(APP_ROOT, "package.json"));

if (!process.env.DATABASE_URL) {
  const envPath = join(APP_ROOT, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要です");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const check = (name, cond) => { if (cond) passed++; else { failed++; console.error(`  ✗ ${name}`); } };

const work = mkdtempSync(join(tmpdir(), "indicatorsvc-"));
const bundle = join(APP_ROOT, ".check-indicatorsvc.mjs");
execFileSync("npx", ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "indicator", "service.ts"),
  "--bundle", "--format=esm", "--platform=node", "--target=es2022", "--packages=external",
  `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${bundle}`],
  { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT });

const pg = require("pg");
const useSsl = !/sslmode=disable/.test(process.env.DATABASE_URL);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connectionTimeoutMillis: 60_000,
});
const q = (s, p) => pool.query(s, p).then((r) => r.rows);

const MUNI = "00000000-0000-4000-8000-0000000d3001";
const PROJECT = "00000000-0000-4000-8000-0000000d3002";

try {
  const svc = await import(pathToFileURL(bundle).href);
  await q(`INSERT INTO municipalities (id, name, slug, prefecture) VALUES ($1, 'check-indicatorsvc', 'check-indicatorsvc', '-') ON CONFLICT (id) DO NOTHING`, [MUNI]);
  await q(`INSERT INTO projects (id, municipality_id, title) VALUES ($1, $2, 'check-indicatorsvc') ON CONFLICT (id) DO NOTHING`, [PROJECT, MUNI]);

  // 画面から操作する人と、AI の対話を確定する人。**どちらも actor は人**
  const human = { userRoleId: null, municipalityId: MUNI, via: "ui" };
  const ai = {
    userRoleId: null, municipalityId: MUNI, via: "dialogue",
    dialogueRef: { dialogue_kind: "measure", dialogue_id: "d-1", turn_no: 3 },
  };

  // ── 1. 作成 ───────────────────────────────────────
  console.log("1. 作成");
  const a = await svc.createIndicator(human, PROJECT, {
    label: "検証指標A", unit: "%", indicatorType: "outcome_initial", origin: "plan",
    target: { scope: "plan", targetValue: 80, baselineValue: 50, baselineAsOf: "2025-04-01", achievementCondition: "gte", targetDeadline: "2028-03-31" },
  });
  check("指標ができる", typeof a.id === "string" && a.label === "検証指標A");
  check("算出方法の既定は手入力", a.calc_type === "manual");
  const tA = (await svc.listTargets(a.id)).find((t) => t.scope === "plan");
  check("目標が計画スコープで入る", Number(tA?.target_value) === 80 && Number(tA?.baseline_value) === 50);
  const logA = await q(`SELECT entity, action, via FROM activity_log WHERE entity_id = $1 ORDER BY at`, [a.id]);
  check("作成が履歴に残る", logA.some((r) => r.entity === "indicator" && r.action === "create" && r.via === "ui"));
  try { await svc.createIndicator(human, PROJECT, { label: "  " }); check("指標名が空なら拒否", false); }
  catch (e) { check("指標名が空なら拒否", e.status === 400); }

  // ── 2. 値は積むだけ ───────────────────────────────
  console.log("2. 値の履歴");
  const v1 = await svc.recordValue(human, PROJECT, a.id, { asOf: "2026-03-31", value: 61, note: "一次集計" });
  const v2 = await svc.recordValue(human, PROJECT, a.id, { asOf: "2026-03-31", value: 63, note: "確定値" });
  check("同じ基準日で積んでも上書きしない", v1.id !== v2.id && (await svc.listValues(a.id)).length === 2);
  const latest = await svc.latestValue(a.id);
  check("最新値は同じ基準日なら計算が新しい方", Number(latest.value) === 63);
  await svc.recordValue(human, PROJECT, a.id, { asOf: "2025-03-31", value: 55 });
  check("古い基準日を後から入れても最新値は動かない", Number((await svc.latestValue(a.id)).value) === 63);
  check("値の履歴にも経路と基準日が残る", latest.via === "ui" && latest.as_of === "2026-03-31");
  try { await svc.recordValue(human, PROJECT, a.id, { asOf: "2026/03/31", value: 1 }); check("基準日の形式を強制する", false); }
  catch (e) { check("基準日の形式を強制する", e.status === 400); }
  try { await svc.recordValue(human, PROJECT, "00000000-0000-4000-8000-00000000dead", { asOf: "2026-03-31", value: 1 }); check("他計画・不在の指標には積めない", false); }
  catch (e) { check("他計画・不在の指標には積めない", e.status === 404); }

  // ── 3. AI と人で同じ形になる ──────────────────────
  console.log("3. AI と人の操作");
  const b = await svc.createIndicator(ai, PROJECT, {
    label: "検証指標B", unit: "件", origin: "plan",
    target: { scope: "plan", targetValue: 30 },
  });
  await svc.recordValue(ai, PROJECT, b.id, { asOf: "2026-03-31", value: 12 });
  const rowsA = await q(`SELECT entity, action FROM activity_log WHERE project_id = $1 AND entity_id IN ($2) ORDER BY entity, action`, [PROJECT, a.id]);
  const rowsB = await q(`SELECT entity, action FROM activity_log WHERE project_id = $1 AND entity_id = $2 ORDER BY entity, action`, [PROJECT, b.id]);
  check("AI の操作でも指標の作成が同じ形で残る",
    rowsB.some((r) => r.entity === "indicator" && r.action === "create") &&
    rowsA.some((r) => r.entity === "indicator" && r.action === "create"));
  const viaB = await q(`SELECT via, dialogue_ref FROM activity_log WHERE entity_id = $1 AND entity = 'indicator'`, [b.id]);
  check("AI の操作は経路（dialogue）と対話の参照が残る",
    viaB[0].via === "dialogue" && viaB[0].dialogue_ref?.dialogue_id === "d-1");
  const shapeA = await q(`SELECT count(*)::int AS n FROM indicator_targets WHERE indicator_id = $1`, [a.id]);
  const shapeB = await q(`SELECT count(*)::int AS n FROM indicator_targets WHERE indicator_id = $1`, [b.id]);
  check("残る「状態」は人でも AI でも同じ（定義＋目標＋値）", shapeA[0].n === 1 && shapeB[0].n === 1);

  // ── 4. 目標のスコープ ─────────────────────────────
  console.log("4. 目標のスコープ");
  await svc.setTarget(human, PROJECT, a.id, { scope: "plan", targetValue: 85, achievementCondition: "gte" });
  check("同じスコープの目標は置き換わる（増えない）", (await svc.listTargets(a.id)).filter((t) => t.scope === "plan").length === 1);
  check("置き換えた値が反映される", Number((await svc.listTargets(a.id)).find((t) => t.scope === "plan").target_value) === 85);
  try { await svc.setTarget(human, PROJECT, a.id, { scope: "measure" }); check("施策スコープには施策の指定が要る", false); }
  catch (e) { check("施策スコープには施策の指定が要る", e.status === 400); }
  try { await svc.setTarget(human, PROJECT, a.id, { scope: "plan", measureDesignId: PROJECT }); check("計画スコープに施策は指定できない", false); }
  catch (e) { check("計画スコープに施策は指定できない", e.status === 400); }
  // setTarget は**目標を丸ごと置き換える**（部分更新ではない）。
  // 画面の PATCH が今の目標を読んでから渡しているのはこのため
  check("渡さなかった項目は消える（置き換えであることの確認）",
    (await svc.listTargets(a.id)).find((t) => t.scope === "plan").baseline_value === null);
  await svc.setTarget(human, PROJECT, a.id, {
    scope: "plan", targetValue: 85, achievementCondition: "gte",
    baselineValue: 50, baselineAsOf: "2025-04-01", targetDeadline: "2028-03-31",
  });

  // ── 5. 互換ビュー ─────────────────────────────────
  console.log("5. 互換ビュー kpis");
  const view = await q(`SELECT label, target::float AS target, current::float AS current, achievement_condition,
                               baseline_value::float AS baseline_value, baseline_year
                          FROM kpis WHERE project_id = $1 AND label = '検証指標A'`, [PROJECT]);
  check("旧来の列（target / current）を組んで返す", view[0]?.target === 85 && view[0]?.current === 63);
  check("基準値・基準年も返す", view[0]?.baseline_value === 50 && view[0]?.baseline_year === 2025);
  let viewWriteFailed = false;
  try { await q(`UPDATE kpis SET current = 1 WHERE project_id = $1`, [PROJECT]); }
  catch { viewWriteFailed = true; }
  check("ビューには書き込めない（切替漏れは実行時に必ず失敗する）", viewWriteFailed);

  // ── 6. 一覧 ───────────────────────────────────────
  console.log("6. 一覧");
  const list = await svc.listIndicators(PROJECT);
  const la = list.find((r) => r.label === "検証指標A");
  check("一覧に目標と最新値が添う", Number(la.target_value) === 85 && Number(la.latest_value) === 63);
  check("一覧に値の件数が出る", la.value_count === 3);
  check("最新値の経路も分かる", la.latest_via === "ui");

  // ── 7. 削除 ───────────────────────────────────────
  console.log("7. 削除");
  await svc.deleteIndicator(human, PROJECT, b.id);
  check("指標を消すと目標・値も消える",
    (await q(`SELECT count(*)::int AS n FROM indicator_targets WHERE indicator_id = $1`, [b.id]))[0].n === 0 &&
    (await q(`SELECT count(*)::int AS n FROM indicator_values WHERE indicator_id = $1`, [b.id]))[0].n === 0);
  check("削除しても履歴は残る",
    (await q(`SELECT count(*)::int AS n FROM activity_log WHERE entity_id = $1`, [b.id]))[0].n > 0);
  // ── 8. 指標エンジン（D4）実データで計算する ─────────
  console.log("8. 指標エンジン");
  // 集計データの箱を1つ作り、2つの版（2025 と 2026）を入れる
  const boxId = (await q(
    `INSERT INTO datasets (project_id, kind, name, schema, time_granularity)
     VALUES ($1, 'aggregate', '検証データ',
             '[{"name":"区分","role":"dimension","type":"text"},
               {"name":"時点","role":"time","type":"fiscal_year"},
               {"name":"対象","role":"measure","type":"int"},
               {"name":"該当","role":"measure","type":"int"}]'::jsonb, 'fiscal_year')
     RETURNING id`, [PROJECT]))[0].id;
  const mkVersion = async (asOfDate, rows) => {
    const vid = (await q(
      `INSERT INTO dataset_versions (dataset_id, as_of, status, row_count) VALUES ($1, $2::date, 'validated', $3) RETURNING id`,
      [boxId, asOfDate, rows.length]))[0].id;
    let n = 0;
    for (const r of rows) {
      await q(`INSERT INTO dataset_rows (dataset_version_id, row_no, dims, period, measures) VALUES ($1, $2, $3, $4::date, $5)`,
        [vid, ++n, JSON.stringify(r.dims), asOfDate, JSON.stringify(r.measures)]);
    }
    return vid;
  };
  const v2025 = await mkVersion("2025-03-31", [
    { dims: { 区分: "X" }, measures: { 対象: 100, 該当: 20 } },
    { dims: { 区分: "Y" }, measures: { 対象: 100, 該当: 40 } },
  ]);
  const v2026 = await mkVersion("2026-03-31", [
    { dims: { 区分: "X" }, measures: { 対象: 200, 該当: 30 } },
    { dims: { 区分: "Y" }, measures: { 対象: 200, 該当: 50 } },
  ]);

  const sum = await svc.createIndicator(human, PROJECT, {
    label: "検証・合計", unit: "人", calcType: "aggregate",
    spec: { type: "aggregate", datasetId: boxId, measure: "対象", method: "sum" },
  });
  const rate = await svc.createIndicator(human, PROJECT, {
    label: "検証・割合", unit: "", calcType: "aggregate",
    spec: { type: "aggregate", datasetId: boxId, measure: "該当", method: "rate", denominator: "対象" },
  });
  const filtered = await svc.createIndicator(human, PROJECT, {
    label: "検証・絞り込み", unit: "人", calcType: "aggregate",
    spec: { type: "aggregate", datasetId: boxId, measure: "該当", method: "sum", filters: [{ key: "区分", in: ["X"] }] },
  });

  const r1 = await svc.computeAndRecord(human, PROJECT, sum.id, "2026-03-31");
  check("集計型: 合計が出る", r1.ok && r1.value === 400);
  check("使った版が履歴に残る", r1.ok && r1.valueRow.inputs?.versions?.[0]?.datasetVersionId === v2026);
  const r2 = await svc.computeAndRecord(human, PROJECT, rate.id, "2026-03-31");
  check("集計型: 割合が出る（分子・分母も残る）",
    r2.ok && r2.value === 0.2 && Number(r2.valueRow.numerator) === 80 && Number(r2.valueRow.denominator) === 400);
  const r3 = await svc.computeAndRecord(human, PROJECT, filtered.id, "2026-03-31");
  check("集計型: 絞り込みが効く", r3.ok && r3.value === 30);

  // 基準日を遡ると、その時点以前で最新の版が選ばれる
  const r4 = await svc.computeAndRecord(human, PROJECT, sum.id, "2025-12-31");
  check("基準日以前で最も新しい版を使う", r4.ok && r4.value === 200 && r4.valueRow.inputs.versions[0].datasetVersionId === v2025);
  check("基準日ごとに履歴が並ぶ（上書きしない）",
    (await svc.listValues(sum.id)).length === 2);

  // どの版より前の基準日は「不足」— 何をいつ時点で上げるかが返る
  const r5 = await svc.computeAndRecord(human, PROJECT, sum.id, "2020-03-31");
  check("版が無い基準日は不足として返る", !r5.ok && r5.missing[0].reason === "no_version_before_as_of");
  check("不足に「今ある最新の時点」が入る", !r5.ok && r5.missing[0].latestAvailableAsOf === "2026-03-31");
  check("不足のときは履歴に積まない", (await svc.listValues(sum.id)).length === 2);

  // 無い列を指すと、列が無いこととして返る
  const badCol = await svc.createIndicator(human, PROJECT, {
    label: "検証・無い列", calcType: "aggregate",
    spec: { type: "aggregate", datasetId: boxId, measure: "存在しない列", method: "sum" },
  });
  const r6 = await svc.computeAndRecord(human, PROJECT, badCol.id, "2026-03-31");
  check("無い列は column_missing として返る", !r6.ok && r6.missing[0].reason === "column_missing");

  // 計算式型
  const formula = await svc.createIndicator(human, PROJECT, {
    label: "検証・式", unit: "％", calcType: "formula",
    spec: { type: "formula", expression: `{ind:${rate.id}} * 100` },
  });
  const r7 = await svc.computeAndRecord(human, PROJECT, formula.id, "2026-03-31");
  check("計算式型: 他の指標の同じ基準日の値から計算する", r7.ok && r7.value === 20);
  check("計算式型: 参照した指標の値も履歴に残る", r7.ok && r7.valueRow.inputs.indicators?.[0]?.indicatorId === rate.id);
  const r8 = await svc.computeAndRecord(human, PROJECT, formula.id, "2025-12-31");
  check("計算式型: 参照先の値が無い基準日は dependency_missing",
    !r8.ok && r8.missing[0].reason === "dependency_missing");

  // 経年比較型は個票が要る
  const longi = await svc.createIndicator(human, PROJECT, {
    label: "検証・経年", calcType: "longitudinal",
    spec: { type: "longitudinal", datasetId: boxId, attrKey: "x.y", monthsBack: 12, order: ["a", "b"], improvedWhen: "same_or_earlier" },
  });
  const r9 = await svc.computeAndRecord(human, PROJECT, longi.id, "2026-03-31");
  check("経年比較型は集計データでは計算できない", !r9.ok);

  // 手入力型は計算しない
  let manualRejected = false;
  try { await svc.computeAndRecord(human, PROJECT, a.id, "2026-03-31"); } catch (e) { manualRejected = e.status === 400; }
  check("手入力型に計算を求めたら断る", manualRejected);

  // 一括取得（計算式型はあとに回されること）
  const bulk = await svc.computeMany({ ...human, via: "bulk" }, PROJECT, [formula.id, sum.id, rate.id], "2026-03-31");
  check("一括: 全部計算できる", bulk.every((r) => r.ok));
  check("一括: 計算式型でも値が出る（依存を先に計算している）",
    bulk.find((r) => r.indicatorId === formula.id)?.value === 20);
  const viaBulk = await q(`SELECT via FROM indicator_values WHERE indicator_id = $1 ORDER BY computed_at DESC LIMIT 1`, [sum.id]);
  check("一括で取った値は経路が bulk で残る", viaBulk[0].via === "bulk");
} finally {
  await pool.query(`DELETE FROM municipalities WHERE id = $1`, [MUNI]).catch(() => {});
  await pool.end().catch(() => {});
  rmSync(work, { recursive: true, force: true });
  if (existsSync(bundle)) unlinkSync(bundle);
}

console.log(`\ncheck:indicatorsvc — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
