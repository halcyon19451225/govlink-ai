export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { uploadToStorage } from "@/lib/storage";
import { normalizeSections, PLAN_DOC_VARIANTS, type PlanDocVariant } from "@/lib/plan/document";
import { EVAL_REPORT_VARIANT } from "@/lib/plan/evalReport";
import { gatherEvalTables } from "@/lib/plan/evalData";
import {
  buildEvalReportDocx,
  buildPlanDocx,
  type CheckpointTableRow,
  type KpiTableRow,
  type MeasureTableRow,
  type PlanDocLayout,
} from "@/lib/plan/docx";
import { normalizeIndicatorType } from "@/lib/outcome/tiers";

type Params = { params: { id: string } };

const MODULE = "logic_model";

/**
 * docx 出力（PL2 P③ / PL3 A①）
 *   full / simple / digest … 計画書（variant='full' の文書から3体裁）
 *   evaluation_report      … 評価報告書（variant='evaluation_report' の文書）
 * - 数値の表（KPI・施策・工程・達成状況・改善一覧）は出力時に実データから自動挿入
 * - S3 `plan-documents/` に保存して plan_document_exports に履歴を残し、
 *   本体バイナリをそのまま返す（ブラウザは即ダウンロード）
 */

const bodySchema = z.object({
  variant: z.enum(["full", "simple", "digest", "evaluation_report"]),
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "view");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "出力形式が不正です" }, { status: 400 });
  }
  const isEval = parsed.data.variant === EVAL_REPORT_VARIANT;

  const doc = await queryOne<{
    id: string;
    title: string;
    sections: unknown;
    layout: unknown;
  }>(
    `SELECT id, title, sections, layout FROM plan_documents
     WHERE project_id = $1 AND variant = $2`,
    [params.id, isEval ? EVAL_REPORT_VARIANT : "full"],
  );
  if (!doc) {
    return NextResponse.json(
      { data: null, error: "文書がまだありません（先に「章立てを起こす」を実行）" },
      { status: 404 },
    );
  }

  const [project, kpis, measures, checkpoints] = await Promise.all([
    queryOne<{ municipality: string; plan_start: string | null; plan_end: string | null }>(
      `SELECT m.name AS municipality,
              to_char(p.plan_start_date, 'YYYY-MM-DD') AS plan_start,
              to_char(p.plan_end_date, 'YYYY-MM-DD') AS plan_end
       FROM projects p JOIN municipalities m ON m.id = p.municipality_id
       WHERE p.id = $1`,
      [params.id],
    ),
    query<{
      label: string;
      unit: string;
      target: number | null;
      baseline_value: number | null;
      indicator_type: string | null;
      target_deadline: string | null;
    }>(
      `SELECT label, unit, target::float AS target, baseline_value::float AS baseline_value,
              indicator_type, to_char(target_deadline, 'YYYY-MM-DD') AS target_deadline
       FROM kpis WHERE project_id = $1 ORDER BY created_at LIMIT 50`,
      [params.id],
    ),
    query<{
      title: string;
      target_population: string | null;
      owner_department: string | null;
      period_start: string | null;
      period_end: string | null;
      total_budget: number | null;
    }>(
      `SELECT title, target_population, owner_department,
              to_char(period_start, 'YYYY-MM-DD') AS period_start,
              to_char(period_end, 'YYYY-MM-DD') AS period_end,
              total_budget::float AS total_budget
       FROM measure_designs WHERE project_id = $1 ORDER BY sort_order, created_at LIMIT 50`,
      [params.id],
    ),
    query<{ name: string; phase: string; scheduled_date: string | null }>(
      `SELECT name, phase, to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
       FROM project_pdca_checkpoints WHERE project_id = $1 ORDER BY scheduled_date NULLS LAST LIMIT 60`,
      [params.id],
    ),
  ]);
  if (!project) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  const kpiRows: KpiTableRow[] = kpis.map((k) => ({
    label: k.label,
    tier: normalizeIndicatorType(k.indicator_type),
    unit: k.unit,
    baseline: k.baseline_value,
    target: k.target,
    deadline: k.target_deadline,
  }));
  const measureRows: MeasureTableRow[] = measures.map((m2) => ({
    title: m2.title,
    target_population: m2.target_population,
    owner_department: m2.owner_department,
    period:
      m2.period_start || m2.period_end
        ? `${m2.period_start ?? "—"}〜${m2.period_end ?? "—"}`
        : null,
    total_budget: m2.total_budget,
  }));
  const checkpointRows: CheckpointTableRow[] = checkpoints.map((c) => ({
    name: c.name,
    phase: c.phase,
    scheduled_date: c.scheduled_date,
  }));

  const layout: PlanDocLayout =
    doc.layout && typeof doc.layout === "object" ? (doc.layout as PlanDocLayout) : {};

  try {
    const today = new Date().toISOString().slice(0, 10);
    const meta = {
      title: doc.title,
      municipalityName: project.municipality,
      planStart: project.plan_start,
      planEnd: project.plan_end,
      generatedOn: today,
    };
    let buffer: Buffer;
    let variantLabel: string;
    if (isEval) {
      // 評価報告書 — 達成状況・評価・改善の表は統一計算・実データから
      const tables = await gatherEvalTables(params.id);
      buffer = await buildEvalReportDocx({
        meta,
        sections: normalizeSections(doc.sections),
        layout,
        kpis: tables.kpis,
        evaluations: tables.evaluations,
        improvements: tables.improvements,
      });
      variantLabel = "評価報告書";
    } else {
      const planVariant = parsed.data.variant as PlanDocVariant;
      buffer = await buildPlanDocx(planVariant, {
        meta,
        sections: normalizeSections(doc.sections),
        layout,
        kpis: kpiRows,
        measures: measureRows,
        checkpoints: checkpointRows,
      });
      variantLabel = PLAN_DOC_VARIANTS.find((v) => v.key === planVariant)?.label ?? planVariant;
    }

    const variant = parsed.data.variant;
    const fileName = `${doc.title}（${variantLabel}）${today}.docx`;
    const s3Path = `${doc.id}/${variant}-${Date.now()}.docx`;
    // S3保存は履歴用 — 失敗してもダウンロード自体は返す（保存できた場合のみ履歴に残す）
    let exportId: string | null = null;
    try {
      await uploadToStorage("plan-documents", s3Path, buffer, DOCX_MIME);
      const row = await queryOne<{ id: string }>(
        `INSERT INTO plan_document_exports (plan_document_id, variant, s3_key, file_name, file_size_bytes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [doc.id, variant, s3Path, fileName, buffer.length],
      );
      exportId = row?.id ?? null;
    } catch (e) {
      console.error("計画書docxのS3保存に失敗（ダウンロードは継続）:", e);
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": DOCX_MIME,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Content-Length": String(buffer.length),
        ...(exportId ? { "X-Export-Id": exportId } : {}),
      },
    });
  } catch (e) {
    console.error("計画書docxの出力に失敗:", e);
    return NextResponse.json({ data: null, error: "出力に失敗しました" }, { status: 500 });
  }
}
