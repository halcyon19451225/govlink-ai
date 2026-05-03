import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsPDF } from "jspdf";

type Params = { params: { id: string } };

interface InvoiceRow {
  id: string;
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

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const rows = await query<InvoiceRow>(
    `SELECT i.id, i.invoice_number, i.amount, i.tax_amount, i.total_amount,
            i.period_start::text, i.period_end::text, i.due_date::text,
            i.status, i.notes, i.created_at::text,
            m.name AS municipality_name,
            s.plan
     FROM invoices i
     JOIN municipalities m ON m.id = i.municipality_id
     LEFT JOIN subscriptions s ON s.id = i.subscription_id
     WHERE i.id = $1`,
    [params.id],
  );

  const inv = rows[0];
  if (!inv) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const planLabel = inv.plan === "premium" ? "Premium" : "Standard";

  // jsPDFでA4縦のPDFを生成（単位: mm）
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = 210;
  const margin = 20;
  let y = margin;

  const lineH = 7;
  const gray = "#94a3b8";
  const dark = "#0f172a";
  const blue = "#6366f1";

  // ── ヘッダー ──────────────────────────────
  doc.setFillColor(15, 17, 23);
  doc.rect(0, 0, pageW, 35, "F");

  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("Sinap-sys", margin, 18);

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.setFont("helvetica", "normal");
  doc.text("AI Policy Management SaaS", margin, 25);
  doc.text("https://sinap-sys.jp", pageW - margin, 18, { align: "right" });
  doc.text("お問い合わせ: https://sinap-sys.jp/contact", pageW - margin, 25, { align: "right" });

  y = 48;

  // ── タイトル ──────────────────────────────
  doc.setFontSize(22);
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.text("INVOICE", margin, y);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.text(`請求書番号: ${inv.invoice_number}`, pageW - margin, y - 6, { align: "right" });
  doc.text(`発行日: ${inv.created_at.slice(0, 10)}`, pageW - margin, y, { align: "right" });

  y += 12;

  // ── 適格請求書番号（申請中） ──────────
  doc.setFontSize(8);
  doc.setTextColor(239, 68, 68);
  doc.text("※ 適格請求書発行事業者登録申請中", margin, y);

  y += 14;

  // ── 請求先 / 請求元 ────────────────────────
  const colW = (pageW - margin * 2) / 2;

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("請求先", margin, y);
  doc.text("請求元", margin + colW, y);
  y += 4;

  doc.setFontSize(11);
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.text(inv.municipality_name, margin, y + 2);
  doc.text("Kabushiki Kaisha Ordo", margin + colW, y + 2);

  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "normal");
  doc.text("御中", margin, y + 8);
  doc.text("(Kabushiki Kaisha Ordo)", margin + colW, y + 8);
  doc.text("Honsya: 1652-1 Ueno, Mifune-machi,", margin + colW, y + 14);
  doc.text("Kamimashiki-gun, Kumamoto", margin + colW, y + 19);
  doc.text("Houjin Bangou: 3300-01-029524", margin + colW, y + 24);

  y += 34;

  // ── 請求情報ボックス ────────────────────────
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, pageW - margin * 2, 28, 3, 3, "F");

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const boxFields = [
    { label: "請求金額（税込）", val: `¥${inv.total_amount.toLocaleString()}`, large: true },
    { label: "支払期限", val: inv.due_date },
    { label: "サービス期間", val: `${inv.period_start} ～ ${inv.period_end}` },
  ];
  const fw = (pageW - margin * 2) / 3;
  boxFields.forEach((f, i) => {
    const bx = margin + fw * i + 6;
    doc.text(f.label, bx, y + 8);
    if (f.large) {
      doc.setFontSize(16);
      doc.setTextColor(99, 102, 241);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setFontSize(11);
      doc.setTextColor(15, 17, 23);
      doc.setFont("helvetica", "bold");
    }
    doc.text(f.val, bx, y + 20);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
  });

  y += 36;

  // ── 明細テーブル ─────────────────────────
  const tHeaders = ["品目", "数量", "単価（税抜）", "消費税", "金額（税込）"];
  const tCols = [80, 15, 35, 25, 35];
  const tStartX = margin;

  doc.setFillColor(30, 33, 51);
  doc.rect(tStartX, y, pageW - margin * 2, lineH + 2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  let cx = tStartX + 3;
  tHeaders.forEach((h, i) => {
    doc.text(h, cx, y + lineH - 1);
    cx += tCols[i]!;
  });
  y += lineH + 2;

  // 明細行
  doc.setFillColor(255, 255, 255);
  doc.rect(tStartX, y, pageW - margin * 2, lineH + 2, "F");
  doc.setDrawColor(226, 232, 240);
  doc.rect(tStartX, y, pageW - margin * 2, lineH + 2, "S");

  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "normal");
  cx = tStartX + 3;
  const rowData = [
    `Sinap-sys ${planLabel} プラン 利用料`,
    "1",
    `¥${inv.amount.toLocaleString()}`,
    `¥${inv.tax_amount.toLocaleString()}`,
    `¥${inv.total_amount.toLocaleString()}`,
  ];
  rowData.forEach((d, i) => {
    doc.text(d, cx, y + lineH - 1);
    cx += tCols[i]!;
  });
  y += lineH + 2;

  // 合計行
  y += 4;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(99, 102, 241);
  doc.text(`合計（税込）: ¥${inv.total_amount.toLocaleString()}`, pageW - margin, y, { align: "right" });
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(`内消費税（10%）: ¥${inv.tax_amount.toLocaleString()}`, pageW - margin, y + 5, { align: "right" });

  y += 20;

  // ── 振込先（プレースホルダー） ────────────────
  doc.setFillColor(254, 249, 231);
  doc.roundedRect(margin, y, pageW - margin * 2, 24, 3, 3, "F");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("お振込先", margin + 4, y + 7);
  doc.setFontSize(9);
  doc.setTextColor(15, 17, 23);
  doc.setFont("helvetica", "bold");
  doc.text("銀行名・口座番号は契約確定後に別途ご案内いたします", margin + 4, y + 14);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.text("振込手数料はお客様負担でお願いします", margin + 4, y + 20);

  y += 32;

  // ── 備考 ────────────────────────────────
  if (inv.notes) {
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("備考", margin, y);
    y += 4;
    doc.setTextColor(71, 85, 105);
    const lines = doc.splitTextToSize(inv.notes, pageW - margin * 2 - 4) as string[];
    doc.text(lines, margin + 2, y);
    y += lines.length * 5;
  }

  // ── フッター ────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "本請求書は株式会社 Ordoにより電子発行されました。お問い合わせ: https://sinap-sys.jp/contact",
    pageW / 2, 285, { align: "center" },
  );

  // ステータス透かし
  if (inv.status === "paid") {
    doc.setFontSize(48);
    doc.setTextColor(16, 185, 129);
    doc.setFont("helvetica", "bold");
    doc.setGState(doc.GState({ opacity: 0.12 }));
    doc.text("PAID", pageW / 2, 160, { align: "center", angle: 30 });
    doc.setGState(doc.GState({ opacity: 1 }));
  }

  // PDFをBuffer化してレスポンス
  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${inv.invoice_number}.pdf"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
}
