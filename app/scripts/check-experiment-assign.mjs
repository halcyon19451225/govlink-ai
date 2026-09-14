#!/usr/bin/env node
/**
 * 実験の割付の検査 — check:assign（D7）
 *
 * 設計: claude/coe-dataset-model.md §5-3・§11・§13-11
 *
 * 割付は**事前登録の代わり**をしている。結果を見てから群を動かせるなら、比較の意味が消える。
 * だから守るものは2つ:
 *   ① **同じ種なら同じ割付になる**（後から再現できないものは検証できない）
 *   ② **群は動かせない**（付け替え・削除を DB が断る）
 *
 * ここでは純関数を**実物から束ねて**動かす（文字列の照合ではなく、実際に割り付けて確かめる）。
 *
 * 使い方: node scripts/check-experiment-assign.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const SRC = join(APP_ROOT, "src");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (detail) console.error(`      ${detail}`);
  }
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
/** コメントを落とす。**規律は実装に掛ける** — 注記に書いた言葉で検査が落ちないように */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const work = mkdtempSync(join(tmpdir(), "assign-"));
try {
  const out = join(work, "assign.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(SRC, "lib", "experiment", "assign.ts"),
     "--bundle", "--format=esm", "--platform=node", "--target=es2022", "--packages=external",
     `--alias:@=${join(SRC)}`, `--outfile=${out}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(out).href);

  const units = (n, opts = {}) =>
    Array.from({ length: n }, (_, i) => ({
      sid: `S${String(i).padStart(3, "0")}`,
      ...(opts.strata ? { stratum: opts.strata[i % opts.strata.length] } : {}),
      ...(opts.clusters ? { clusterKey: opts.clusters[i % opts.clusters.length] } : {}),
    }));

  // ── 1. 同じ種なら同じ割付 ───────────────────────────
  console.log("1. 再現性");
  const a1 = m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["treatment", "control"], units: units(200) });
  const a2 = m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["treatment", "control"], units: units(200) });
  check("割り付けられる", a1.ok && a2.ok, a1.ok ? "" : a1.reason);
  check("同じ種・同じ対象なら、まったく同じ割付になる",
    JSON.stringify(a1.assignments) === JSON.stringify(a2.assignments));
  const a3 = m.assign({ design: "rct", seed: "seed-beta-2026", arms: ["treatment", "control"], units: units(200) });
  check("種が違えば割付は変わる", JSON.stringify(a1.assignments) !== JSON.stringify(a3.assignments));
  check("種の指紋が一致する", a1.seedDigest === a2.seedDigest && a1.seedDigest !== a3.seedDigest);
  check("種そのものは戻り値に入っていない", !JSON.stringify(a1).includes("seed-alpha-2026"));
  // 対象の並び順を変えても結果が変わらない（入力の順に依存しない）
  const shuffled = [...units(200)].reverse();
  const a4 = m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["treatment", "control"], units: shuffled });
  check("対象の並び順を変えても同じ割付になる",
    a4.ok && JSON.stringify(a1.assignments) === JSON.stringify(a4.assignments));

  // ── 2. 群の大きさ ───────────────────────────────────
  console.log("2. 群の大きさ");
  check("2群がほぼ等しい", Math.abs(a1.summary.treatment - a1.summary.control) <= 1,
    JSON.stringify(a1.summary));
  const a5 = m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["a", "b", "c"], units: units(99) });
  check("3群でも等しく割れる", a5.ok && a5.summary.a === 33 && a5.summary.b === 33 && a5.summary.c === 33);
  const strat = m.assign({
    design: "rct", seed: "seed-alpha-2026", arms: ["t", "c"],
    units: units(120, { strata: ["若", "中", "高"] }),
  });
  check("層別しても2群がほぼ等しい", strat.ok && Math.abs(strat.summary.t - strat.summary.c) <= 1);
  {
    // 層の中でも均されていること（層ごとの差が1以内）
    const per = {};
    for (const x of strat.assignments) {
      per[x.stratum] ??= { t: 0, c: 0 };
      per[x.stratum][x.arm]++;
    }
    const worst = Math.max(...Object.values(per).map((v) => Math.abs(v.t - v.c)));
    check("どの層の中でも群の大きさが揃う", worst <= 1, JSON.stringify(per));
  }

  // ── 3. クラスター単位 ───────────────────────────────
  console.log("3. クラスター単位");
  const cl = m.assign({
    design: "cluster_rct", seed: "seed-alpha-2026", arms: ["t", "c"],
    units: units(120, { clusters: ["A", "B", "C", "D", "E", "F"] }),
  });
  check("クラスター単位で割り付けられる", cl.ok, cl.ok ? "" : cl.reason);
  {
    const byCluster = {};
    for (const x of cl.assignments) {
      byCluster[x.clusterKey] ??= new Set();
      byCluster[x.clusterKey].add(x.arm);
    }
    const split = Object.entries(byCluster).filter(([, s]) => s.size > 1);
    check("同じクラスターの人は必ず同じ群", split.length === 0,
      `割れたクラスター: ${split.map(([k]) => k).join(", ")}`);
  }
  const noCluster = m.assign({
    design: "cluster_rct", seed: "seed-alpha-2026", arms: ["t", "c"], units: units(30),
  });
  check("クラスターが無いクラスター設計は断る", !noCluster.ok);
  check("断る理由に「混ざる」ことが書いてある", !noCluster.ok && /混ざ/.test(noCluster.reason));
  const crossStratum = m.assign({
    design: "cluster_rct", seed: "seed-alpha-2026", arms: ["t", "c"],
    units: [
      { sid: "S1", clusterKey: "A", stratum: "若" },
      { sid: "S2", clusterKey: "A", stratum: "高" },
      { sid: "S3", clusterKey: "B", stratum: "若" },
      { sid: "S4", clusterKey: "B", stratum: "若" },
    ],
  });
  check("クラスターが層をまたぐ場合は断る", !crossStratum.ok);

  // ── 4. 割り付けてよい設計だけ ───────────────────────
  console.log("4. 割り付けてよい設計だけを割り付ける");
  for (const d of ["rdd", "did", "its", "matching", "iv", "synthetic_control", "prepost"]) {
    const r = m.assign({ design: d, seed: "seed-alpha-2026", arms: ["t", "c"], units: units(50) });
    check(`${d} では割付を作らない`, !r.ok);
  }
  for (const d of ["rct", "cluster_rct", "stepped_wedge", "waitlist"]) {
    check(`${d} は割付の対象`, m.isAssignable(d));
  }
  {
    const r = m.assign({ design: "did", seed: "seed-alpha-2026", arms: ["t", "c"], units: units(50) });
    check("断る理由が「データ側で決まっている」と説明している",
      !r.ok && /データ側で決まって/.test(r.reason));
  }

  // ── 5. 入力の検査 ───────────────────────────────────
  console.log("5. 入力の検査");
  check("群が1つだけなら断る",
    !m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["t"], units: units(10) }).ok);
  check("群の名前が重複していたら断る",
    !m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["t", "t"], units: units(10) }).ok);
  check("同じ人が2回入っていたら断る",
    !m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["t", "c"],
                units: [{ sid: "S1" }, { sid: "S1" }] }).ok);
  check("種が短すぎたら断る",
    !m.assign({ design: "rct", seed: "x", arms: ["t", "c"], units: units(10) }).ok);
  check("対象が群の数より少なければ断る（空の群を作らない）",
    !m.assign({ design: "rct", seed: "seed-alpha-2026", arms: ["a", "b", "c"],
                units: units(2) }).ok);

  // ── 6. 寄せによる食い違い ───────────────────────────
  console.log("6. 寄せによる食い違い（§13-11）");
  const asg = [
    { sid: "S1", arm: "t" }, { sid: "S2", arm: "c" },
    { sid: "S3", arm: "t" }, { sid: "S4", arm: "t" },
    { sid: "S5", arm: "c" },
  ];
  const canon = new Map([["S2", "S1"], ["S4", "S3"]]);
  const conflicts = m.detectMergeConflicts(asg, canon);
  check("寄せた結果の食い違いを2件見つける", conflicts.length === 2, JSON.stringify(conflicts));
  check("違う群に割り付けられていた人を見分ける",
    conflicts.some((c) => c.kind === "different_arms" && c.arms.length === 2));
  check("二重に数えられていた人を見分ける",
    conflicts.some((c) => c.kind === "double_counted"));
  check("食い違いが無ければ空", m.detectMergeConflicts(asg, new Map()).length === 0);
  check("説明文が「どちらの群としても数えられない」と言う",
    /どちらの群としても数えられません/.test(
      m.describeMergeConflict(conflicts.find((c) => c.kind === "different_arms")),
    ));

  // ── 7. 乱数を使っていないこと ───────────────────────
  console.log("7. 乱数を使っていない");
  const srcAssign = stripComments(read(join(SRC, "lib", "experiment", "assign.ts")));
  check("Math.random を使っていない", !/Math\.random/.test(srcAssign),
    "乱数を使うと、同じ種でも同じ割付にならず、事前登録の意味が消える");
  check("randomUUID / randomBytes も使っていない", !/randomUUID|randomBytes/.test(srcAssign));
  check("純関数の層は DB に触らない",
    !/@\/lib\/db|query\(/.test(srcAssign));
  // ソースに生の制御文字（区切りに使いがち）を混ぜない。
  // 見えない上に、編集の途中で落ちても気づけない
  check("ソースに生の制御文字が入っていない",
    !/[\u0000-\u0008\u000E-\u001F]/.test(read(join(SRC, "lib", "experiment", "assign.ts"))),
    "区切りには長さを前に置いた文字列を使う");

  // ── 8. 生成は1回だけ・凍結 ──────────────────────────
  console.log("8. 凍結");
  const svc = read(join(SRC, "lib", "experiment", "service.ts"));
  const svcCode = stripComments(svc);
  check("既に割付がある対象群には作らない", /割付はやり直せません/.test(svc));
  check("やり直しの道を示している（新しい対象群）", /新しい対象群/.test(svc));
  check("生成は activity_log に残る", /logActivity\(/.test(svc));
  check("生成した担当者を残す（AI ではない）", /assigned_by/.test(svc) && /actor\.userRoleId/.test(svc));
  check("割付のやり直しをする関数が無い",
    !/updateAssignment|reassign|deleteAssignment/.test(svcCode));

  const migs = readdirSync(join(REPO_ROOT, "infra", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(join(REPO_ROOT, "infra", "migrations", f)))
    .join("\n");
  check("DB が付け替えを断る（トリガ）", /BEFORE UPDATE OR DELETE ON experiment_assignments/.test(migs));
  check("UPDATE を断る", /TG_OP = 'UPDATE'[\s\S]{0,200}RAISE EXCEPTION/.test(migs));
  check("行だけの DELETE を断る", /TG_OP = 'DELETE'[\s\S]{0,400}RAISE EXCEPTION/.test(migs));
  check("対象群ごとの廃棄は通す（消せないデータを残さない）",
    /EXISTS \(SELECT 1 FROM cohorts WHERE id = OLD\.cohort_id\)/.test(migs));
  check("種の指紋を残す（種そのものではない）",
    /seed_digest/.test(migs) && /種そのものは持たない/.test(migs));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck:assign — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
