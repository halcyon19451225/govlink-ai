#!/usr/bin/env node
/**
 * 計画（ロジックモデル）とKPIの整合検査のテスト（L3）
 *
 * この検査を作った理由:
 *   計画と測定は別々の画面で作られるため、両者が食い違ったまま
 *   評価に進む事故が起きていた。checkConsistency はその食い違いを出すが、
 *   検査自体が誤検出／見落としをすると、かえって信用を損なう。
 *   「何を出し、何を出さないか」をここで固定する。
 *
 * 使い方:
 *   node scripts/check-logicmodel-consistency.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

const work = mkdtempSync(join(tmpdir(), "lmcons-"));
const outFile = join(work, "consistency.mjs");
try {
  // consistency.ts は elements.ts と outcome/tiers.ts を参照する。
  // bundle して1ファイルにまとめ、@/ の別名も解決させる。
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "logicmodel", "consistency.ts"),
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

const { checkConsistency } = await import(pathToFileURL(outFile).href);
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

const el = (id, text, kpi_ids = []) => ({ id, text, kpi_ids });
const cols = (o = {}) => ({
  inputs: [],
  activities: [],
  outputs: [],
  initial_outcomes: [],
  intermediate_outcomes: [],
  long_outcomes: [],
  ...o,
});
const kpi = (id, label, indicator_type, contributes_to_kpi_id = null) => ({
  id,
  label,
  indicator_type,
  contributes_to_kpi_id,
});
const keys = (f) => f.map((x) => x.key.split(":")[0]);

// ── C1: 層のずれ ─────────────────────────────────────────
{
  const f = checkConsistency(
    cols({ intermediate_outcomes: [el("e1", "外出頻度が増える", ["k1"])] }),
    [],
    [kpi("k1", "参加者数", "outcome_initial")],
  );
  check("中間アウトカムに短期指標が付いていると警告する", keys(f).includes("tier"));
}
{
  const f = checkConsistency(
    cols({ intermediate_outcomes: [el("e1", "外出頻度が増える", ["k1"])] }),
    [],
    [kpi("k1", "外出率", "outcome_intermediate")],
  );
  check("層が一致していれば tier の指摘は出ない", !keys(f).includes("tier"));
}
{
  // 産出物にプロセス指標は自然な組み合わせ。誤検出しないこと
  const f = checkConsistency(
    cols({ outputs: [el("e1", "教室を24回開催", ["k1"])] }),
    [],
    [kpi("k1", "開催回数", "process")],
  );
  check("産出物×プロセス指標は誤検出しない", !keys(f).includes("tier"));
}

// ── C2: 同じKPIが複数層に ────────────────────────────────
{
  const f = checkConsistency(
    cols({
      initial_outcomes: [el("e1", "短期の成果", ["k1"])],
      intermediate_outcomes: [el("e2", "中間の成果", ["k1"])],
    }),
    [],
    [kpi("k1", "共有指標", "outcome_initial")],
  );
  check("同じKPIが2つの層に付いていると警告する", keys(f).includes("multi"));
}

// ── C3: 寄与関係 ─────────────────────────────────────────
{
  // 短期 → 中間、モデル上も短期列 → 中間列。指摘なし
  const f = checkConsistency(
    cols({
      initial_outcomes: [el("e1", "認知度が上がる", ["k1"])],
      intermediate_outcomes: [el("e2", "外出頻度が増える", ["k2"])],
    }),
    [],
    [kpi("k1", "認知度", "outcome_initial", "k2"), kpi("k2", "外出率", "outcome_intermediate")],
  );
  check("寄与が計画の向きと一致していれば指摘しない", !keys(f).some((k) => k.startsWith("contrib")));
}
{
  // 寄与の向きが逆（中間 → 短期）
  const f = checkConsistency(
    cols({
      initial_outcomes: [el("e1", "短期の成果", ["k2"])],
      intermediate_outcomes: [el("e2", "中間の成果", ["k1"])],
    }),
    [],
    [kpi("k1", "中間指標", "outcome_intermediate", "k2"), kpi("k2", "短期指標", "outcome_initial")],
  );
  const dir = f.find((x) => x.key.startsWith("contrib-dir"));
  check("寄与の向きが逆なら error として出す", !!dir && dir.severity === "error");
}
{
  // 寄与はあるが、モデル上は逆順に置かれている（中間列の要素 → 短期列の要素）
  const f = checkConsistency(
    cols({
      initial_outcomes: [el("e2", "短期側に置かれた親", ["k2"])],
      intermediate_outcomes: [el("e1", "中間側に置かれた子", ["k1"])],
    }),
    [],
    [kpi("k1", "子指標", "outcome_initial", "k2"), kpi("k2", "親指標", "outcome_intermediate")],
  );
  check("寄与の筋道が計画上たどれないと警告する", keys(f).includes("contrib-path"));
}
{
  // edges を明示した場合は到達可能性で判定する
  const c = cols({
    initial_outcomes: [el("e1", "短期", ["k1"])],
    intermediate_outcomes: [el("e2", "中間A", []), el("e3", "中間B", ["k2"])],
  });
  const ks = [kpi("k1", "子", "outcome_initial", "k2"), kpi("k2", "親", "outcome_intermediate")];
  const withPath = checkConsistency(c, [{ from: "e1", to: "e3" }], ks);
  const withoutPath = checkConsistency(c, [{ from: "e1", to: "e2" }], ks);
  check("edges に筋道があれば指摘しない", !keys(withPath).includes("contrib-path"));
  check("edges に筋道が無ければ指摘する", keys(withoutPath).includes("contrib-path"));
}

// ── C4: 指標の無い成果 ───────────────────────────────────
{
  const f = checkConsistency(
    cols({ intermediate_outcomes: [el("e1", "測れない成果", [])] }),
    [],
    [],
  );
  const n = f.find((x) => x.key.startsWith("nokpi"));
  check("アウトカムにKPIが無いと警告する", !!n && n.severity === "warning");
}
{
  const f = checkConsistency(cols({ long_outcomes: [el("e1", "長期の姿", [])] }), [], []);
  const n = f.find((x) => x.key.startsWith("nokpi"));
  check("長期アウトカムのKPI未割当は参考どまり", !!n && n.severity === "info");
}
{
  const f = checkConsistency(cols({ activities: [el("e1", "教室の開催", [])] }), [], []);
  check("活動にKPIが無くても指摘しない", !keys(f).includes("nokpi"));
}

// ── C5: どこにも紐付かないアウトカム指標 ─────────────────
{
  const f = checkConsistency(cols(), [], [kpi("k1", "宙に浮いた指標", "outcome_intermediate")]);
  check("紐付いていないアウトカム指標を参考として出す", keys(f).includes("orphan"));
}
{
  const f = checkConsistency(cols(), [], [kpi("k1", "プロセス指標", "process")]);
  check("プロセス指標は紐付いていなくても出さない", !keys(f).includes("orphan"));
}

// ── 何もなければ空 ───────────────────────────────────────
{
  const f = checkConsistency(
    cols({
      activities: [el("a1", "教室の開催", [])],
      outputs: [el("o1", "24回開催", ["k0"])],
      initial_outcomes: [el("e1", "認知度が上がる", ["k1"])],
      intermediate_outcomes: [el("e2", "外出頻度が増える", ["k2"])],
    }),
    [],
    [
      kpi("k0", "開催回数", "process"),
      kpi("k1", "認知度", "outcome_initial", "k2"),
      kpi("k2", "外出率", "outcome_intermediate"),
    ],
  );
  check("整合が取れていれば何も出ない", f.length === 0, `出た指摘: ${JSON.stringify(keys(f))}`);
}

// 並び順: error が先頭
{
  const f = checkConsistency(
    cols({
      initial_outcomes: [el("e1", "短期", ["k2"]), el("e3", "指標なし", [])],
      intermediate_outcomes: [el("e2", "中間", ["k1"])],
    }),
    [],
    [kpi("k1", "中間指標", "outcome_intermediate", "k2"), kpi("k2", "短期指標", "outcome_initial")],
  );
  check("重い指摘が先頭に来る", f.length > 1 && f[0].severity === "error");
}

console.log(`\n結果: 成功 ${passed} 件 / 失敗 ${failed} 件`);
if (failed > 0) {
  console.error("\n整合検査の挙動が期待と異なります。");
  process.exit(1);
}
