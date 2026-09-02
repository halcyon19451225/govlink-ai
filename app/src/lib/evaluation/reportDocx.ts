import "server-only";

/**
 * 評価報告書 docx（CA2-5）— 様式（reportTemplate）× 材料（reportData）を描くだけ。
 *
 * PL2/PL3 の docx 基盤と同じ方針:
 *   - 純JSの `docx` パッケージでサーバー生成（Amplifyで動く。フォントは名前参照のみ）
 *   - **表はAIに書かせず、実データから組む**
 * 様式を差し替えるときは reportTemplate.ts だけを替える（ここは触らない）。
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  REPORT_FORM_VERSION,
  formOf,
  type ReportBlock,
  type ReportForm,
} from "@/lib/evaluation/reportTemplate";
import { indicatorRowText } from "@/lib/evaluation/reportRows";
import type { EvaluationReportData } from "@/lib/evaluation/reportData";

const BODY_FONT = "游明朝";
const HEAD_FONT = "游ゴシック";

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { fill: "EEF1F6" },
    children: [
      new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: HEAD_FONT })] }),
    ],
  });
}

function cell(text: string): TableCell {
  return new TableCell({
    children: text
      .split("\n")
      .map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 18 })] })),
  });
}

function table(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "AAB2C0" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "AAB2C0" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "AAB2C0" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "AAB2C0" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D6DDE6" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D6DDE6" },
    },
    rows: [
      new TableRow({ children: headers.map(headerCell), tableHeader: true }),
      ...rows.map((r) => new TableRow({ children: r.map(cell) })),
    ],
  });
}

function para(text: string, opts?: { size?: number; color?: string; italics?: boolean }): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        size: opts?.size ?? 21,
        ...(opts?.color ? { color: opts.color } : {}),
        ...(opts?.italics ? { italics: true } : {}),
      }),
    ],
  });
}

function emptyNote(): Paragraph {
  return para("該当なし", { size: 18, color: "808891" });
}

/** 節の中身を描く。データが無ければ omitWhenEmpty に従う */
function renderBlock(block: ReportBlock, d: EvaluationReportData): (Paragraph | Table)[] {
  switch (block.kind) {
    case "kv":
      return [
        table(
          ["項目", "内容"],
          d.keyValues.map((k) => [k.label, k.value]),
        ),
      ];

    case "indicator_table":
      if (d.indicators.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["No", "指標", "基準値", "目標値", "実績", "判定", "出所"],
          d.indicators.map(indicatorRowText),
        ),
        para(
          d.frozen
            ? "※ 実績は評価の承認時点で凍結した値です。以後の実績更新では変わりません。"
            : "※ この評価はまだ承認されていないため、実績は現時点の暫定値です。",
          { size: 16, color: "808891" },
        ),
      ];

    case "path_table":
      if (d.path.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["工程", "問い", "回答", "補足", "備考"],
          d.path.map((p) => [p.section, p.question, p.answer, p.note, p.overridden]),
        ),
      ];

    case "delegation_table":
      if (d.delegations.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["出所", "課題", "内容", "根本原因", "状態"],
          d.delegations.map((x) => [x.origin, x.title, x.detail, x.root_cause, x.status]),
        ),
      ];

    case "work_rollup_table":
      if (d.workRollup.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["取組", "年度", "状態", "評価の結論"],
          d.workRollup.map((w) => [`${w.code} ${w.title}`, w.fiscal_year, w.status, w.result]),
        ),
      ];

    case "cost_table":
      if (d.costs.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["年度", "事業費計", "財源内訳", "備考"],
          d.costs.map((c) => [c.fiscal_year, c.total, c.funding, c.note]),
        ),
      ];

    case "benchmark_table":
      if (d.benchmarks.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["指標", "比較先", "比較値", "自団体", "年度", "出典"],
          d.benchmarks.map((b) => [b.indicator, b.comparator, b.value, b.own, b.fiscal_year, b.source]),
        ),
      ];

    case "activity_table":
      if (d.activities.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["実施項目", "計画", "完了"],
          d.activities.map((a) => [a.title, a.planned, a.completed]),
        ),
      ];

    case "text":
    default:
      return [];
  }
}

/** 記述欄（text ブロック）は節ごとに出す内容が違うので、様式の欄記号で振り分ける */
function narrativeFor(mark: string, d: EvaluationReportData): string[] {
  const n = d.narrative;
  if (d.kind === "work") {
    if (mark === "E") return [n.findings, n.barrier_factors].filter(Boolean);
    if (mark === "F") return [n.result, n.improvement_actions].filter(Boolean);
  } else {
    if (mark === "G") return [n.result, n.next_steps].filter(Boolean);
    if (mark === "H") return [n.next_steps].filter(Boolean);
  }
  return [];
}

export function buildEvaluationReportDocx(d: EvaluationReportData): Promise<Buffer> {
  const form: ReportForm = formOf(d.kind);
  const children: (Paragraph | Table)[] = [];

  // 表紙相当（1頁を使い切らない簡素な見出し — 帳票として綴じる前提）
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: d.municipality, size: 20, font: HEAD_FONT })],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 60 },
      children: [new TextRun({ text: form.title, bold: true, size: 32, font: HEAD_FONT })],
    }),
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({ text: `${form.subtitle} ／ ${d.subject}`, size: 21, color: "4B5566" }),
      ],
    }),
  );
  if (!d.frozen) {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: "【暫定】この報告書は未承認の評価から作成しています。数値は確定していません。",
            size: 19,
            bold: true,
            color: "B45309",
          }),
        ],
      }),
    );
  }

  for (const section of form.sections) {
    const blocks = section.blocks.flatMap((b) => renderBlock(b, d));
    const texts = section.blocks.some((b) => b.kind === "text")
      ? narrativeFor(section.mark, d)
      : [];
    // 中身が何も無く、かつ省略可の節は落とす
    if (blocks.length === 0 && texts.length === 0 && section.blocks.every((b) => b.omitWhenEmpty)) {
      continue;
    }
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 40 },
        children: [
          new TextRun({ text: `${section.mark}. ${section.heading}`, bold: true, size: 25, font: HEAD_FONT }),
        ],
      }),
    );
    if (section.note) children.push(para(section.note, { size: 16, color: "808891" }));
    if (texts.length > 0) for (const t of texts) children.push(para(t));
    else if (section.blocks.some((b) => b.kind === "text") && blocks.length === 0)
      children.push(emptyNote());
    children.push(...blocks);
  }

  children.push(
    new Paragraph({
      spacing: { before: 320 },
      children: [
        new TextRun({
          text: `${REPORT_FORM_VERSION} ／ 出力 ${new Date().toISOString().slice(0, 10)}`,
          size: 16,
          color: "808891",
        }),
      ],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 21 } },
        heading1: { run: { font: HEAD_FONT, size: 32, bold: true, color: "1A237E" } },
        heading2: { run: { font: HEAD_FONT, size: 25, bold: true } },
      },
    },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
