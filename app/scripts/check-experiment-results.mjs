#!/usr/bin/env node
/**
 * エビデンス循環（実験結果→昇格）の検査 — X2
 *
 * この検査を作った理由:
 *   昇格はエビデンスレベルを自動判定して施策のエビデンスに書き込む。
 *   レベル判定が甘くなる（逸脱を無視して高レベルを付ける等）と、
 *   次の計画が誤った強さの根拠を参照し、妥当性の追跡が壊れる。
 *   判定規則と EvidenceItem への変換の互換性をここで固定する。
 *
 * 使い方:
 *   node scripts/check-experiment-results.mjs
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

const work = mkdtempSync(join(tmpdir(), "expres-"));
try {
  const bundle = (src, out) => {
    const outFile = join(work, out);
    execFileSync(
      "npx",
      [
        "--no-install",
        "esbuild",
        join(APP_ROOT, "src", "lib", "measure", src),
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

  const er = await bundle("experimentResult.ts", "experimentResult.mjs");
  const types = await bundle("types.ts", "types.mjs");

  const {
    EFFECT_DIRECTIONS,
    isEffectDirection,
    levelForResult,
    studyDesignForResult,
    resultToEvidenceItem,
    statusAfterPromotion,
  } = er;

  // ── 語彙 ────────────────────────────────────────────
  check("効果方向は4種", EFFECT_DIRECTIONS.length === 4);
  check("isEffectDirection: 既知を通す", isEffectDirection("no_change"));
  check("isEffectDirection: 未知を弾く", !isEffectDirection("great"));

  // ── レベル判定（正直さの規則）────────────────────────
  check("RCT計画どおり → Lv4", levelForResult("rct", true) === 4);
  check("ステップド・ウェッジ計画どおり → Lv4", levelForResult("stepped_wedge", true) === 4);
  check("RCT逸脱あり → Lv3（1段下げ）", levelForResult("rct", false) === 3);
  check("DiD計画どおり → Lv3", levelForResult("did", true) === 3);
  check("マッチング逸脱あり → Lv2", levelForResult("matching", false) === 2);
  check("前後比較計画どおり → Lv2", levelForResult("prepost", true) === 2);
  check("前後比較逸脱あり → Lv1（下限1で止まる）", levelForResult("prepost", false) === 1);

  // ── 研究デザイン区分への写像 ─────────────────────────
  check("RCT系→rct", studyDesignForResult("cluster_rct", true) === "rct");
  check("待機リスト→rct", studyDesignForResult("waitlist", true) === "rct");
  check("RCT系逸脱→qed（無作為化を主張しない）", studyDesignForResult("rct", false) === "qed");
  check("DiD→qed", studyDesignForResult("did", true) === "qed");
  check("前後比較→prepost", studyDesignForResult("prepost", true) === "prepost");

  // ── EvidenceItem 変換 ───────────────────────────────
  const base = {
    design: "stepped_wedge",
    implemented_as_planned: true,
    deviation_note: null,
    period_start: "2026-04-01",
    period_end: "2027-03-31",
    sample_size: 240,
    primary_outcome: "通いの場の参加率",
    result_summary: "順次導入の各ステップで参加率が平均8ポイント上昇",
    effect_direction: "improved",
    effect_size: "+8pt（95%CI 3〜13）",
  };
  const item = resultToEvidenceItem(base, {
    measureTitle: "通いの場の送迎付き展開",
    targetPopulation: "後期高齢者",
  });
  check("変換: レベルが設計から引かれる", item.evidence_level === 4);
  check("変換: design=rct（無作為系）", item.design === "rct");
  check("変換: 出所が自プロジェクト実験と分かる", item.title.startsWith("自プロジェクト実験:"));
  check("変換: 効果の方向が明示される", item.effect_summary.includes("【改善】"));
  check("変換: 効果量が載る", item.effect_summary.includes("+8pt"));
  check("変換: n が載る", item.effect_summary.includes("n=240"));
  check("変換: year は期間末から", item.year === 2027);
  check("変換: population が写る", item.population === "後期高齢者");

  // 効かなかった実験も正直に昇格できる
  const nullResult = resultToEvidenceItem(
    { ...base, effect_direction: "no_change", effect_size: null },
    { measureTitle: "チラシ配布のみの周知" },
  );
  check("変換: 効果なしも【変化なし】として残る", nullResult.effect_summary.includes("【変化なし】"));

  // 逸脱ありは transferability に開示され、レベルが下がる
  const deviated = resultToEvidenceItem(
    { ...base, implemented_as_planned: false, deviation_note: "第2ステップで割付が崩れた" },
    { measureTitle: "x" },
  );
  check("変換: 逸脱はレベル-1", deviated.evidence_level === 3);
  check("変換: 逸脱内容を開示", (deviated.transferability ?? "").includes("割付が崩れた"));

  // 変換結果は既存の正規化を素通りする（施策の evidence_items と互換）
  const normalized = types.normalizeEvidenceItems([item, nullResult, deviated]);
  check("互換: normalizeEvidenceItems を通っても3件残る", normalized.length === 3);
  check("互換: レベルが保存される", normalized[0].evidence_level === 4);

  // ── evidence_status の更新規則 ──────────────────────
  check("Lv3以上 → sufficient", statusAfterPromotion("none", 4) === "sufficient");
  check("Lv3ちょうど → sufficient", statusAfterPromotion("partial", 3) === "sufficient");
  check("Lv2 で none → partial", statusAfterPromotion("none", 2) === "partial");
  check("Lv1 で partial → partial のまま", statusAfterPromotion("partial", 1) === "partial");
  check("Lv2 でも sufficient は下げない", statusAfterPromotion("sufficient", 2) === "sufficient");
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`check-experiment-results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
