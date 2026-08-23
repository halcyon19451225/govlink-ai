#!/usr/bin/env node
/**
 * 承認語彙の整合チェック
 *
 * DB の CHECK 制約が許す値と、アプリ（zod enum）が送る値がずれていないかを検査する。
 *
 * この検査を作った理由:
 *   同じ事故が4件続いた。
 *     1. issue_hypotheses.status … DB は draft/verified/adopted/rejected、
 *        アプリは 'confirmed' を送っていた（「採用」ボタンが CHECK 違反）→ 028 で修正
 *     2. program_evaluations.status … DB は pending/in_progress/completed、
 *        アプリは draft/in_review/approved → 029 で修正
 *     3. program_evaluations の PATCH zod に 'efficiency' が無く効率性評価が編集不能 → P3 で修正
 *     4. logic_models.status … DB は draft/reviewed/approved、
 *        アプリは 'confirmed' を送っていた（「承認済みにする」が CHECK 違反）→ 034 で修正
 *   いずれも画面上は無音で失敗し、発見が遅れた。5件目を出さないための機械検査。
 *
 * 使い方:
 *   node scripts/check-status-vocab.mjs          # 検査する（差異があれば終了コード1）
 *   node scripts/check-status-vocab.mjs --list   # 検出した CHECK 制約を一覧表示
 *
 * 仕組み:
 *   - infra/migrations/*.sql を番号順に読み、`CHECK (<col> IN (...))` を拾う。
 *     後から出てきた定義が前を上書きする（ALTER で張り替える運用に合わせる）。
 *   - REGISTRY に書いた対応表にもとづき、アプリ側ファイルの zod enum を拾って突き合わせる。
 *   - 「アプリが送るのに DB が許さない値」があればエラー。
 *     「DB が許すのにアプリが送らない値」は後方互換の残置とみなし警告にとどめる。
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
// 通常はリポジトリ直下（govlink-ai/infra/migrations）。
// app/ 配下にコピーして検証する場合も拾えるようにしておく。
const MIGRATION_CANDIDATES = [
  join(REPO_ROOT, "infra", "migrations"),
  join(APP_ROOT, "infra", "migrations"),
];
const MIGRATIONS = MIGRATION_CANDIDATES.find((p) => existsSync(p)) ?? MIGRATION_CANDIDATES[0];

/**
 * 検査対象の対応表。
 * table/column … DB 側（migrations から CHECK を拾う）
 * sources      … アプリ側。file 内の zod enum を variable で特定する
 */
