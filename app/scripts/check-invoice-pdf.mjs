#!/usr/bin/env node
/**
 * 請求書PDFの日本語が読める状態かを検査する
 *
 * この検査を作った理由:
 *   請求書は jsPDF の helvetica 固定で作られており、
 *   **日本語がすべて文字化けした状態で顧客に出ていた**。
 *   しかも描画処理が route.ts の中にあり、認証とDBを通さないと
 *   1枚も出力できなかったため、長く気付かれなかった。
 *
 *   描画を純粋な関数（lib/billing/invoicePdf.ts）に切り出したので、
 *   ここで実データ相当を渡してPDFを作り、
 *   「日本語がテキストとして取り出せるか」を機械的に確かめる。
 *
 * 使い方:
 *   node scripts/check-invoice-pdf.mjs           # 検査する
 *   node scripts/check-invoice-pdf.mjs --keep    # 生成したPDFを残す（目視確認用）
 *
 * pdftotext（poppler-utils）があれば埋め込み文字の抽出まで検査する。
 * 無い場合はPDFの生成とフォント埋め込みの確認までを行う。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const KEEP = process.argv.includes("--keep");

// ── invoicePdf.ts を読み込む ─────────────────────────────
// 出力先をアプリ配下に置く。jspdf を外部依存のままにするので、
// node_modules を解決できる場所でないと import できない。
const work = mkdtempSync(join(tmpdir(), "invpdf-"));
const bundleDir = join(APP_ROOT, "node_modules", ".cache", "coe-checks");
mkdirSync(bundleDir, { recursive: true });
const outFile = join(bundleDir, "invoicePdf.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "billing", "invoicePdf.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=node",
      "--external:jspdf",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
} catch (e) {
  console.error("esbuild での変換に失敗しました。");
  console.error(String(e.stderr ?? e));
  rmSync(work, { recursive: true, force: true });
  rmSync(outFile, { force: true });
  process.exit(2);
}

const { renderInvoicePdf } = await import(pathToFileURL(outFile).href);

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

// 実データに近い検体。
// 自治体名には人名・地名で使われる NEC/IBM 拡張漢字（髙・﨑）を入れてある。
const sample = {
  invoice_number: "INV-2026-0042",
  amount: 100000,
  tax_amount: 10000,
  total_amount: 110000,
  period_start: "2026-04-01",
  period_end: "2027-03-31",
  due_date: "2026-05-31",
  status: "issued",
  notes: "第9期介護保険事業計画の策定支援を含みます。ご不明な点はお問い合わせください。",
  created_at: "2026-04-15T09:00:00+09:00",
  municipality_name: "熊本県上益城郡御船町",
  plan: "standard",
};

const t0 = Date.now();
const { buffer, unsupported } = renderInvoicePdf(sample);
const ms = Date.now() - t0;

check("PDFが生成される", buffer.length > 0);
check("PDFの体裁になっている", buffer.subarray(0, 5).toString() === "%PDF-");
check(
  "収録範囲外の文字が無い",
  unsupported.length === 0,
  unsupported.length > 0 ? `範囲外: ${unsupported.join("")}` : "",
);
console.log(`    （生成 ${ms}ms / ${(buffer.length / 1024) | 0}KB）`);

// フォントが実際に埋め込まれ、かつ**実際に使われている**か。
//
// jsPDF は標準14フォント（Helvetica など）を常にフォント辞書へ書き出す。
// 辞書に Helvetica があること自体は問題ではない。問題なのは
// 本文の描画命令（Tf）がそれを指している場合で、そのとき日本語が化ける。
// 辞書の有無ではなく「使われているフォント」を見る。
const raw = buffer.toString("latin1");
check("日本語フォントが埋め込まれている", /\/BaseFont\s*\/NotoSansJP/.test(raw));

function fontsActuallyUsed(pdf) {
  // オブジェクト番号 → BaseFont 名
  const baseFontOf = new Map();
  for (const m of pdf.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) {
    const bf = /\/BaseFont\s*\/([A-Za-z0-9+,\-]+)/.exec(m[2]);
    if (bf) baseFontOf.set(m[1], bf[1]);
  }
  // リソース辞書 /Font << /F15 42 0 R ... >>
  const alias = new Map();
  for (const m of pdf.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) alias.set(m[1], m[2]);
  // 実際に選択されたフォント
  const used = new Set();
  for (const m of pdf.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf/g)) {
    const obj = alias.get(m[1]);
    used.add(obj ? (baseFontOf.get(obj) ?? `?${m[1]}`) : `?${m[1]}`);
  }
  return Array.from(used);
}

const used = fontsActuallyUsed(raw);
check(
  "描画に使っているのが日本語フォントだけ",
  used.length > 0 && used.every((f) => f.includes("NotoSansJP")),
  `使用フォント: ${used.join(", ")}（Helvetica 等が混ざると日本語が化けます）`,
);
console.log(`    （使用フォント: ${used.join(", ")}）`);

// 難しい漢字の検体
const hard = renderInvoicePdf({
  ...sample,
  municipality_name: "髙﨑市",
  notes: "〒861-3206 ㈱ 単価は㎡あたり。※ 税率10%",
});
check("人名・地名の拡張漢字が範囲内", hard.unsupported.length === 0,
  hard.unsupported.length > 0 ? `範囲外: ${hard.unsupported.join("")}` : "");

// 範囲外の文字はきちんと検出される（検査自体が働いているか）
const withEmoji = renderInvoicePdf({ ...sample, notes: "ありがとうございます😀" });
check("収録範囲外の文字を検出できる", withEmoji.unsupported.includes("😀"));

// 支払済みの透かし
const paid = renderInvoicePdf({ ...sample, status: "paid" });
check("支払済みでも生成できる", paid.buffer.subarray(0, 5).toString() === "%PDF-");

// ── pdftotext があれば中身を確認 ─────────────────────────
const pdfPath = KEEP ? join(APP_ROOT, "invoice-sample.pdf") : join(work, "sample.pdf");
writeFileSync(pdfPath, buffer);

let hasPdftotext = false;
try {
  execFileSync("pdftotext", ["-v"], { stdio: ["ignore", "ignore", "ignore"] });
  hasPdftotext = true;
} catch {
  hasPdftotext = false;
}

if (hasPdftotext) {
  const text = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  const expect = [
    "請求書番号",
    "請求先",
    "請求元",
    "株式会社Ordo",
    "熊本県上益城郡御船町",
    "御中",
    "お支払期限",
    "サービス提供期間",
    "品目",
    "消費税",
    "合計（税込）",
    "お振込先",
    "備考",
    "法人番号",
  ];
  const missing = expect.filter((w) => !text.includes(w));
  check(
    "日本語がテキストとして取り出せる（＝化けていない）",
    missing.length === 0,
    missing.length > 0 ? `取り出せなかった語: ${missing.join(" / ")}` : "",
  );
  check("金額が入っている", text.includes("110,000"));
  check("備考が入っている", text.includes("第9期介護保険事業計画"));

  const hardPath = join(work, "hard.pdf");
  writeFileSync(hardPath, hard.buffer);
  const hardText = execFileSync("pdftotext", [hardPath, "-"], { encoding: "utf8" });
  check("拡張漢字（髙﨑）が正しく出る", hardText.includes("髙﨑市"),
    `抽出結果: ${hardText.split("\n").filter((l) => l.trim()).slice(0, 6).join(" | ")}`);
} else {
  console.log("- pdftotext が無いため本文の抽出検査はスキップしました");
  console.log("  （poppler-utils を入れると日本語が化けていないかまで検査できます）");
}

if (KEEP) {
  console.log(`\n生成したPDFを残しました: ${pdfPath}`);
} else if (existsSync(pdfPath)) {
  // work ごと消える
}
rmSync(work, { recursive: true, force: true });
rmSync(outFile, { force: true });

console.log(`\n結果: 成功 ${passed} 件 / 失敗 ${failed} 件`);
if (failed > 0) {
  console.error("\n請求書PDFが期待どおりに出力できていません。");
  process.exit(1);
}
