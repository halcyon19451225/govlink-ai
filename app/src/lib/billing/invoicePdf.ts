/**
 * 請求書PDFの生成
 *
 * ── なぜルートから切り出したか ─────────────────────────────
 * 以前は route.ts の中に描画処理が丸ごと書かれており、
 * 認証とDBを通さないと1枚も出力できなかった。
 * その結果、**日本語がすべて文字化けしている状態が長く気付かれなかった**。
 * 純粋な関数にして、検査スクリプトから実データ相当を渡して
 * 出力を確認できるようにする（scripts/check-invoice-pdf.mjs）。
 *
 * ── 文字化けについて ───────────────────────────────────────
 * jsPDF の標準フォントは日本語グリフを持たない。
 * lib/pdf/japaneseFont.ts で Noto Sans JP を埋め込む。
 * 太字は ASCII しか収録していないため、日本語は applyJaBoldFont() が
 * 自動的に本文フォントへ落とす（サイズと色で強調する）。
 */

import { jsPDF } from "jspdf";
import {
  registerJapaneseFonts,
  applyJaFont,
  applyJaBoldFont,
  findUnsupportedChars,
} from "@/lib/pdf/japaneseFont";

export interface InvoiceData {
  invoice_number: string;
  amount: number;
  tax_amount: number;
  total_amount: number;
  period_start: string;
  period_end: string;
  due_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  municipality_name: string;
  plan: string | null;
}

/** 発行元。表記を変える場合はここだけを直す */
const ISSUER = {
  name: "株式会社Ordo",
  address1: "熊本県上益城郡御船町大字上野1652-1",
  corporateNumber: "3300-01-029524",
  site: "https://sinap-sys.jp",
  contact: "https://sinap-sys.jp/contact",
  // 適格請求書発行事業者の登録が完了したら、ここに登録番号（T+13桁）を入れ、
  // invoiceRegistrationPending を false にする。
  invoiceRegistrationNumber: null as string | null,
  invoiceRegistrationPending: true,
};

const yen = (v: number): string => `¥${Math.round(v).toLocaleString("ja-JP")}`;

/** 全角の日付表記にはせず、そのまま（DBは YYYY-MM-DD） */
const day = (v: string): string => (v ?? "").slice(0, 10);

export interface InvoicePdfResult {
  buffer: Buffer;
  /** 埋め込みフォントに無い文字（通常は空。監視用） */
  unsupported: string[];
}

