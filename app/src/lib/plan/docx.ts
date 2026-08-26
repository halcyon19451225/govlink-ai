import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseMdLite, type PlanSection, type PlanDocVariant } from "@/lib/plan/document";

/**
 * 計画書 docx レンダラ（PL2 P③）— サーバーサイド生成（純JS・Amplifyで動く）
 *
 * 標準様式プレースホルダ（確認結果2 — 踏襲様式の提供後に layout で差し替える）:
 *   表紙 / 目次（Word目次フィールド・開いたときに更新される）/ ページ番号 /
 *   見出しスタイル階層 / フォントは名前参照のみ（埋め込まない — Word側で描画）
 *
 * variant:
 *   full   … 全章・表紙・目次・ページ番号
 *   simple … 章の要約＋KPI表＋施策一覧表
 *   digest … A4見開き2〜4頁想定（目標・施策マップ・工程表のみ。
 *            ロジックモデル図は別紙参照 — 画像埋め込みは将来拡張）
 */

export interface PlanDocMeta {
  title: string;
  municipalityName: string;
  planStart: string | null;
  planEnd: string | null;
  generatedOn: string; // YYYY-MM-DD
}

export interface KpiTableRow {
  label: string;
  tier: string;
  unit: string;
  baseline: number | null;
  target: number | null;
  deadline: string | null;
}

export interface MeasureTableRow {
  title: string;
  target_population: string | null;
  owner_department: string | null;
  period: string | null;
  total_budget: number | null;
}

export interface CheckpointTableRow {
  name: string;
  phase: string;
  scheduled_date: string | null;
}

export interface PlanDocLayout {
  /** 本文フォント（名前参照のみ。既定: 游明朝） */
  font_family?: string;
  /** 見出しフォント（既定: 游ゴシック） */
  heading_font?: string;
  /** 表紙の差出（既定: 自治体名） */
  cover_publisher?: string;
}

export interface PlanDocxInput {
  meta: PlanDocMeta;
  sections: PlanSection[];
  layout: PlanDocLayout;
  kpis: KpiTableRow[];
  measures: MeasureTableRow[];
  checkpoints: CheckpointTableRow[];
}

const yen = (n: number | null): string => (n == null ? "—" : `${Math.round(n).toLocaleString("ja-JP")}円`);
const num = (n: number | null): string => (n == null ? "—" : `${n}`);

// ─── 低レベル部品 ─────────────────────────────────────────

function bodyFont(layout: PlanDocLayout): string {
  return layout.font_family ?? "游明朝";
}

function para(text: string, opts?: { size?: number; bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): Paragraph {
  return new Paragraph({
    ...(opts?.align ? { alignment: opts.align } : {}),
    children: [new TextRun({ text, size: opts?.size ?? 21, bold: opts?.bold ?? false })],
    spacing: { after: 120 },
  });
}

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { fill: "E8EAF6" },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 19 })] })],
  });
}

function cell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 19 })] })] });
}

function table(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "888888" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "888888" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "888888" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "888888" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "BBBBBB" },
    },
    rows: [
      new TableRow({ children: headers.map(headerCell), tableHeader: true }),
      ...rows.map((r) => new TableRow({ children: r.map(cell) })),
    ],
  });
}

const TIER_LABEL: Record<string, string> = {
  outcome_initial: "初期",
  outcome_intermediate: "中間",
  outcome_long: "長期",
  process: "プロセス",
  efficiency: "効率",
};

function kpiTable(kpis: KpiTableRow[]): (Paragraph | Table)[] {
  if (kpis.length === 0) return [para("（KPIは未設定）")];
  return [
    table(
      ["指標", "層", "基準値", "目標値", "単位", "期限"],
      kpis.map((k) => [k.label, TIER_LABEL[k.tier] ?? k.tier, num(k.baseline), num(k.target), k.unit, k.deadline ?? "—"]),
    ),
  ];
}

function measureTable(measures: MeasureTableRow[]): (Paragraph | Table)[] {
  if (measures.length === 0) return [para("（施策は未登録）")];
  return [
    table(
      ["施策", "対象", "担当", "実施期間", "事業費"],
      measures.map((mr) => [mr.title, mr.target_population ?? "—", mr.owner_department ?? "—", mr.period ?? "—", yen(mr.total_budget)]),
    ),
  ];
}

function checkpointTable(cps: CheckpointTableRow[]): (Paragraph | Table)[] {
  if (cps.length === 0) return [para("（チェックポイントは未設定）")];
  return [
    table(["時期", "工程", "チェックポイント"], cps.map((c) => [c.scheduled_date ?? "—", c.phase, c.name])),
  ];
}

