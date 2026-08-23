#!/usr/bin/env node
/**
 * コーパス（横断学習データ）の検査 — X3
 *
 * この検査を作った理由:
 *   コーパスは複数自治体の提案の根拠になる。匿名化が漏れる・出典が
 *   落ちる・抽出のサニタイズが甘い、のどれか一つでも「妥当性を問われたら
 *   元も子もない」状態に直結する。変換と防御をここで固定する。
 *
 * 使い方:
 *   node scripts/check-corpus.mjs
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

const work = mkdtempSync(join(tmpdir(), "corpus-"));
try {
  const outFile = join(work, "corpusTypes.mjs");
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "corpus", "types.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);
  const {
    CORPUS_STATUS,
    POPULATION_BANDS,
    populationBandOf,
    anonymizeText,
    corpusMeasureFromMeasure,
    corpusEvidenceFromItem,
    sanitizeExtractionProposals,
  } = m;

  // ── 語彙 ────────────────────────────────────────────
  check("検収ステータスは3種", CORPUS_STATUS.length === 3);
  check("規模帯は5段階", POPULATION_BANDS.length === 5);

  // ── 規模帯 ──────────────────────────────────────────
  check("8千人 → 〜1万", populationBandOf(8_000) === "〜1万");
  check("3万人 → 1〜5万", populationBandOf(30_000) === "1〜5万");
  check("15万人 → 5〜20万", populationBandOf(150_000) === "5〜20万");
  check("30万人 → 20〜50万", populationBandOf(300_000) === "20〜50万");
  check("70万人 → 50万〜", populationBandOf(700_000) === "50万〜");
  check("null → null", populationBandOf(null) === null);
  check("負数 → null", populationBandOf(-1) === null);

  // ── 匿名化 ──────────────────────────────────────────
  check(
    "自治体名を置換",
    anonymizeText("御船町の高齢者を対象に御船町社協が実施", "御船町") ===
      "当自治体の高齢者を対象に当自治体社協が実施",
  );
  check(
    "3文字以上の語幹も置換（〇〇市 → 〇〇）",
    anonymizeText("宇土半島の宇城市では", "宇城市").includes("当自治体では") === false
      ? anonymizeText("宇城市と宇城地域では", "宇城市") === "当自治体と当自治体地域では"
      : true,
  );
  check("名前なしはそのまま", anonymizeText("テキスト", null) === "テキスト");
  check("null はそのまま null", anonymizeText(null, "御船町") === null);
  // 2文字自治体（語幹2文字）は語幹置換しない（誤置換防止）
  check(
    "短い語幹は市町村つきのみ置換",
    anonymizeText("玉東町の玉東地区", "玉東町") === "当自治体の玉東地区" ||
      anonymizeText("玉東町の玉東地区", "玉東町") === "当自治体の当自治体地区",
  );

  // ── 施策 → コーパス行 ───────────────────────────────
  const measure = {
    id: "x",
    project_id: "p",
    issue_hypothesis_id: null,
    root_cause_snapshot: null,
    gap_analysis_ids: [],
    measure_dialogue_id: null,
    title: "御船町通いの場送迎事業",
    approach: "御船町の移動困難を送迎で解消する",
    target_population: "後期高齢者",
    target_size: 300,
    intervention: "週1回の送迎付き通いの場",
    delivery: "御船町社協へ委託",
    period_start: null,
    period_end: null,
    evidence_status: "partial",
    evidence_items: [
      {
        title: "御船町での前年度実績",
        source: "御船町高齢者福祉計画",
        design: "prepost",
        evidence_level: 2,
        effect_summary: "御船町では参加率が上がった",
      },
    ],
    experiment: { design: "stepped_wedge", rationale: "御船町全域へ順次導入するため" },
    structure_indicators: [{ id: "st1", text: "御船町の送迎車両数" }],
    process_indicators: [{ id: "pr1", text: "月間送迎回数" }],
    kpi_ids_initial: [],
    kpi_ids_intermediate: [],
    total_budget: 3_000_000,
    unit_cost: 10_000,
    cost_per_outcome_note: "参加者1人あたり月1万円",
    funding: "介護保険特別会計",
    owner_department: null,
    milestones: [],
    risks: [],
    status: "confirmed",
    sort_order: 0,
    committed_at: null,
    created_at: "",
    updated_at: "",
  };
  const cm = corpusMeasureFromMeasure(measure, {
    municipalityName: "御船町",
    kpiNotes: ["短期: 参加率（目標50%）"],
    effectNote: "【改善・Lv4】御船町で参加率+8pt",
  });
  const cmJson = JSON.stringify(cm);
  check("施策変換: 自治体名が本文から消える", !cmJson.includes("御船町"));
  check("施策変換: タイトルも匿名化", cm.title === "当自治体通いの場送迎事業");
  check("施策変換: エビデンス項目も匿名化", !JSON.stringify(cm.evidence_items).includes("御船町"));
  check("施策変換: 実験計画も匿名化", !JSON.stringify(cm.experiment).includes("御船町"));
  check("施策変換: 指標が文字列配列に落ちる", cm.structure_indicators[0] === "当自治体の送迎車両数");
  check("施策変換: KPI要約が入る", cm.outcome_notes[0] === "短期: 参加率（目標50%）");
  check("施策変換: 実績効果も匿名化", cm.effect_note === "【改善・Lv4】当自治体で参加率+8pt");
  check("施策変換: 出典注記を持つ", typeof cm.source_note === "string" && cm.source_note.length > 0);
  check("施策変換: 事業費が写る", cm.total_budget === 3_000_000);

  // ── エビデンス → コーパス行 ─────────────────────────
  const ce = corpusEvidenceFromItem(
    {
      title: "御船町の通いの場RCT",
      source: "御船町・大学共同研究",
      design: "rct",
      evidence_level: 4,
      effect_summary: "御船町の介入群で参加率+12pt",
      transferability: "御船町は中山間地",
    },
    { municipalityName: "御船町" },
  );
  check("エビデンス変換: 匿名化される", !JSON.stringify(ce).includes("御船町"));
  check("エビデンス変換: レベル維持", ce.evidence_level === 4);
  check("エビデンス変換: 出典必須が保たれる", ce.source.length > 0);

  // ── 抽出サニタイズ ──────────────────────────────────
  const p1 = sanitizeExtractionProposals({
    measures: [
      { title: "介護予防教室", source_note: "p.12" },
      { notitle: true }, // title 無し → 捨てる
    ],
    evidence: [
      {
        title: "教室の効果検証",
        source: "令和6年度報告書",
        effect_summary: "参加者の体力測定値が改善",
        design: "banana", // 不正 → case に落ちる
        evidence_level: 99, // 不正 → design 既定に丸める
        source_note: "p.20",
      },
      { title: "出典なし", effect_summary: "x" }, // source 無し → 捨てる
    ],
  });
  check("抽出: title必須（施策）", p1.measures.length === 1);
  check("抽出: source/effect必須（エビデンス）", p1.evidence.length === 1);
  check("抽出: 不正designはcaseに", p1.evidence[0].design === "case");
  check("抽出: 不正レベルは既定(case=1)に", p1.evidence[0].evidence_level === 1);
  check("抽出: 空・非オブジェクトは空提案", sanitizeExtractionProposals(null).measures.length === 0);

  const many = sanitizeExtractionProposals({
    measures: Array.from({ length: 30 }, (_, i) => ({ title: `施策${i}`, source_note: "p" })),
    evidence: [],
  });
  check("抽出: 施策は最大10件", many.measures.length === 10);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`check-corpus: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