export function renderInvoicePdf(inv: InvoiceData): InvoicePdfResult {
  const planLabel = inv.plan === "premium" ? "Premium" : inv.plan === "light" ? "Light" : "Standard";

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  registerJapaneseFonts(doc);

  const pageW = 210;
  const margin = 20;
  const innerW = pageW - margin * 2;
  let y = margin;

  // ── ヘッダー ─────────────────────────────────
  doc.setFillColor(15, 17, 23);
  doc.rect(0, 0, pageW, 35, "F");

  applyJaBoldFont(doc, "Sinap-sys");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("Sinap-sys", margin, 18);

  applyJaFont(doc);
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("自治体向け 政策マネジメント SaaS", margin, 25);
  doc.text(ISSUER.site, pageW - margin, 18, { align: "right" });
  doc.text(`お問い合わせ: ${ISSUER.contact}`, pageW - margin, 25, { align: "right" });

  y = 48;

  // ── タイトル ─────────────────────────────────
  applyJaBoldFont(doc, "INVOICE");
  doc.setFontSize(22);
  doc.setTextColor(15, 17, 23);
  doc.text("INVOICE", margin, y);

  applyJaFont(doc);
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("請求書", margin + 42, y - 1);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`請求書番号: ${inv.invoice_number}`, pageW - margin, y - 6, { align: "right" });
  doc.text(`発行日: ${day(inv.created_at)}`, pageW - margin, y, { align: "right" });

  y += 12;

  // ── 適格請求書の登録状況 ──────────────────────
  doc.setFontSize(8);
  if (ISSUER.invoiceRegistrationNumber) {
    doc.setTextColor(71, 85, 105);
    doc.text(
      `適格請求書発行事業者登録番号: ${ISSUER.invoiceRegistrationNumber}`,
      margin,
      y,
    );
  } else if (ISSUER.invoiceRegistrationPending) {
    doc.setTextColor(239, 68, 68);
    doc.text("※ 適格請求書発行事業者 登録申請中", margin, y);
  }

  y += 14;

  // ── 請求先 / 請求元 ───────────────────────────
  const colW = innerW / 2;

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("請求先", margin, y);
  doc.text("請求元", margin + colW, y);
  y += 4;

  // 自治体名は任意の日本語。太字にすると化けるので本文フォントのまま大きく出す
  applyJaFont(doc);
  doc.setFontSize(12);
  doc.setTextColor(15, 17, 23);
  doc.text(inv.municipality_name, margin, y + 2);
  doc.setFontSize(12);
  doc.text(ISSUER.name, margin + colW, y + 2);

  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("御中", margin, y + 8);
  doc.text(ISSUER.address1, margin + colW, y + 8);
  doc.text(`法人番号: ${ISSUER.corporateNumber}`, margin + colW, y + 13);

  y += 26;

  // ── 請求情報ボックス ──────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, innerW, 28, 3, 3, "F");

  const fw = innerW / 3;
  const boxFields: { label: string; val: string; large?: boolean }[] = [
    { label: "請求金額（税込）", val: yen(inv.total_amount), large: true },
    { label: "お支払期限", val: day(inv.due_date) },
    // 波ダッシュは U+FF5E（全角チルダ）を使う。
    // U+301C は macOS の IME が出す方で、cp932 由来の文字集合には入らない。
    // フォントには両方入れてあるが、コード側は片方に統一しておく。
    { label: "サービス提供期間", val: `${day(inv.period_start)}～${day(inv.period_end)}` },
  ];
  boxFields.forEach((f, i) => {
    const bx = margin + fw * i + 6;
    applyJaFont(doc);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(f.label, bx, y + 8);

    if (f.large) {
      applyJaBoldFont(doc, f.val);
      doc.setFontSize(16);
      doc.setTextColor(99, 102, 241);
    } else {
      applyJaBoldFont(doc, f.val);
      doc.setFontSize(f.val.length > 16 ? 9 : 10.5);
      doc.setTextColor(15, 17, 23);
    }
    doc.text(f.val, bx, y + 20);
  });

  y += 36;

  // ── 明細テーブル ──────────────────────────────
  const lineH = 7;
  // 列幅の合計は本文幅（170mm）に一致させること。
  // 以前は 190mm あり、右端の「金額（税込）」が紙からはみ出して切れていた。
  const tHeaders = ["品目", "数量", "単価（税抜）", "消費税", "金額（税込）"];
  const tCols = [66, 14, 30, 26, 34];
  const tRight = [false, true, true, true, true]; // 数値列は右寄せ

  const colX = (i: number): number => margin + tCols.slice(0, i).reduce((a, b) => a + b, 0);
  const cellX = (i: number): number =>
    tRight[i] ? colX(i) + (tCols[i] ?? 0) - 3 : colX(i) + 3;
  const align = (i: number) => (tRight[i] ? ("right" as const) : ("left" as const));

  doc.setFillColor(30, 33, 51);
  doc.rect(margin, y, innerW, lineH + 2, "F");

  applyJaFont(doc);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  tHeaders.forEach((h, i) => {
    doc.text(h, cellX(i), y + lineH - 1, { align: align(i) });
  });
  y += lineH + 2;

  doc.setFillColor(255, 255, 255);
  doc.rect(margin, y, innerW, lineH + 2, "F");
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, y, innerW, lineH + 2, "S");

  doc.setTextColor(15, 17, 23);
  const rowData = [
    `Sinap-sys ${planLabel}プラン 利用料`,
    "1",
    yen(inv.amount),
    yen(inv.tax_amount),
    yen(inv.total_amount),
  ];
  applyJaFont(doc);
  doc.setFontSize(8);
  rowData.forEach((d, i) => {
    doc.text(d, cellX(i), y + lineH - 1, { align: align(i) });
  });
  y += lineH + 2;

  // ── 合計 ─────────────────────────────────────
  y += 5;
  applyJaFont(doc);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text("合計（税込）", pageW - margin - 42, y, { align: "right" });
  applyJaBoldFont(doc, yen(inv.total_amount));
  doc.setFontSize(12);
  doc.setTextColor(99, 102, 241);
  doc.text(yen(inv.total_amount), pageW - margin, y, { align: "right" });

  applyJaFont(doc);
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `内訳: 税抜 ${yen(inv.amount)} ／ 消費税（10%） ${yen(inv.tax_amount)}`,
    pageW - margin,
    y + 5,
    { align: "right" },
  );

  y += 18;

  // ── 振込先 ───────────────────────────────────
  doc.setFillColor(254, 249, 231);
  doc.roundedRect(margin, y, innerW, 24, 3, 3, "F");
  applyJaFont(doc);
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("お振込先", margin + 4, y + 7);
  doc.setFontSize(9);
  doc.setTextColor(15, 17, 23);
  doc.text("銀行名・口座番号は契約確定後に別途ご案内いたします", margin + 4, y + 14);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text("恐れ入りますが、振込手数料は貴団体にてご負担をお願いいたします", margin + 4, y + 20);

  y += 32;

  // ── 備考 ─────────────────────────────────────
  if (inv.notes && inv.notes.trim() !== "") {
    applyJaFont(doc);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("備考", margin, y);
    y += 4;
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(inv.notes, innerW - 4) as string[];
    doc.text(lines, margin + 2, y);
    y += lines.length * 5;
  }

  // ── フッター ─────────────────────────────────
  applyJaFont(doc);
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `本請求書は${ISSUER.name}より電子的に発行されました。お問い合わせ: ${ISSUER.contact}`,
    pageW / 2,
    285,
    { align: "center" },
  );

  // ── 支払済みの透かし ──────────────────────────
  if (inv.status === "paid") {
    applyJaBoldFont(doc, "PAID");
    doc.setFontSize(48);
    doc.setTextColor(16, 185, 129);
    doc.setGState(doc.GState({ opacity: 0.12 }));
    doc.text("PAID", pageW / 2, 160, { align: "center", angle: 30 });
    doc.setGState(doc.GState({ opacity: 1 }));
  }

  // 収録範囲外の文字が混じっていないかを見ておく（通常は空）
  const unsupported = findUnsupportedChars(
    [inv.municipality_name, inv.notes ?? "", inv.invoice_number].join(""),
  );

  return {
    buffer: Buffer.from(doc.output("arraybuffer")),
    unsupported,
  };
}