function coverChildren(meta: PlanDocMeta, layout: PlanDocLayout): Paragraph[] {
  const period =
    meta.planStart && meta.planEnd ? `計画期間: ${meta.planStart} 〜 ${meta.planEnd}` : "";
  return [
    new Paragraph({ spacing: { before: 3200 } }),
    para(meta.title, { size: 44, bold: true, align: AlignmentType.CENTER }),
    para(period, { size: 24, align: AlignmentType.CENTER }),
    new Paragraph({ spacing: { before: 4000 } }),
    para(layout.cover_publisher ?? meta.municipalityName, { size: 28, align: AlignmentType.CENTER }),
    para(meta.generatedOn, { size: 20, align: AlignmentType.CENTER }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function sectionBody(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const block of parseMdLite(md)) {
    if (block.kind === "heading") {
      out.push(
        new Paragraph({
          heading: block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          children: [new TextRun({ text: block.text })],
          spacing: { before: 200, after: 100 },
        }),
      );
    } else if (block.kind === "bullet") {
      for (const item of block.items) {
        out.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: item, size: 21 })],
          }),
        );
      }
    } else if (block.kind === "numbered") {
      block.items.forEach((item, i) => {
        out.push(para(`(${i + 1}) ${item}`));
      });
    } else {
      out.push(para(block.text));
    }
  }
  return out;
}

// ─── 評価報告書（PL3 A①）─────────────────────────────────

export interface EvalKpiRow {
  label: string;
  tier: string;
  unit: string;
  baseline: number | null;
  current: number | null;
  target: number | null;
  /** 到達度%（achievement.ts の統一計算。算定不能は null） */
  rate: number | null;
  achieved: boolean;
}

export interface EvalResultRow {
  measure: string;
  tier: string;
  fiscal_year: number | null;
  result: string;
}

export interface ImprovementRow {
  title: string;
  root_cause: string | null;
  status: string;
  due_date: string | null;
}

export interface EvalReportDocxInput {
  meta: PlanDocMeta;
  sections: PlanSection[];
  layout: PlanDocLayout;
  kpis: EvalKpiRow[];
  evaluations: EvalResultRow[];
  improvements: ImprovementRow[];
}

const IMPROVEMENT_STATUS_LABEL: Record<string, string> = {
  proposed: "提案",
  adopted: "採用",
  in_progress: "実施中",
  done: "完了",
  dropped: "見送り",
};

function evalKpiTable(kpis: EvalKpiRow[]): (Paragraph | Table)[] {
  if (kpis.length === 0) return [para("（KPIは未設定）")];
  return [
    table(
      ["指標", "層", "基準値", "現在値", "目標値", "到達度", "判定"],
      kpis.map((k) => [
        k.label,
        TIER_LABEL[k.tier] ?? k.tier,
        num(k.baseline),
        `${num(k.current)}${k.unit}`,
        `${num(k.target)}${k.unit}`,
        k.rate == null ? "—" : `${Math.round(k.rate * 10) / 10}%`,
        k.achieved ? "達成" : "未達",
      ]),
    ),
    para("※ 到達度 = 基準値からの前進量（目標の向きを考慮した統一計算）", { size: 17 }),
  ];
}

function evalResultTable(rows: EvalResultRow[]): (Paragraph | Table)[] {
  if (rows.length === 0) return [para("（プログラム評価の記録はありません）")];
  return [
    table(
      ["評価対象", "層", "年度", "評価結果（判断経路の要約）"],
      rows.map((r) => [r.measure, TIER_LABEL[r.tier] ?? r.tier, r.fiscal_year == null ? "—" : `${r.fiscal_year}`, r.result]),
    ),
  ];
}

function improvementTable(rows: ImprovementRow[]): (Paragraph | Table)[] {
  if (rows.length === 0) return [para("（改善アクションはありません）")];
  return [
    table(
      ["改善アクション", "真因", "状況", "期限"],
      rows.map((r) => [r.title, r.root_cause ?? "—", IMPROVEMENT_STATUS_LABEL[r.status] ?? r.status, r.due_date ?? "—"]),
    ),
  ];
}

/**
 * 評価結果報告書の docx（本編スタイル: 表紙・目次・章・頁番号）。
 * KPI達成状況表・施策別評価表・改善アクション表は該当章に実データから自動挿入
 * （AIに数値を書かせない — PL2 と同じ原則）。
 */