const REGISTRY = [
  {
    table: "logic_models",
    column: "status",
    label: "ロジックモデルの承認",
    sources: [
      { file: "src/app/api/admin/projects/[id]/logic-model/route.ts", context: "status" },
    ],
  },
  {
    table: "program_evaluations",
    column: "status",
    label: "プログラム評価の承認",
    sources: [
      { file: "src/app/api/admin/projects/[id]/evaluations/route.ts", context: "status" },
      { file: "src/app/api/admin/projects/[id]/evaluations/[evalId]/route.ts", context: "status" },
    ],
  },
  {
    table: "program_evaluations",
    column: "evaluation_tier",
    label: "評価階層",
    sources: [
      { file: "src/app/api/admin/projects/[id]/evaluations/route.ts", context: "evaluation_tier" },
      { file: "src/app/api/admin/projects/[id]/evaluations/[evalId]/route.ts", context: "evaluation_tier" },
    ],
  },
  {
    table: "issue_hypotheses",
    column: "status",
    label: "課題仮説の状態",
    sources: [
      { file: "src/app/api/admin/projects/[id]/issue-hypothesis/route.ts", context: "status" },
      { file: "src/app/api/admin/projects/[id]/issue-hypothesis/[hypId]/route.ts", context: "status" },
    ],
  },
  {
    table: "improvement_actions",
    column: "status",
    label: "改善アクションの状態",
    sources: [
      { file: "src/app/api/admin/projects/[id]/improvement-actions/route.ts", context: "status" },
      { file: "src/app/api/admin/projects/[id]/improvement-actions/[actionId]/route.ts", context: "status" },
    ],
  },
  {
    table: "improvement_actions",
    column: "source",
    label: "改善アクションの出所",
    sources: [
      { file: "src/app/api/admin/projects/[id]/improvement-actions/route.ts", context: "source" },
    ],
  },
  {
    table: "kpis",
    column: "indicator_type",
    label: "KPIの指標タイプ",
    sources: [
      { file: "src/app/api/admin/projects/[id]/kpis/route.ts", context: "indicator_type" },
      { file: "src/app/api/admin/projects/[id]/kpis/[kpiId]/route.ts", context: "indicator_type" },
    ],
  },
  {
    table: "kpis",
    column: "achievement_condition",
    label: "KPIの達成水準",
    sources: [
      { file: "src/app/api/admin/projects/[id]/kpis/route.ts", context: "achievement_condition" },
      { file: "src/app/api/admin/projects/[id]/kpis/[kpiId]/route.ts", context: "achievement_condition" },
    ],
  },
  {
    table: "plan_handovers",
    column: "status",
    label: "引き継ぎの状態",
    sources: [
      { file: "src/app/api/admin/projects/[id]/handover/[handoverId]/route.ts", context: "status" },
    ],
  },
  {
    table: "asis_analyses",
    column: "status",
    label: "現状整理の状態",
    sources: [],
  },
  {
    table: "issue_dialogues",
    column: "current_step",
    label: "課題仮説対話のフェーズ",
    sources: [],
  },
  {
    table: "improvement_dialogues",
    column: "current_step",
    label: "改善提案対話のフェーズ",
    sources: [],
  },
  {
    table: "measure_designs",
    column: "status",
    label: "施策データセットの状態",
    sources: [
      { file: "src/app/api/admin/projects/[id]/measure-design/[measureId]/route.ts", context: "status" },
    ],
  },
  {
    table: "measure_designs",
    column: "evidence_status",
    label: "施策のエビデンス状態",
    sources: [
      { file: "src/app/api/admin/projects/[id]/measure-design/[measureId]/route.ts", context: "evidence_status" },
    ],
  },
  {
    table: "measure_dialogues",
    column: "current_step",
    label: "施策構築対話のフェーズ",
    sources: [],
  },
];

// ─── migrations から CHECK を拾う ───────────────────
function collectChecks() {
  if (!existsSync(MIGRATIONS)) {
    console.error(`マイグレーションが見つかりません。探した場所:\n  ${MIGRATION_CANDIDATES.join("\n  ")}`);
    process.exit(2);
  }
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001_, 002_ … の連番順

  /** key: "table.column" → { values: string[], file: string } */
  const checks = new Map();

  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");

    // 直近に触れているテーブルを追う（CREATE TABLE / ALTER TABLE）
    const stmts = sql.split(/;\s*\n/);
    for (const stmt of stmts) {
      const tableMatch =
        stmt.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/i) ||
        stmt.match(/ALTER\s+TABLE\s+(\w+)/i);
      if (!tableMatch) continue;
      const table = tableMatch[1];

      // CHECK (col IN ('a','b',...)) / CHECK ((col = ANY (ARRAY[...])))
      const re = /CHECK\s*\(\s*\(?\s*(\w+)\s+IN\s*\(([^)]*)\)/gi;
      let m;
      while ((m = re.exec(stmt)) !== null) {
        const column = m[1];
        const values = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
        if (values.length === 0) continue;
        // 後の定義が前を上書きする（ALTER による張り替え運用）
        checks.set(`${table}.${column}`, { values, file: f });
      }
    }
  }
  return checks;
}

// ─── アプリ側の zod enum を拾う ─────────────────────
/**
 * `context`（カラム名）に続く最初の z.enum([...]) を取り出す。
 * 例: status: z.enum(["draft", "in_review", "approved"]).optional()
 */
