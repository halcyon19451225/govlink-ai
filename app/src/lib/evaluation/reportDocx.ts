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
  JUDGMENT_PENDING_TEXT,
  REPORT_FORM_VERSION,
  REPORT_NO_GUIDE,
  formOf,
  patternMeaningText,
  type ReportBlock,
  type ReportForm,
} from "@/lib/evaluation/reportTemplate";
import { FRAMEWORK_PRINCIPLES, ISSUE_CLASS_META, type ReportNo } from "@/lib/evaluation/judgment";
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

    case "judgment": {
      const j = d.judgment;
      const rows: string[][] = [
        ["評価過程（記号列）", j.path],
        ["報告書", j.report_no ? `No.${j.report_no} ${j.report_title}` : j.report_title],
        ["状態の意味", j.state],
        ["課題の所在", j.issue_class],
        ["対策立案の型", j.approach],
        ["反映ルート", j.route],
        ["標準処遇", j.standard_treatment],
      ];
      const out: (Paragraph | Table)[] = [table(["欄", "内容"], rows)];
      if (j.pending) {
        out.push(para(JUDGMENT_PENDING_TEXT, { size: 18, color: "B45309" }));
        if (j.missing.length > 0) {
          out.push(
            para(`揃っていない問い: ${j.missing.join(" ／ ")}`, { size: 16, color: "808891" }),
          );
        }
      }
      return out;
    }

    case "outcome_summary":
      if (!d.outcome) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["指標", "基準値", "目標値", "実績", "ベースライン", "X（実績−ベースライン）", "比較の段"],
          [
            [
              d.outcome.indicator,
              d.outcome.baseline,
              d.outcome.target,
              d.outcome.result,
              d.outcome.natural_baseline,
              d.outcome.x,
              d.outcome.comparison_grade,
            ],
          ],
        ),
        para(
          "※ X は「実績 − ベースライン（施策がなかった場合の自然体推計）」で取る。目標値との差（達成評価）とは別物。",
          { size: 16, color: "808891" },
        ),
      ];

    case "annual_history":
      if (d.annualHistory.length === 0) return block.omitWhenEmpty ? [] : [emptyNote()];
      return [
        table(
          ["年度", "取組", "初期アウトカム指標", "実績", "判定", "実行／論理の切り分け"],
          d.annualHistory.map((h) => [
            h.fiscal_year,
            h.work,
            h.indicator,
            h.result,
            h.achieved,
            h.cause_type,
          ]),
        ),
        para("※ この年次履歴が、実行起因か論理起因かを切り分ける唯一の根拠になる。", {
          size: 16,
          color: "808891",
        }),
      ];

    case "fiscal_effect": {
      const f = d.fiscalEffect;
      const out: (Paragraph | Table)[] = [
        table(
          ["欄", "内容"],
          [
            ["寄与経路", f.pathways],
            ["財政効果（計画期間累計）", f.effect],
            ["事業費C（同期間累計・人件費按分込み）", f.cost],
            ["財政効果率", f.rate],
            ["判定", f.mark],
            ["算定式", f.formula],
          ],
        ),
      ];
      if (f.note) out.push(para(f.note, { size: 16, color: "B45309" }));
      return out;
    }

    case "treatment":
      return [
        table(
          ["欄", "内容"],
          [
            ["反映ルート", d.treatment.route],
            ["標準処遇", d.treatment.standard],
            ["決定処遇", d.treatment.decided],
            ["理由書（様式H4）", d.treatment.rationale],
          ],
        ),
        para(
          "※ 標準処遇は初期値。異なる決定を採る場合は理由書を要し、様式G2で公表する（comply or explain）。",
          { size: 16, color: "808891" },
        ),
      ];

    case "pattern_meaning": {
      const no = d.judgment.report_no as ReportNo | null;
      if (!no) return [para(JUDGMENT_PENDING_TEXT, { size: 19 })];
      return [para(patternMeaningText(no))];
    }

    case "pattern_caution": {
      const no = d.judgment.report_no as ReportNo | null;
      if (!no) {
        return [
          para(
            "判定保留のため、報告書No.ごとの留意点は確定していない。判定可能となった時点で本来の報告書No.に復帰する。",
            { size: 19 },
          ),
        ];
      }
      return [para(REPORT_NO_GUIDE[no].caution)];
    }

    case "framework_guide": {
      const no = d.judgment.report_no as ReportNo | null;
      const out: (Paragraph | Table)[] = [];
      if (no) {
        out.push(
          table(
            ["順", "手順（順序に意味がある）"],
            REPORT_NO_GUIDE[no].steps.map((s, idx) => [`${idx + 1}`, s]),
          ),
        );
      } else {
        const iv = ISSUE_CLASS_META.IV;
        out.push(
          para(
            `判定保留のため、標準の手順は確定していない。まず ${iv.name}（${iv.where}）の道具立て — ${iv.frameworks.join("・")} — で、次期に判定可能となる測定設計を作る。`,
            { size: 19 },
          ),
        );
      }
      out.push(
        para(`フレームワーク選択の4原則: ${FRAMEWORK_PRINCIPLES.join(" ／ ")}`, {
          size: 16,
          color: "808891",
        }),
      );
      return out;
    }

    case "reflect_targets": {
      const no = d.judgment.report_no as ReportNo | null;
      if (!no) {
        return [
          para(
            "判定保留のため反映先は確定していない。測定課題として様式H3（未反映事項台帳）に登録し、次期に判定可能となる測定設計を計画へ書き込む。",
            { size: 19 },
          ),
        ];
      }
      return [
        para(REPORT_NO_GUIDE[no].reflect),
        para(
          "※ 行き先のない報告書が1件でも残れば、計画案を決裁に回せない（様式G1で両方向照合）。",
          { size: 16, color: "808891" },
        ),
      ];
    }

    case "text":
    default:
      return [];
  }
}

/** 記述欄（text ブロック）— 様式が指定した本文を並べる */
function narrativeFor(block: ReportBlock, d: EvaluationReportData): string[] {
  return (block.fields ?? []).map((f) => d.narrative[f]).filter(Boolean);
}

/** B欄の書き出し（報告書No.ごとの定型文）。空欄のまま提出されないための道しるべ */
function issueFormText(d: EvaluationReportData): string | null {
  const no = d.judgment.report_no as ReportNo | null;
  return no ? REPORT_NO_GUIDE[no].issueForm : null;
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
    const hasText = section.blocks.some((b) => b.kind === "text");
    const texts = section.blocks
      .filter((b) => b.kind === "text")
      .flatMap((b) => narrativeFor(b, d));
    const blocks = section.blocks.flatMap((b) => renderBlock(b, d));
    // 中身が何も無く、かつ省略可の節は落とす
    if (blocks.length === 0 && texts.length === 0 && section.blocks.every((b) => b.omitWhenEmpty)) {
      continue;
    }
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 40 },
        children: [
          new TextRun({ text: `${section.mark} ${section.heading}`, bold: true, size: 25, font: HEAD_FONT }),
        ],
      }),
    );
    if (section.note) children.push(para(section.note, { size: 16, color: "808891" }));
    // B欄（課題整理）は報告書No.ごとの定型文を先に刷る
    if (section.mark === "B") {
      const tmpl = issueFormText(d);
      if (tmpl) children.push(para(`【記入の型】${tmpl}`, { size: 17, color: "4B5566" }));
    }
    if (texts.length > 0) for (const t of texts) children.push(para(t));
    else if (hasText && blocks.length === 0) children.push(emptyNote());
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
