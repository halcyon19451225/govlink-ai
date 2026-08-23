/**
 * jsPDF に日本語フォントを埋め込む
 *
 * ── なぜ必要か ─────────────────────────────────────────────
 * jsPDF の標準フォント（helvetica / times / courier）は
 * **日本語のグリフを持たない**。日本語を書くと PDF 上は文字化けする。
 *
 * 自己評価シートはブラウザ印刷（window.print）に逃がして解決したが、
 * 請求書は「ダウンロードされる帳票」なのでその手は使えない。
 * 顧客がメールに添付し、保存し、経理が確認するファイルである以上、
 * サーバー側で正しい日本語のPDFを作る必要がある。
 *
 * ── 方式 ───────────────────────────────────────────────────
 * Noto Sans JP（SIL OFL 1.1）を cp932 相当までサブセットし、
 * brotli 圧縮 + base64 でソースに同梱する。
 * ファイルシステムを使わないので、デプロイ先（Amplify/Lambda）で
 * 「フォントファイルが同梱されずに本番だけ化ける」事故が起きない。
 *
 * 展開はプロセスごとに1回だけで、以後はモジュール内にキャッシュする。
 *
 * 詳細は fonts/README.md を参照。
 */

import { brotliDecompressSync } from "node:zlib";
import type { jsPDF } from "jspdf";
import { NOTO_SANS_JP_REGULAR_BROTLI_BASE64 } from "./fonts/notoSansJPRegular";
import { NOTO_SANS_JP_BOLD_BROTLI_BASE64 } from "./fonts/notoSansJPBold";
import { NOTO_SANS_JP_COVERAGE } from "./fonts/coverage";

/** 本文用（日本語を含むすべてのテキスト） */
export const JA_FONT = "NotoSansJP";
/** 見出し・金額用。**ASCII しか収録していない** */
export const JA_FONT_BOLD = "NotoSansJP-Bold";

const VFS_REGULAR = "NotoSansJP-Regular.ttf";
const VFS_BOLD = "NotoSansJP-Bold.ttf";

/** 展開結果のキャッシュ（プロセスごとに1回だけ brotli 展開する） */
let cached: { regular: string; bold: string } | null = null;

function loadFonts(): { regular: string; bold: string } {
  if (cached) return cached;
  const inflate = (b64: string): string =>
    brotliDecompressSync(Buffer.from(b64, "base64")).toString("base64");
  cached = {
    regular: inflate(NOTO_SANS_JP_REGULAR_BROTLI_BASE64),
    bold: inflate(NOTO_SANS_JP_BOLD_BROTLI_BASE64),
  };
  return cached;
}

/**
 * ドキュメントに日本語フォントを登録し、本文フォントとして選択する。
 * jsPDF は最終的に「実際に使った文字」だけを埋め込むので、
 * 出力PDFのサイズは 100〜200KB 程度に収まる。
 */
export function registerJapaneseFonts(doc: jsPDF): void {
  const { regular, bold } = loadFonts();

  doc.addFileToVFS(VFS_REGULAR, regular);
  doc.addFont(VFS_REGULAR, JA_FONT, "normal");
  // 日本語をボールド指定しても化けないよう、bold スタイルにも本文フォントを割り当てる。
  // （helvetica にフォールバックさせないことが目的）
  doc.addFont(VFS_REGULAR, JA_FONT, "bold");

  doc.addFileToVFS(VFS_BOLD, bold);
  doc.addFont(VFS_BOLD, JA_FONT_BOLD, "bold");

  doc.setFont(JA_FONT, "normal");
}

/** 本文（日本語可） */
export function applyJaFont(doc: jsPDF): void {
  doc.setFont(JA_FONT, "normal");
}

/**
 * 見出し・金額用の太字。**ASCII と数字・記号のみ**。
 * 日本語を渡すと化けるため、渡された文字列を検査し、
 * 日本語が含まれていれば自動的に本文フォントへ切り替える。
 * 「太字にしたつもりが本番で化けていた」という事故を型ではなく実行時に潰す。
 */
export function applyJaBoldFont(doc: jsPDF, text?: string): void {
  if (text !== undefined && containsNonAscii(text)) {
    doc.setFont(JA_FONT, "normal");
    return;
  }
  doc.setFont(JA_FONT_BOLD, "bold");
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

export function containsNonAscii(text: string): boolean {
  return !ASCII_ONLY.test(text);
}

/**
 * 埋め込んだサブセットに無い文字を洗い出す。
 *
 * 収録範囲はフォントの cmap から生成した一覧（fonts/coverage.ts）で判定する。
 * 範囲の当て推量ではなく事実なので、
 * 「豆腐が出ているのに検査は素通りする」ということが起きない。
 *
 * 実際、当初は 0x3000-0x30FF を一律「収録済み」と見なしていたため、
 * 波ダッシュ 〜(U+301C) が入っていないのに検出できず、
 * サービス提供期間の「〜」が消えていた。
 * （cp932 から作った文字集合には U+FF5E しか入らないが、
 *   macOS の IME が出すのは U+301C という有名な食い違い）
 */
export function findUnsupportedChars(text: string): string[] {
  const cov = coverage();
  const out = new Set<string>();
  for (const ch of text) {
    if (ch === "\n" || ch === "\r" || ch === "\t") continue;
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (!cov.has(cp)) out.add(ch);
  }
  return Array.from(out);
}

/** 収録符号位置の集合（初回だけ展開してキャッシュする） */
let coverageSet: Set<number> | null = null;

function coverage(): Set<number> {
  if (coverageSet) return coverageSet;
  const set = new Set<number>();
  for (const part of NOTO_SANS_JP_COVERAGE.split(",")) {
    const dash = part.indexOf("-");
    if (dash < 0) {
      set.add(parseInt(part, 16));
    } else {
      const a = parseInt(part.slice(0, dash), 16);
      const b = parseInt(part.slice(dash + 1), 16);
      for (let c = a; c <= b; c++) set.add(c);
    }
  }
  coverageSet = set;
  return set;
}

/** その文字列がそのまま出力できるか */
export function isRenderable(text: string): boolean {
  return findUnsupportedChars(text).length === 0;
}