function collectEnum(filePath, context) {
  const abs = join(APP_ROOT, filePath);
  if (!existsSync(abs)) return null;
  const src = readFileSync(abs, "utf8");

  const results = [];
  // (a) context: ... z.enum([ ... ])  （間にコメントや改行が入ることを許す）
  const re = new RegExp(
    `\\b${context}\\s*:[\\s\\S]{0,400}?z\\s*\\.\\s*enum\\s*\\(\\s*\\[([\\s\\S]*?)\\]`,
    "g",
  );
  let m;
  while ((m = re.exec(src)) !== null) {
    const values = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    if (values.length > 0) results.push(values);
  }

  // (b) 変数経由の指定を解決する
  //     const achievementConditionEnum = z.enum([...]);
  //     achievement_condition: achievementConditionEnum.nullable()
  const indirect = new RegExp(`\\b${context}\\s*:\\s*([A-Za-z_$][\\w$]*)\\b`, "g");
  let im;
  while ((im = indirect.exec(src)) !== null) {
    const varName = im[1];
    if (varName === "z") continue;
    const defRe = new RegExp(
      `\\b(?:const|let|var)\\s+${varName}\\s*=\\s*z\\s*\\.\\s*enum\\s*\\(\\s*\\[([\\s\\S]*?)\\]`,
    );
    const dm = src.match(defRe);
    if (!dm) continue;
    const values = [...dm[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    if (values.length > 0) results.push(values);
  }

  if (results.length === 0) return null;
  // 同ファイル内に複数（POST/PATCH）あれば和集合を取る
  return [...new Set(results.flat())];
}

// ─── 実行 ────────────────────────────────────────
const listOnly = process.argv.includes("--list");
const checks = collectChecks();

if (listOnly) {
  console.log("検出した CHECK 制約:\n");
  for (const [key, v] of [...checks.entries()].sort()) {
    console.log(`  ${key.padEnd(44)} ${v.values.join(" | ")}   (${v.file})`);
  }
  process.exit(0);
}

let errors = 0;
let warnings = 0;
const lines = [];

for (const entry of REGISTRY) {
  const key = `${entry.table}.${entry.column}`;
  const dbCheck = checks.get(key);

  if (!dbCheck) {
    lines.push(`? ${key}  … CHECK 制約が見つかりません（${entry.label}）`);
    warnings++;
    continue;
  }
  if (entry.sources.length === 0) {
    lines.push(`- ${key}  DB: ${dbCheck.values.join(", ")}  （アプリ側の対応付け未登録）`);
    continue;
  }

  for (const s of entry.sources) {
    const appValues = collectEnum(s.file, s.context);
    if (!appValues) {
      lines.push(`? ${key}  … ${s.file} に ${s.context} の z.enum が見つかりません`);
      warnings++;
      continue;
    }
    const missingInDb = appValues.filter((v) => !dbCheck.values.includes(v));
    const unusedInApp = dbCheck.values.filter((v) => !appValues.includes(v));

    if (missingInDb.length > 0) {
      lines.push(
        `✗ ${key}  【${entry.label}】\n` +
          `    アプリが送るのに DB が許さない値: ${missingInDb.join(", ")}\n` +
          `    DB  (${dbCheck.file}): ${dbCheck.values.join(", ")}\n` +
          `    App (${s.file}): ${appValues.join(", ")}`,
      );
      errors++;
    } else if (unusedInApp.length > 0) {
      lines.push(
        `△ ${key}  DB のみに存在（後方互換の残置とみなす）: ${unusedInApp.join(", ")}  [${s.file}]`,
      );
      warnings++;
    } else {
      lines.push(`✓ ${key}  一致 (${appValues.length}値)  [${s.file}]`);
    }
  }
}

console.log("承認語彙の整合チェック\n");
console.log(lines.join("\n"));
console.log(
  `\n結果: エラー ${errors} 件 / 警告 ${warnings} 件 / 検査対象 ${REGISTRY.length} 組`,
);

if (errors > 0) {
  console.error(
    "\nDB の CHECK が許さない値をアプリが送っています。" +
      "この状態では該当操作が実行時に必ず失敗し、画面上は無音のことが多いです。" +
      "\nマイグレーションで CHECK を張り替えるか、アプリ側の値を合わせてください。",
  );
  process.exit(1);
}
