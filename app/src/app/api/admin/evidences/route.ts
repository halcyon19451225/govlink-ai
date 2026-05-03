import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const bodySchema = z.object({
  projectId: z.string().uuid("project_id が不正です"),
  outputKpiId: z.string().uuid().nullable().optional(),
  outcomeKpiId: z.string().uuid().nullable().optional(),
  evidenceType: z.enum(["rct", "observational", "case_study", "expert", "statistics", "other"]),
  strength: z.number().int().min(1).max(5).default(3),
  title: z.string().min(1, "タイトルは必須です"),
  description: z.string().optional(),
  sourceUrl: z.string().url("URLが不正です").optional().or(z.literal("")),
  documentId: z.string().uuid().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ data: null, error: "project_id は必須です" }, { status: 400 });
  }

  const rows = await query<{
    id: string;
    output_kpi_id: string | null;
    outcome_kpi_id: string | null;
    output_kpi_label: string | null;
    outcome_kpi_label: string | null;
    evidence_type: string;
    strength: number;
    title: string;
    description: string | null;
    source_url: string | null;
    document_id: string | null;
    ai_validity: string | null;
    created_at: string;
  }>(
    `SELECT e.id,
            e.output_kpi_id,
            e.outcome_kpi_id,
            ok.label  AS output_kpi_label,
            ock.label AS outcome_kpi_label,
            e.evidence_type,
            e.strength,
            e.title,
            e.description,
            e.source_url,
            e.document_id,
            e.ai_validity,
            e.created_at::text
     FROM evidences e
     LEFT JOIN kpis ok  ON ok.id  = e.output_kpi_id
     LEFT JOIN kpis ock ON ock.id = e.outcome_kpi_id
     WHERE e.project_id = $1
     ORDER BY e.created_at DESC`,
    [projectId],
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { projectId, outputKpiId, outcomeKpiId, evidenceType, strength, title, description, sourceUrl, documentId } =
    parsed.data;

  const rows = await query<{ id: string }>(
    `INSERT INTO evidences
       (project_id, output_kpi_id, outcome_kpi_id, evidence_type, strength,
        title, description, source_url, document_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      projectId,
      outputKpiId ?? null,
      outcomeKpiId ?? null,
      evidenceType,
      strength,
      title,
      description ?? null,
      sourceUrl || null,
      documentId ?? null,
    ],
  );

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ data: null, error: "DB への登録に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ data: { id: row.id }, error: null }, { status: 201 });
}