export async function buildEvalReportDocx(input: EvalReportDocxInput): Promise<Buffer> {
  const { meta, sections, layout } = input;
  const children: (Paragraph | Table | TableOfContents)[] = [];

  children.push(...coverChildren(meta, layout));
  children.push(para("目次", { size: 28, bold: true }));
  children.push(new TableOfContents("目次", { hyperlink: true, headingStyleRange: "1-2" }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  sections.forEach((s, i) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `第${i + 1}章 ${s.heading}` })],
        spacing: { before: 300, after: 160 },
      }),
    );
    children.push(...sectionBody(s.body_md || "（未作成）"));
    if (s.id === "kpi_status") children.push(...evalKpiTable(input.kpis));
    if (s.id === "measure_results") children.push(...evalResultTable(input.evaluations));
    if (s.id === "improvements") children.push(...improvementTable(input.improvements));
    if (s.source_refs.length > 0) {
      children.push(para(`出典: ${s.source_refs.join(" / ")}`, { size: 17 }));
    }
  });

  return packDocument(children, layout);
}

// ─── 本体 ─────────────────────────────────────────────────

export async function buildPlanDocx(variant: PlanDocVariant, input: PlanDocxInput): Promise<Buffer> {
  const { meta, sections, layout } = input;
  const children: (Paragraph | Table | TableOfContents)[] = [];

  if (variant === "full" || variant === "simple") {
    children.push(...coverChildren(meta, layout));
  }

  if (variant === "full") {
    children.push(para("目次", { size: 28, bold: true }));
    children.push(new TableOfContents("目次", { hyperlink: true, headingStyleRange: "1-2" }));
    children.push(new Paragraph({ children: [new PageBreak()] }));

    sections.forEach((s, i) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: `第${i + 1}章 ${s.heading}` })],
          spacing: { before: 300, after: 160 },
        }),
      );
      children.push(...sectionBody(s.body_md || "（未作成）"));
      // KPI・施策・工程の章には実データの表を添付する
      if (s.id === "policy") children.push(...kpiTable(input.kpis));
      if (s.id === "measures") children.push(...measureTable(input.measures));
      if (s.id === "structure") children.push(...checkpointTable(input.checkpoints));
      if (s.source_refs.length > 0) {
        children.push(para(`出典: ${s.source_refs.join(" / ")}`, { size: 17 }));
      }
    });
  } else if (variant === "simple") {
    sections.forEach((s, i) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: `${i + 1}. ${s.heading}` })],
          spacing: { before: 240, after: 120 },
        }),
      );
      children.push(para(s.summary || "（要約未作成 — 本編を生成すると章ごとの要約が入ります）"));
    });
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "KPI一覧" })], spacing: { before: 240, after: 120 } }));
    children.push(...kpiTable(input.kpis));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "施策一覧" })], spacing: { before: 240, after: 120 } }));
    children.push(...measureTable(input.measures));
  } else {
    // digest — A4見開き2〜4頁想定
    children.push(para(meta.title, { size: 32, bold: true, align: AlignmentType.CENTER }));
    children.push(
      para(
        `${meta.municipalityName}${meta.planStart && meta.planEnd ? ` / 計画期間 ${meta.planStart}〜${meta.planEnd}` : ""}`,
        { size: 20, align: AlignmentType.CENTER },
      ),
    );
    const bg = sections.find((s) => s.id === "background");
    if (bg?.summary) children.push(para(bg.summary));
    children.push(para("目標（KPI）", { size: 26, bold: true }));
    children.push(...kpiTable(input.kpis));
    children.push(para("施策マップ", { size: 26, bold: true }));
    children.push(...measureTable(input.measures));
    children.push(para("工程表", { size: 26, bold: true }));
    children.push(...checkpointTable(input.checkpoints));
    children.push(para("※ ロジックモデル図は別紙（ロジックモデル画面から出力）を参照", { size: 17 }));
  }

  return packDocument(children, layout);
}

/** Document の組み立てと ZIP 化（計画書・評価報告書で共用） */
function packDocument(
  children: (Paragraph | Table | TableOfContents)[],
  layout: PlanDocLayout,
): Promise<Buffer> {
  const doc = new Document({
    features: { updateFields: true }, // 目次フィールドを開いたとき更新
    styles: {
      default: {
        document: { run: { font: bodyFont(layout), size: 21 } },
        heading1: { run: { font: layout.heading_font ?? "游ゴシック", size: 30, bold: true, color: "1A237E" } },
        heading2: { run: { font: layout.heading_font ?? "游ゴシック", size: 25, bold: true } },
        heading3: { run: { font: layout.heading_font ?? "游ゴシック", size: 22, bold: true } },
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
