#!/usr/bin/env node
/**
 * コーパス接地（検索・積算内訳）の検査 — X4
 *
 * この検査を作った理由:
 *   接地は「関係のある実績だけを、出所つきで」注入できて初めて価値がある。
 *   スコアリングが無関係な行を通す・整形が出所や実績を落とす・
 *   積算内訳のサニタイズが甘い、のいずれも提案の妥当性を壊す。
 *   バイグラム検索の挙動と整形・内訳の防御をここで固定する。
 *
 * 使い方:
 *   node scripts/check-corpus-match.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const work = mkdtempSync(join(tmpdir(), "cmatch-"));
try {
  const bundle = (rel, out) => {
    const outFile = join(work, out);
    execFileSync(
      "npx",
      [
        "--no-install",
        "esbuild",
        join(APP_ROOT, "src", "lib", ...rel),
        "--bundle",
        "--format=esm",
        "--target=es2020",
        "--platform=neutral",
        `--alias:@=${join(APP_ROOT, "src")}`,
        `--outfile=${outFile}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
    );
    return import(pathToFileURL(outFile).href);
  };

  const match = await bundle(["corpus", "match.ts"], "match.mjs");
  const types = await bundle(["measure", "types.ts"], "types.mjs");

  const {
    bigrams,
    overlap,
    scoreMeasure,
    scoreEvidence,
    rank,
    formatMeasureBlock,
    formatEvidenceBlock,
    formatCostBlock,
    qualityWeight,
    adoptionBonus,
    rankMeasuresSmart,
    estimateBudget,
    formatBudgetEstimateBlock,
  } = match;

  // ── バイグラム ──────────────────────────────────────
  const q = bigrams("介護予防教室の参加率");
  check("bigrams: 2-gram が取れる", q.has("介護") && q.has("予防") && q.has("護予"));
  check("bigrams: 空はサイズ0", bigrams("").size === 0);
  check("bigrams: null はサイズ0", bigrams(null).size === 0);
  check("overlap: 類似文で重なる", overlap(q, "介護予防の教室を運営") >= 3);
  check("overlap: 無関係文はほぼ重ならない", overlap(q, "道路の舗装補修工事") === 0);
  check(
    "正規化: 全角記号・空白を無視して重なる",
    overlap(bigrams("参加率５０％"), "参加率50%") >= 2,
  );

  // ── スコアリング・ランキング ─────────────────────────
  const rows = [
    {
      id: "m1",
      title: "介護予防教室の送迎付き展開",
      field_category: "介護予防",
      population_band: "1〜5万",
      approach: "移動困難による不参加を送迎で解消する",
      target_population: "後期高齢者",
      intervention: "週1回の教室と送迎",
      outcome_notes: ["短期: 参加率（目標50%）"],
      effect_note: "【改善・Lv4】参加率+8pt",
      evidence_status: "sufficient",
      total_budget: 3000000,
      unit_cost: 10000,
      cost_per_outcome_note: "総事業費÷新規参加者数",
      funding: "介護保険特別会計",
    },
    {
      id: "m2",
      title: "橋梁の長寿命化修繕",
      field_category: "土木",
      population_band: null,
      approach: "予防保全で更新費を平準化",
      target_population: null,
      intervention: "定期点検と補修",
      outcome_notes: [],
      effect_note: null,
      evidence_status: "partial",
      total_budget: null,
      unit_cost: null,
      cost_per_outcome_note: null,
      funding: null,
    },
  ];
  const qm = bigrams("介護予防 高齢者の教室参加率を上げたい");
  const s1 = scoreMeasure(qm, rows[0], null);
  const s2 = scoreMeasure(qm, rows[1], null);
  check("scoreMeasure: 関連施策が高スコア", s1 > s2);
  check("scoreMeasure: 無関係施策は低スコア", s2 < 3);
  check(
    "scoreMeasure: 規模帯一致で加点",
    scoreMeasure(qm, rows[0], "1〜5万") === s1 + 2,
  );

  const ranked = rank(rows, (r) => scoreMeasure(qm, r, null), { limit: 5, minScore: 3 });
  check("rank: しきい値未満は落ちる", ranked.length === 1 && ranked[0].row.id === "m1");
  check("rank: スコア0のクエリでは空", rank(rows, () => 0).length === 0);

  // ── 整形 ────────────────────────────────────────────
  const mb = formatMeasureBlock(ranked);
  check("施策ブロック: 匿名の出所を明示", mb.includes("他自治体の確定済みデータ・匿名"));
  check("施策ブロック: 実績効果が載る", mb.includes("【改善・Lv4】参加率+8pt"));
  check("施策ブロック: コストが載る", mb.includes("3,000,000円"));
  check("施策ブロック: 0件は null", formatMeasureBlock([]) === null);

  const eb = formatEvidenceBlock([
    {
      row: {
        id: "e1",
        title: "送迎付き教室のRCT",
        field_category: "介護予防",
        source: "Coe実験記録（ステップド・ウェッジ（順次導入））",
        year: 2027,
        design: "rct",
        evidence_level: 4,
        population: "後期高齢者",
        effect_summary: "参加率+8pt",
        transferability: "中山間地",
      },
      score: 10,
    },
  ]);
  check("エビデンスブロック: レベルとdesignを明示", eb.includes("[Lv4/rct]"));
  check("エビデンスブロック: 出典つき", eb.includes("Coe実験記録"));

  const cb = formatCostBlock(ranked);
  check("コストブロック: 算定式が載る", cb.includes("総事業費÷新規参加者数"));
  check("コストブロック: コスト無し行のみなら null", formatCostBlock([{ row: rows[1], score: 5 }]) === null);
  const cb2 = formatCostBlock([
    { row: { ...rows[0], id: "a", unit_cost: 8000 }, score: 9 },
    { row: { ...rows[0], id: "b", unit_cost: 15000 }, score: 8 },
  ]);
  check("コストブロック: 単価レンジを示す", cb2.includes("8,000円〜15,000円"));

  // ── 積算内訳の取り込み ──────────────────────────────
  const { normalizeBudgetBreakdown } = types;
  const bd = normalizeBudgetBreakdown([
    { item: "委託料", amount: 2400000, note: "週1回×48回×5万円" },
    { item: "報償費", amount: -5 }, // 負の金額は捨てる（費目は残す）
    { item: "  " }, // 費目なし → 捨てる
    { item: "需用費" },
    "文字列", // 非オブジェクト → 捨てる
  ]);
  check("内訳: 費目必須", bd.length === 3);
  check("内訳: 金額と根拠が写る", bd[0].amount === 2400000 && bd[0].note === "週1回×48回×5万円");
  check("内訳: 負の金額は落とす", bd[1].amount === undefined);
  check("内訳: 非配列は空", normalizeBudgetBreakdown(null).length === 0);
  check(
    "内訳: 最大12費目",
    normalizeBudgetBreakdown(Array.from({ length: 20 }, (_, i) => ({ item: `費目${i}` }))).length === 12,
  );

  // ── X6: 推薦ランキング（品質×採択実績）────────────────
  check("品質係数: 情報ゼロは1.0", qualityWeight({ ...rows[1], effect_note: null, evidence_status: "none", outcome_notes: [], unit_cost: null, cost_per_outcome_note: null }) === 1.0);
  check("品質係数: sufficient+改善+コスト+指標で最大級", qualityWeight(rows[0]) > 1.8);
  check(
    "品質係数: 「変化なし」実績にも価値（+0.15）",
    qualityWeight({ ...rows[0], effect_note: "【変化なし】差が出なかった" }) <
      qualityWeight(rows[0]),
  );
  check("採択ボーナス: 0回は0", adoptionBonus(0) === 0);
  check(
    "採択ボーナス: 逓減（1回あたりの増分が小さくなる）",
    adoptionBonus(2) - adoptionBonus(1) < adoptionBonus(1) - adoptionBonus(0),
  );
  check("採択ボーナス: 上限0.6", adoptionBonus(1000) === 0.6);

  // 同程度の適合度なら品質の高い行が上に来る
  const twin = {
    ...rows[0],
    id: "m1b",
    evidence_status: "none",
    effect_note: null,
    unit_cost: null,
    cost_per_outcome_note: null,
    outcome_notes: [],
  };
  const smart = rankMeasuresSmart(qm, [twin, rows[0]], { limit: 5, minScore: 3 });
  check("推薦: 品質の高い行が先頭", smart[0]?.row.id === "m1");
  // 採択実績で逆転できる（ただし適合しない行は救えない）
  const smart2 = rankMeasuresSmart(qm, [twin, rows[0]], {
    limit: 5,
    minScore: 3,
    adoptionByRowId: new Map([["m1b", 50]]),
  });
  check("推薦: 大きな採択実績でも品質差を覆すには限度（上限0.6）", smart2[0]?.row.id === "m1");
  const smartIrrelevant = rankMeasuresSmart(qm, [rows[1]], {
    limit: 5,
    minScore: 3,
    adoptionByRowId: new Map([["m2", 100]]),
  });
  check("推薦: 適合しない行は採択実績があっても出さない", smartIrrelevant.length === 0);

  // ── X6: 積算推定 ────────────────────────────────────
  const estRows = [8000, 10000, 15000].map((u, i) => ({
    row: { ...rows[0], id: `u${i}`, unit_cost: u },
    score: 10 - i,
  }));
  const est = estimateBudget(estRows, 300);
  check("推定: 中央値", est?.unit_median === 10000);
  check("推定: レンジ", est?.unit_min === 8000 && est?.unit_max === 15000);
  check("推定: 規模×中央値の概算総額", est?.total_mid === 3000000);
  check("推定: 1件では出さない", estimateBudget([estRows[0]], 300) === null);
  check("推定: 規模不明なら総額なし", estimateBudget(estRows)?.total_mid === undefined);
  const estBlock = formatBudgetEstimateBlock(est);
  check("推定ブロック: 中央値とレンジを明示", estBlock.includes("10,000円") && estBlock.includes("8,000円〜15,000円"));
  check("推定ブロック: 機械的概算の注意書き", estBlock.includes("機械的な概算"));
  check("推定ブロック: null は null", formatBudgetEstimateBlock(null) === null);

  // ── 対話サニタイズとの結線 ──────────────────────────
  const dlg = await bundle(["measure", "dialogue.ts"], "dialogue.mjs");
  const costs = dlg.sanitizeCosts(
    [
      {
        approach_id: "a1",
        cost_per_outcome_note: "総事業費÷参加者数",
        total_budget: 3000000,
        breakdown: [{ item: "委託料", amount: 2400000 }],
      },
    ],
    new Set(["a1"]),
  );
  check("sanitizeCosts: breakdown が通る", costs[0]?.breakdown?.[0]?.item === "委託料");
  const costs2 = dlg.sanitizeCosts(
    [{ approach_id: "a1", cost_per_outcome_note: "式", breakdown: [{ note: "費目なし" }] }],
    new Set(["a1"]),
  );
  check("sanitizeCosts: 不正な内訳は breakdown ごと省略", costs2[0]?.breakdown === undefined);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`check-corpus-match: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
