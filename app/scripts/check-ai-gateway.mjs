#!/usr/bin/env node
/**
 * AIゲートウェイの検査 — X1
 *
 * この検査を作った理由:
 *   独自AIへの段階移行は「全呼び出しがゲートウェイを通る」ことが前提。
 *   一箇所でも SDK 直呼びが復活すると、利用ログ・ルーティングの外で
 *   AIが動き、移行の計測が崩れる。語彙（taskTypes.ts）の整合と
 *   「直呼び禁止」をここで固定する。
 *
 * 使い方:
 *   node scripts/check-ai-gateway.mjs
 */

import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
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

// ── 1. taskTypes.ts の純粋ロジック ───────────────────────
const work = mkdtempSync(join(tmpdir(), "aigw-"));
const outFile = join(work, "taskTypes.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "ai", "taskTypes.ts"),
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
    AI_TASK_TYPES,
    isAiTaskType,
    normalizeRouting,
    resolveEffectiveMode,
    IMPLEMENTED_ROUTING_MODES,
  } = m;

  check("タスク種別が定義されている", AI_TASK_TYPES.length >= 18);
  check(
    "タスク種別キーが重複していない",
    new Set(AI_TASK_TYPES.map((t) => t.key)).size === AI_TASK_TYPES.length,
  );
  check(
    "全種別に日本語ラベルがある",
    AI_TASK_TYPES.every((t) => typeof t.label === "string" && t.label.length > 0),
  );
  check("isAiTaskType: 既知を通す", isAiTaskType("dialogue.measure"));
  check("isAiTaskType: 未知を弾く", !isAiTaskType("dialogue.unknown"));
  check("isAiTaskType: 非文字列を弾く", !isAiTaskType(42));

  const r1 = normalizeRouting({ task_type: "analysis.stats", mode: "shadow", ordo_weight: 150 });
  check("normalizeRouting: ウェートを0〜100にクランプ", r1?.ordo_weight === 100);
  const r2 = normalizeRouting({ task_type: "analysis.stats", mode: "banana", ordo_weight: -5 });
  check("normalizeRouting: 不正モードは claude に", r2?.mode === "claude");
  check("normalizeRouting: 負のウェートは 0 に", r2?.ordo_weight === 0);
  check("normalizeRouting: 未知種別は null", normalizeRouting({ task_type: "x" }) === null);
  check("normalizeRouting: null 入力は null", normalizeRouting(null) === null);

  check("resolveEffectiveMode: claude はそのまま", resolveEffectiveMode("claude") === "claude");
  check("resolveEffectiveMode: shadow は実装済み", resolveEffectiveMode("shadow") === "shadow");
  check("resolveEffectiveMode: assist は実装済み", resolveEffectiveMode("assist") === "assist");
  check(
    "resolveEffectiveMode: primary は実装済みの最寄り（assist）に落ちる",
    resolveEffectiveMode("primary") === "assist" ||
      IMPLEMENTED_ROUTING_MODES.includes("primary"),
  );

  // ── 2. DB種付け（マイグレーション）と語彙の一致 ──────────
  // 種付けは 038 以降どのマイグレーションでもよい（追加分は後続で種付け）
  const migDir = join(APP_ROOT, "_migrations");
  const mig = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(migDir, f), "utf-8"))
    .join("\n");
  for (const t of AI_TASK_TYPES) {
    check(`マイグレーションに種付けあり: ${t.key}`, mig.includes(`'${t.key}'`));
  }

  // ── 3. 直呼び禁止（全呼び出しがゲートウェイ経由）─────────
  const offendersNew = [];
  const offendersImport = [];
  const unknownTaskTypes = [];
  const knownKeys = new Set(AI_TASK_TYPES.map((t) => t.key));

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        const rel = p.slice(APP_ROOT.length + 1);
        const src = readFileSync(p, "utf-8");
        const isGateway = rel.replaceAll("\\", "/") === "src/lib/ai/gateway.ts";
        if (!isGateway && src.includes("new Anthropic(")) offendersNew.push(rel);
        // 値インポートの禁止（type-only は許可: 型注釈にのみ使う）
        if (!isGateway && /import\s+Anthropic\s+from\s+"@anthropic-ai\/sdk"/.test(src)) {
          offendersImport.push(rel);
        }
        // taskType リテラルが語彙に存在するか
        for (const mm of src.matchAll(/taskType:\s*"([^"]+)"/g)) {
          if (!knownKeys.has(mm[1])) unknownTaskTypes.push(`${rel}: ${mm[1]}`);
        }
      }
    }
  }
  walk(join(APP_ROOT, "src"));

  check(
    `new Anthropic( はゲートウェイ以外に無い${offendersNew.length ? `（違反: ${offendersNew.join(", ")}）` : ""}`,
    offendersNew.length === 0,
  );
  check(
    `SDKの値インポートはゲートウェイ以外に無い${offendersImport.length ? `（違反: ${offendersImport.join(", ")}）` : ""}`,
    offendersImport.length === 0,
  );
  check(
    `使用されている taskType はすべて語彙にある${unknownTaskTypes.length ? `（未知: ${unknownTaskTypes.join(", ")}）` : ""}`,
    unknownTaskTypes.length === 0,
  );

  // ── 4. 対話ヘルパーがゲートウェイを使う ──────────────────
  const dlg = readFileSync(join(APP_ROOT, "src", "lib", "ai", "dialogueTurn.ts"), "utf-8");
  check("dialogueTurn は aiCreateMessage を使う", dlg.includes("aiCreateMessage("));
  check("dialogueTurn に SDK 直呼びが無い", !dlg.includes("anthropic.messages.create"));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`check-ai-gateway: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
