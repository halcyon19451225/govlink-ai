#!/usr/bin/env node
/**
 * メニュー別マニュアル（M1 第2.5部）の検証 — check:manual
 *
 * この検査を作った理由:
 *   マニュアルは「現状共有の正本」— **実装と乖離したら意味を失う**。
 *   frontmatter の apis / checks / tables が実在するかを機械照合し、
 *   乖離をコミット前に検出する（設計 第2.5部 §4）。
 *
 * 必須集合（REQUIRED_MANUALS）に無いトピックの未整備は TODO として表示するだけ
 * （M2/M3 で必須集合を広げると書き漏れが失敗になる — 段階整備の設計どおり）。
 */

import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const MANUAL_DIR = join(APP_ROOT, "src", "content", "manual");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const work = mkdtempSync(join(tmpdir(), "manual-"));
try {
  // 純関数のバンドル（topics / frontmatter）
  const bundle = async (rel, out) => {
    const file = join(work, out);
    execFileSync(
      "npx",
      ["--no-install", "esbuild", join(APP_ROOT, "src", rel),
       "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
       `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${file}`],
      { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
    );
    return import(pathToFileURL(file).href);
  };
  const topics = await bundle("lib/manual/topics.ts", "topics.mjs");
  const fm = await bundle("lib/manual/frontmatter.ts", "frontmatter.mjs");

  // ── トピック索引の整合 ──────────────────────────
  const ids = topics.HELP_TOPICS.map((t) => t.id);
  check("トピック: IDに重複がない", new Set(ids).size === ids.length);
  check("トピック: IDは英数ハイフンのみ（パス安全）", ids.every((x) => /^[a-z0-9-]+$/.test(x)));
  check("トピック: 必須集合はトピックに実在する",
    topics.REQUIRED_MANUALS.every((x) => ids.includes(x)));
  check("トピック: 不正IDの検証（トラバーサル防止）",
    !topics.isValidTopicId("../secret") && !topics.isValidTopicId("zzz") &&
    topics.isValidTopicId("schedule") && topics.isValidTopicId("_conventions"));

  // ── frontmatter パーサ ──────────────────────────
  const parsed = fm.parseManual(`---\nmodule: schedule\ntitle: テスト\ntables: [a, b]\nupdated: 2026-08-26\n---\n# 本文`);
  check("frontmatter: key/リスト/本文の分離",
    parsed.meta?.module === "schedule" && parsed.meta?.title === "テスト" &&
    JSON.stringify(parsed.meta?.tables) === '["a","b"]' && parsed.body.trim() === "# 本文");
  check("frontmatter: 無いときは meta=null で本文全体", fm.parseManual("# そのまま").meta === null);

  // ── 必須マニュアルの存在と内容の整合 ───────────────
  for (const id of topics.REQUIRED_MANUALS) {
    const path = join(MANUAL_DIR, `${id}.md`);
    if (!existsSync(path)) {
      check(`必須マニュアル ${id}.md が存在する`, false);
      continue;
    }
    check(`必須マニュアル ${id}.md が存在する`, true);
    const { meta, body } = fm.parseManual(readFileSync(path, "utf8"));
    check(`${id}: frontmatterのmoduleがファイル名と一致`, meta?.module === id);
    check(`${id}: updated がある`, Boolean(meta?.updated));
    check(`${id}: 位置づけ図（mermaid）を含む`, body.includes("```mermaid"));
    // apis の実在（ルートファイル照合）
    const apiOk = (meta?.apis ?? []).every((api) => {
      const p = join(APP_ROOT, "src", "app", ...api.replace(/^\//, "").split("/"), "route.ts");
      return existsSync(p);
    });
    check(`${id}: frontmatterのapisが実在する`, apiOk);
    // checks の実在（package.json照合）
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
    check(`${id}: frontmatterのchecksが実在する`,
      (meta?.checks ?? []).every((c) => Boolean(pkg.scripts?.[c])));
    // tables の実在（マイグレーションSQLの文字列照合 — DB不要の近似）
    const migDir = existsSync(join(APP_ROOT, "_migrations")) ? join(APP_ROOT, "_migrations") : join(REPO_ROOT, "infra", "migrations");
    const allSql = readdirSync(migDir).filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(migDir, f), "utf8")).join("\n");
    check(`${id}: frontmatterのtablesがマイグレーションに実在する`,
      (meta?.tables ?? []).every((t) => allSql.includes(t)));
  }

  // ── 共通ページと基盤の配線 ──────────────────────
  check("図の読み方（_conventions.md）が存在し記法の規約を含む",
    existsSync(join(MANUAL_DIR, "_conventions.md")) &&
    readFileSync(join(MANUAL_DIR, "_conventions.md"), "utf8").includes("人の確認・承認ゲート"));
  const helpBtn = readFileSync(join(APP_ROOT, "src", "components", "help", "HelpButton.tsx"), "utf8");
  check("HelpButton: ドロワー・全画面リンク・準備中表示", helpBtn.includes("全画面で開く") && helpBtn.includes("準備中"));
  const view = readFileSync(join(APP_ROOT, "src", "components", "help", "ManualView.tsx"), "utf8");
  check("ManualView: mermaidは動的import（バンドル本体を重くしない）",
    view.includes('import("mermaid")'));
  check("/manual 目次と [topicId] ページが存在する",
    existsSync(join(APP_ROOT, "src", "app", "manual", "page.tsx")) &&
    existsSync(join(APP_ROOT, "src", "app", "manual", "[topicId]", "page.tsx")));
  const nextCfg = readFileSync(join(APP_ROOT, "next.config.mjs"), "utf8");
  check("next.config: standaloneのトレースに content/manual を含める",
    nextCfg.includes("outputFileTracingIncludes") && nextCfg.includes("src/content/manual"));
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
  check("package.json: mermaid/marked同梱・check:manual連鎖",
    Boolean(pkg.dependencies?.mermaid) && Boolean(pkg.dependencies?.marked) &&
    String(pkg.scripts?.check ?? "").includes("check:manual"));

  // ── 未整備トピックの棚卸し（失敗ではなくTODO表示）────
  const missing = ids.filter((x) => !existsSync(join(MANUAL_DIR, `${x}.md`)));
  if (missing.length > 0) {
    console.log(`  ℹ 未整備マニュアル（M2/M3で整備・REQUIRED_MANUALSに追加すると必須化）: ${missing.length}件`);
    console.log(`    ${missing.join(", ")}`);
  }

  console.log(`check-manual: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
