#!/usr/bin/env node
/**
 * 対話のコピー機能と next.config の検査
 *
 * この検査を作った理由:
 *   ①担当者はAIの問いを庁内資料や別のAIへ持ち出す。対話の各発言と全体を
 *     コピーできることは日常の作業手順に組み込まれるため、
 *     UI改修で黙って消えないよう固定する。
 *   ②next.config の `serverExternalPackages` は Next 15 の書き方で、
 *     Next 14 では認識されず**警告だけ出して無視される**（2026-08-29 に発覚）。
 *     pdf-parse などの外部化が効かないと本番の本文抽出が壊れうるのに、
 *     ビルドは成功してしまうため気づけない。キー名をここで固定する。
 *
 * 使い方:
 *   node scripts/check-copy-transcript.mjs
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

// ── 1. next.config のキー名 ─────────────────────
const cfg = read(join(APP_ROOT, "next.config.mjs"));
check("next.config: Next14 のキー名を使っている", cfg.includes("serverComponentsExternalPackages"));
check(
  "next.config: Next15 の書き方（素の serverExternalPackages）が復活していない",
  !/^\s*serverExternalPackages:/m.test(cfg),
);
check(
  "next.config: serverComponentsExternalPackages が experimental の中にある",
  /experimental:\s*\{[\s\S]*serverComponentsExternalPackages[\s\S]*?\n  \}/.test(cfg),
);
for (const pkg of ["pdf-parse", "mammoth", "pdfjs-dist"]) {
  check(`next.config: ${pkg} を外部化している`, cfg.includes(`'${pkg}'`));
}

// ── 2. コピーUIが両画面に付いている ──────────────────
check("CopyButton コンポーネントがある", existsSync(join(APP_ROOT, "src", "components", "CopyButton.tsx")));
const btn = read(join(APP_ROOT, "src", "components", "CopyButton.tsx"));
check("CopyButton: navigator.clipboard を使う", btn.includes("navigator.clipboard"));
check(
  "CopyButton: 非セキュアコンテキスト向けのフォールバックがある",
  btn.includes("execCommand") && btn.includes("isSecureContext"),
);
check("CopyButton: 結果を利用者に伝える", btn.includes("コピーしました") && btn.includes('role="status"'));

const clients = {
  "現状整理": join(
    APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "asis-analysis", "AsisAnalysisClient.tsx",
  ),
  "課題仮説設定": join(
    APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "issue-hypothesis", "IssueHypothesisClient.tsx",
  ),
};
for (const [label, file] of Object.entries(clients)) {
  const src = read(file);
  check(`${label}: CopyButton を読み込んでいる`, src.includes('from "@/components/CopyButton"'));
  check(`${label}: 発言ごとのコピーがある（2箇所以上）`, (src.match(/formatMessage\(/g) ?? []).length >= 2);
  check(
    `${label}: 対話全体のコピーがある（対話中と履歴の2箇所）`,
    (src.match(/formatTranscript\(/g) ?? []).length >= 2,
  );
  check(`${label}: コピーボタンに説明がある`, src.includes('title="この発言をコピー"'));
}

// ── 3. 書き出しロジックの実挙動 ───────────────────
const work = mkdtempSync(join(tmpdir(), "transcript-"));
const outFile = join(work, "transcript.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "ai", "transcript.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);

  const msgs = [
    { role: "assistant", content: "最も大きい要因はどれでしょうか。", step: "problems" },
    { role: "user", content: "指標体系の断絶です。", step: "problems" },
    { role: "assistant", content: "  ", step: "selection" },
  ];
  const stepLabel = (k) => ({ problems: "問題の洗い出し", selection: "課題の選別" })[k] ?? k;

  check(
    "1件: 見出しに役割と工程が入る",
    m.formatMessage(msgs[0], stepLabel).startsWith("【AI・問題の洗い出し】\n"),
  );
  check("1件: 本文が続く", m.formatMessage(msgs[1], stepLabel).includes("指標体系の断絶です。"));
  check(
    "1件: 工程が無ければ役割だけ",
    m.formatMessageHeading({ role: "user", content: "x" }) === "【担当者】",
  );
  check(
    "1件: 工程ラベル未指定ならキーをそのまま出す",
    m.formatMessageHeading(msgs[0]) === "【AI・problems】",
  );

  const t = m.formatTranscript(msgs, { title: "課題仮説設定", stepLabel });
  check("全体: 見出しが先頭に付く", t.startsWith("# 課題仮説設定\n\n"));
  check("全体: 発言が空行で区切られる", t.includes("。\n\n【担当者・問題の洗い出し】"));
  check("全体: 空の発言は落とす", !t.includes("課題の選別"));
  check("全体: 末尾は改行1つ", t.endsWith("\n") && !t.endsWith("\n\n"));
  check("全体: 見出し省略時は本文から始まる", m.formatTranscript(msgs, { stepLabel }).startsWith("【AI"));
  check("全体: 空配列でも落ちない", typeof m.formatTranscript([], {}) === "string");
  check("役割ラベルは担当者とAI", m.ROLE_LABEL.user === "担当者" && m.ROLE_LABEL.assistant === "AI");
} catch (e) {
  check(`transcript.ts のバンドル/実行: ${e instanceof Error ? e.message : e}`, false);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck-copy-transcript: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
