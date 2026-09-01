#!/usr/bin/env node
/**
 * 施策構築（EBPM）の整合性検査
 *
 * この検査を作った理由（2026-08-31 の実機テストで見つかった4件）:
 *   ①アプローチを取り下げる手段が無かった。担当者が「Cは別施策として後で扱う」と
 *     伝えたのに構造上応じられず、AIは a1 と同名の a2 を残したまま
 *     「データセットには含まれていません」と事実と違う説明をした。
 *     8/29 の誤選定事故（文章の中だけで統合したことにする）と同じ壊れ方。
 *   ②同じ measure_title のアプローチが並び、画面で見分けが付かなくなった。
 *   ③フェーズが cost → evidence へ逆行した。課題仮説設定にはある単調性の
 *     ガードが施策構築に無かった。
 *   ④書き出しの検査が「アプローチが1件以上あるか」だけで、エビデンスも実験設計も
 *     指標もコストも空のまま確定できた。下流（ロジックモデル・C評価・A改善）は
 *     揃っている前提で動くため、KPIの無い活動が並ぶことになる。
 *
 *   加えて 2026-09-01、実験設計はエビデンスの有無に関わらず必須とする方針を採った。
 *   他所で効いたことと、この町のこの対象で効いたことは別であり、後の評価で因果を
 *   論じるには比較の作り方を設計段階で決めておく必要がある（名簿・ベースライン・
 *   比較群は事業開始後には取り直せない）。手法はRCTに限らず、規模・割付の可否・
 *   閾値の有無・使えるデータから選ぶ。
 *
 * 使い方:
 *   node scripts/check-measure-integrity.mjs
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

const typesSrc = read(join(APP_ROOT, "src", "lib", "measure", "types.ts"));
const dlgSrc = read(join(APP_ROOT, "src", "lib", "measure", "dialogue.ts"));
const promptSrc = read(join(APP_ROOT, "src", "lib", "measure", "prompt.ts"));
const chatSrc = read(
  join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
    "measure-dialogue", "[dialogueId]", "chat", "route.ts"),
);
const commitSrc = read(
  join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
    "measure-dialogue", "[dialogueId]", "commit", "route.ts"),
);
const panelSrc = read(join(APP_ROOT, "src", "components", "measure", "MeasureDialoguePanel.tsx"));

// ── 1. アプローチの取り下げ ─────────────────────
check("types: retired を持つ", /retired\?: boolean/.test(typesSrc));
check("types: 取り下げ理由も残す", /retired_reason\?: string/.test(typesSrc));
check("types: activeApproaches がある", typesSrc.includes("export function activeApproaches"));
check("dialogue: applyApproachRetirements がある", dlgSrc.includes("export function applyApproachRetirements"));
check("dialogue: 取り下げても行は消さない", /retired: true/.test(dlgSrc) && !/filter\(\(a\) => !reasons\.has/.test(dlgSrc));
check("chat: 取り下げを取り込む", chatSrc.includes("applyApproachRetirements("));
check("prompt: retire_approaches をツールに持つ", promptSrc.includes("retire_approaches"));
check("prompt: 文章だけの取り下げを禁じている", promptSrc.includes("文章の中だけで取り下げたことにしてはいけません"));
check("prompt: 保存済みを「含まれていない」と説明させない", promptSrc.includes("含まれていません」と説明してはいけません"));
check("prompt: 取り下げ済みを整理内容に明示する", promptSrc.includes("取り下げ済"));
check("commit: 取り下げたアプローチを書き出さない", commitSrc.includes("activeApproaches(row.approaches)"));
check("画面: 取り下げを取り消し線で残す", panelSrc.includes("line-through") && panelSrc.includes("取り下げ"));

// ── 2. 同名アプローチの検出 ─────────────────────
check("types: duplicateApproachTitles がある", typesSrc.includes("export function duplicateApproachTitles"));
check("画面: 同名を知らせる", panelSrc.includes("同じ施策名のアプローチがあります"));
check("prompt: 同名を作らないよう指示する", promptSrc.includes("同じ measure_title を2件作らないでください"));
check("prompt: 同名を整理内容で警告する", promptSrc.includes("同じ施策名のアプローチが複数あります"));

// ── 3. フェーズの単調性 ────────────────────────
check(
  "dialogue: 要求された逆行を捨てる",
  /measureStepIndex\(requested\) < measureStepIndex\(current\) \? current : requested/.test(dlgSrc),
);
check("dialogue: 飛び越しの禁止は残っている", dlgSrc.includes("measureStepIndex(current) + 1"));

// ── 4. 実験設計は常に必須 ───────────────────────
check(
  "dialogue: 実験の対象をエビデンスで絞らない",
  /approachesNeedingExperiment[\s\S]{0,400}return activeApproaches\(data\.approaches\);/.test(dlgSrc),
);
check(
  "dialogue: 設計は手法と選定理由まで求める",
  /allExperimentsDesigned[\s\S]{0,400}rationale/.test(dlgSrc),
);
check("prompt: エビデンスがあっても省略させない", promptSrc.includes("参照できるエビデンスが揃っている（sufficient）場合でも省略しません"));
check("prompt: RCTに限定しないと明示する", promptSrc.includes("RCT に限りません"));
check("prompt: 採らなかった設計の記録を求める", promptSrc.includes("considered に、検討したが採らなかった設計と理由"));
check("prompt: 測定設計（名簿・ベースライン）を求める", promptSrc.includes("data_design"));
check("prompt: 前提の確かめ方を求める", promptSrc.includes("assumption_check"));
check("prompt: 未設計を整理内容で警告する", promptSrc.includes("実験設計が未作成のアプローチ"));

// 手法のはしごに、規模や割付の制約で選ぶ手法がそろっていること
for (const [key, label] of [
  ["rdd", "回帰不連続"],
  ["did", "差の差"],
  ["synthetic_control", "合成対照"],
  ["matching", "マッチング"],
  ["iv", "操作変数"],
  ["its", "中断時系列"],
  ["stepped_wedge", "ステップド・ウェッジ"],
  ["waitlist", "待機リスト"],
]) {
  check(`types: はしごに ${label}（${key}）がある`, new RegExp(`key: "${key}"`).test(typesSrc));
}
check(
  "prompt: ツールの enum が手法一覧と揃っている",
  ["rdd", "synthetic_control", "iv", "its"].every((k) => promptSrc.includes(`"${k}"`)),
);

// ── 5. 書き出しガード ──────────────────────────
check("types: measureCommitGaps がある", typesSrc.includes("export function measureCommitGaps"));
check("commit: 欠けた区画があれば 422", commitSrc.includes("measureCommitGaps(row)") && /status: 422/.test(commitSrc));
check("commit: 不足を名指しで返す", commitSrc.includes("describeMeasureGaps("));
check("画面: 揃うまで書き出せない", panelSrc.includes("committing || commitGaps.length > 0"));
check("画面: 不足の一覧を出す", panelSrc.includes("書き出しに必要な区画が埋まっていません"));

// ── 6. 純粋ロジックの実挙動 ─────────────────────
const work = mkdtempSync(join(tmpdir(), "measure-integrity-"));
const outFile = join(work, "types.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "measure", "types.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);

  const ap = (id, title, extra = {}) => ({
    id, root_cause: "rc", approach: "ap", measure_title: title,
    target: "t", intervention: "i", ...extra,
  });

  // 取り下げ
  const list = [ap("a1", "計画管理プロセス改革"), ap("a2", "広域整備協議", { retired: true })];
  check("退役: 生存中だけを返す", m.activeApproaches(list).map((a) => a.id).join() === "a1");

  // 同名検出
  check(
    "同名: 生存中の同名を検出する",
    m.duplicateApproachTitles([ap("a1", "同じ名前"), ap("a2", "同じ名前")]).join() === "同じ名前",
  );
  check(
    "同名: 取り下げた側は数えない",
    m.duplicateApproachTitles([ap("a1", "同じ名前"), ap("a2", "同じ名前", { retired: true })]).length === 0,
  );

  // 完成度
  const full = (id, design = "rct") => ({
    approaches: [ap(id, "施策")],
    evidence: [{ approach_id: id, status: "sufficient", items: [] }],
    experiments: [{
      approach_id: id, design, rationale: "規模から",
      ...(design === "rct" ? {} : { considered: [{ design: "rct", rejected_because: "検出力不足" }] }),
    }],
    indicators: [{
      approach_id: id, structure: ["体制"], process: [],
      outcome_initial: [{ label: "参加率", unit: "%" }], outcome_intermediate: [],
    }],
    costs: [{ approach_id: id, cost_per_outcome_note: "決算額÷実績" }],
  });

  check("完成度: 全区画そろえば欠けなし", m.measureCommitGaps(full("a1")).length === 0);

  const noExp = full("a1");
  noExp.experiments = [];
  const g1 = m.measureCommitGaps(noExp);
  check(
    "完成度: エビデンス sufficient でも実験設計を要求する",
    g1.length === 1 && g1[0].missing.includes("実験設計"),
  );

  const noReason = full("a1", "did");
  noReason.experiments[0].considered = [];
  const g2 = m.measureCommitGaps(noReason);
  check(
    "完成度: RCT以外なら不採用理由を要求する",
    g2.length === 1 && g2[0].missing.includes("採らなかった設計とその理由"),
  );
  check("完成度: RCTなら不採用理由は求めない", m.measureCommitGaps(full("a1", "rct")).length === 0);
  check("完成度: 理由を書けば通る", m.measureCommitGaps(full("a1", "did")).length === 0);

  const noKpi = full("a1");
  noKpi.indicators[0].outcome_initial = [];
  check(
    "完成度: 短期アウトカムKPIを要求する",
    m.measureCommitGaps(noKpi)[0].missing.includes("短期アウトカムKPI"),
  );

  const noCost = full("a1");
  noCost.costs = [];
  check("完成度: コストの算定式を要求する", m.measureCommitGaps(noCost)[0].missing.includes("コスト（算定式）"));

  const retired = full("a1");
  retired.approaches.push(ap("a2", "取り下げた案", { retired: true }));
  check("完成度: 取り下げたアプローチは要求しない", m.measureCommitGaps(retired).length === 0);

  // 同名のアプローチが並ぶと名前だけでは区別が付かないので、IDを先に出す
  check(
    "完成度: 不足の説明文はIDと施策名の両方を出す",
    m.describeMeasureGaps(m.measureCommitGaps(noExp)).startsWith("a1「施策」: "),
  );

  // 手法メタ
  check("はしご: 前後比較のレベルは2", m.EXPERIMENT_DESIGN_META.prepost.level === 2);
  check("はしご: 回帰不連続のレベルは4", m.EXPERIMENT_DESIGN_META.rdd.level === 4);
  check("はしご: RCTがはしごの先頭", m.EXPERIMENT_DESIGNS[0].key === "rct");
  check("はしご: 前後比較がはしごの最後", m.EXPERIMENT_DESIGNS[m.EXPERIMENT_DESIGNS.length - 1].key === "prepost");

  // 検討した手法の取り込み
  check(
    "considered: 未知のキーは落とす",
    m.normalizeConsideredDesigns([{ design: "unknown", rejected_because: "x" }]).length === 0,
  );
  check(
    "considered: 理由が空なら落とす",
    m.normalizeConsideredDesigns([{ design: "rct", rejected_because: "  " }]).length === 0,
  );
  check(
    "considered: 同じ手法は1件にまとめる",
    m.normalizeConsideredDesigns([
      { design: "rct", rejected_because: "検出力不足" },
      { design: "rct", rejected_because: "重複" },
    ]).length === 1,
  );
} catch (e) {
  check(`types.ts のバンドル/実行: ${e instanceof Error ? e.message : e}`, false);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck-measure-integrity: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
