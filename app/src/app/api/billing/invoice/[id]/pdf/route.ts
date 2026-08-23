export const dynamic = "force-dynamic";
// 日本語フォントの展開に node:zlib を使うため、Edge ランタイムでは動かない
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { renderInvoicePdf, type InvoiceData } from "@/lib/billing/invoicePdf";

type Params = { params: { id: string } };

interface InvoiceRow extends InvoiceData {
  id: string;
  municipality_id: string;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const rows = await query<InvoiceRow>(
    `SELECT i.id, i.municipality_id,
            i.invoice_number, i.amount::float, i.tax_amount::float, i.total_amount::float,
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

  // 請求書は課金情報。ログインしていれば誰でも他団体の請求書を取れる状態だったので、
  // 自分の自治体のものに限定する（運営者=admin は全件）。
  const userMunicipalityId = session.user?.municipalityId;
  const isOperator = session.user?.role === "admin";
  if (!isOperator && userMunicipalityId !== inv.municipality_id) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 日本語の描画は lib/billing/invoicePdf.ts。
  // jsPDF の標準フォントには日本語グリフが無いため、
  // lib/pdf/japaneseFont.ts で Noto Sans JP を埋め込んでいる。
  const { buffer, unsupported } = renderInvoicePdf(inv);

  if (unsupported.length > 0) {
    // 埋め込みフォントの収録範囲（cp932相当）に無い文字。
    // 出力は続行するが、豆腐になっている可能性があるので気付けるようにする。
    console.warn(
      `[invoice pdf] 埋め込みフォントに無い文字が含まれています` +
        ` invoice=${inv.invoice_number} chars=${unsupported.join("")}`,
    );
  }

  // Buffer をそのまま渡すと BodyInit の型に合わないため Uint8Array にする
  const body = new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${inv.invoice_number}.pdf"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
