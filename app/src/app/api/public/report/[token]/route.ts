export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import {
  questionsForTarget,
  sanitizeAnswers,
  sanitizeQuestions,
  sanitizeTargets,
} from "@/lib/report/types";

type Params = { params: { token: string } };

/**
 * 実績報告の公開回答フォームAPI（S2 C①）— 認証不要・トークン能力方式
 * GET  … フォーム定義（この対象の設問・依頼文・現在の回答・差し戻し理由）
 * POST … 回答の保存（pending / returned のときのみ。accepted 後は固定）
 * 依頼が closed のときは受付終了の案内を返す。不明トークンは404（存在を明かさない）
 */

interface FeedRow {
  response_id: string;
  response_status: string;
  answers: unknown;
  reviewed_note: string | null;
  target_key: string;
  request_status: string;
  title: string;
  instruction: string | null;
  kind: string;
  fiscal_year: number | null;
  due_date: string | null;
  form_def: unknown;
  targets: unknown;
  project_title: string;
  municipality: string;
}

async function loadByToken(token: string): Promise<FeedRow | null> {
  if (!token || token.length > 200) return null;
  return queryOne<FeedRow>(
    `SELECT x.id AS response_id, x.status AS response_status, x.answers, x.reviewed_note, x.target_key,
            r.status AS request_status, r.title, r.instruction, r.kind, r.fiscal_year,
            to_char(r.due_date, 'YYYY-MM-DD') AS due_date, r.form_def, r.targets,
            p.title AS project_title, m.name AS municipality
     FROM report_responses x
     JOIN report_requests r ON r.id = x.request_id
     JOIN projects p ON p.id = r.project_id
     JOIN municipalities m ON m.id = p.municipality_id
     WHERE x.token = $1`,
    [token],
  );
}

export async function GET(_req: NextRequest, { params }: Params) {
  const row = await loadByToken(params.token);
  if (!row) {
    return NextResponse.json({ data: null, error: "not found" }, { status: 404 });
  }
  const target = sanitizeTargets(row.targets).find((t) => t.target_key === row.target_key) ?? null;
  // 公開側にはIDの実在検証は不要（保存済みform_defは作成時にサニタイズ済み）だが、形の防御はかける
  const allQuestions = sanitizeQuestions(row.form_def, new Set(collectIds(row.form_def, "kpi_id")), new Set(collectIds(row.form_def, "measure_design_id")));
  const questions = questionsForTarget(allQuestions, target?.measure_design_id ?? row.target_key);
  return NextResponse.json({
    data: {
      closed: row.request_status === "closed",
      status: row.response_status,
      title: row.title,
      instruction: row.instruction,
      kind: row.kind,
      fiscal_year: row.fiscal_year,
      due_date: row.due_date,
      project_title: row.project_title,
      municipality: row.municipality,
      measure_title: target?.measure_title ?? "",
      owner_department: target?.owner_department ?? null,
      questions,
      answers: row.answers && typeof row.answers === "object" ? row.answers : {},
      reviewed_note: row.response_status === "returned" ? row.reviewed_note : null,
    },
    error: null,
  });
}

function collectIds(formDef: unknown, key: "kpi_id" | "measure_design_id"): string[] {
  if (!Array.isArray(formDef)) return [];
  return (formDef as Record<string, unknown>[])
    .map((q) => (q && typeof q === "object" && typeof q[key] === "string" ? (q[key] as string) : null))
    .filter((x): x is string => Boolean(x));
}

export async function POST(req: NextRequest, { params }: Params) {
  const row = await loadByToken(params.token);
  if (!row) {
    return NextResponse.json({ data: null, error: "not found" }, { status: 404 });
  }
  if (row.request_status === "closed") {
    return NextResponse.json({ data: null, error: "この報告は受付を終了しています（お問い合わせは依頼元へ）" }, { status: 409 });
  }
  if (row.response_status === "accepted") {
    return NextResponse.json({ data: null, error: "この回答は受領済みのため修正できません（修正が必要な場合は依頼元へ連絡してください）" }, { status: 409 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const body = (raw ?? {}) as { answers?: unknown };

  const target = sanitizeTargets(row.targets).find((t) => t.target_key === row.target_key) ?? null;
  const allQuestions = sanitizeQuestions(row.form_def, new Set(collectIds(row.form_def, "kpi_id")), new Set(collectIds(row.form_def, "measure_design_id")));
  const questions = questionsForTarget(allQuestions, target?.measure_design_id ?? row.target_key);
  const { answers, missing } = sanitizeAnswers(body.answers, questions);
  if (Object.keys(answers).length === 0) {
    return NextResponse.json({ data: null, error: "回答が入力されていません" }, { status: 400 });
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { data: null, error: `必須の設問に未回答があります（${missing.length}件）` },
      { status: 400 },
    );
  }

  await queryOne(
    `UPDATE report_responses
     SET answers = $1::jsonb, status = 'answered', answered_at = now()
     WHERE id = $2 RETURNING id`,
    [JSON.stringify(answers), row.response_id],
  );
  return NextResponse.json({ data: { status: "answered" }, error: null });
}
