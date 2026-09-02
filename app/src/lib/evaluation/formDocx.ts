import "server-only";

/**
 * 収束工程の様式（G1〜G4・H1〜H4）の docx — 汎用の帳票描画。
 *
 * reportDocx.ts（報告書No.1〜9）と同じ方針:
 *   - 純JSの `docx` でサーバー生成（フォントは名前参照のみ）
 *   - **表はAIに書かせず、実データから組む**。ここは受け取った行を描くだけ
 * 幅の広い台帳（H1・G1）は横向きで刷る。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const BODY_FONT = "游明朝";
const HEAD_FONT = "游ゴシック";

export interface FormTable {
  headers: readonly string[];
  rows: string[][];
  /** 列幅（%）。省略時は均等 */
  widths?: number[];
  fontSize?: number;
}

export interface FormSection {
  heading: string;
  note?: string;
  paragraphs?: string[];
  /** 「項目｜内容」の2列表 */
  kv?: { label: string; value: string }[];
  table?: FormTable;
}

export interface FormDoc {
  municipality: string;
  title: string;
  subtitle: string;
  /** 冒頭の注意書き（暫定・未承認など） */
  warnings?: string[];
  sections: FormSection[];
  landscape?: boolean;
  version: string;
}

function headerCell(text: string, size: number, width?: number): TableCell {
  return new TableCell({
    shading: { fill: "EEF1F6" },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size, font: HEAD_FONT })] })],
  });
}

function cell(text: string, size: number, width?: number): TableCell {
  return new TableCell({
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    children: text.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, size })] })),
  });
}

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: "AAB2C0" } as const;
const INNER = { style: BorderStyle.SINGLE, size: 1, color: "D6DDE6" } as const;

function table(t: FormTable): Table {
  const size = t.fontSize ?? 16;
  const w = (i: number) => t.widths?.[i];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: INNER, insideVertical: INNER },
    rows: [
      new TableRow({ children: t.headers.map((h, i) => headerCell(h, size, w(i))), tableHeader: true }),
      ...t.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, size, w(i))) })),
    ],
  });
}

function para(text: string, opts?: { size?: number; color?: string; bold?: boolean }): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, size: opts?.size ?? 20, ...(opts?.color ? { color: opts.color } : {}), ...(opts?.bold ? { bold: true } : {}) })],
  });
}

export function buildFormDocx(d: FormDoc): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: d.municipality, size: 20, font: HEAD_FONT })] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 60 },
      children: [new TextRun({ text: d.title, bold: true, size: 30, font: HEAD_FONT })],
    }),
    new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: d.subtitle, size: 20, color: "4B5566" })] }),
  ];
  for (const w of d.warnings ?? []) children.push(para(w, { size: 18, bold: true, color: "B45309" }));

  for (const s of d.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 40 },
        children: [new TextRun({ text: s.heading, bold: true, size: 23, font: HEAD_FONT })],
      }),
    );
    if (s.note) children.push(para(s.note, { size: 16, color: "808891" }));
    for (const p of s.paragraphs ?? []) children.push(para(p));
    if (s.kv && s.kv.length > 0) {
      children.push(table({ headers: ["項目", "内容"], rows: s.kv.map((k) => [k.label, k.value]), widths: [28, 72], fontSize: 18 }));
    }
    if (s.table) {
      if (s.table.rows.length === 0) children.push(para("該当なし", { size: 16, color: "808891" }));
      else children.push(table(s.table));
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 300 },
      children: [new TextRun({ text: `${d.version} ／ 出力 ${new Date().toISOString().slice(0, 10)}`, size: 16, color: "808891" })],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 20 } },
        heading1: { run: { font: HEAD_FONT, size: 30, bold: true, color: "1A237E" } },
        heading2: { run: { font: HEAD_FONT, size: 23, bold: true } },
      },
    },
    sections: [
      {
        properties: d.landscape ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } } : {},
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export const REFLECT_FORM_VERSION = "反映様式G1〜G4・付属様式H1〜H4（政策評価・次期計画反映 報告書様式集 汎用版）v1（2026-09）";
